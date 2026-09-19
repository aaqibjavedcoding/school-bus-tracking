import type { ApiResponse, RefreshResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from './api.ts';
import { getAccessToken, setAccessToken } from './session.ts';

/**
 * Bounded, single-flight session recovery for **headless** runtimes.
 *
 * Why this module exists: the access token lives in JS memory only
 * (`./session.ts`), and the refresh token lives in the platform cookie jar.
 * A mounted `AuthProvider` restores the session on app start — but the crew
 * background-location task can be executed by the OS in a *fresh JS process
 * with no React screen mounted at all*. In that process `getAccessToken()` is
 * `null`, so a socket handshake would be refused by the gateway
 * (`Rejected unauthenticated … socket`) and every GPS fix would be dropped.
 *
 * This module is the one supported way to get an authenticated session back
 * in that situation, using the **existing** auth architecture only:
 *
 * - it calls the same `POST /auth/refresh` the UI calls (cookie-based refresh
 *   token — nothing is read from, or written to, AsyncStorage);
 * - it is **single-flight**: concurrent callers (a headless task execution and
 *   a foreground screen recovering at the same moment) share one attempt, so
 *   two simultaneous refreshes can never race the server's refresh-token
 *   rotation and revoke each other;
 * - it is **bounded**: an attempt that outlives {@link SESSION_RECOVERY_TIMEOUT_MS}
 *   resolves as `timeout` instead of hanging a background task open;
 * - it is **cancellable by generation**: `invalidateSessionRecovery()` (called
 *   on logout / account switch) bumps a generation counter, and a late async
 *   completion from an older generation is discarded — it can neither install
 *   a token nor resurrect a session that was just signed out.
 *
 * No password, no plaintext refresh token and no session material is ever
 * persisted here: the only durable artefacts of tracking recovery are the
 * non-secret trip/user/school ids in `tracking-context.ts`.
 */

/** Identity recovered from the refresh envelope (never sensitive fields). */
export interface SessionIdentity {
  id: string;
  school_id: string | null;
  role: string;
}

export type SessionRecoveryStatus =
  /** A usable access token is in memory (already present, or just refreshed). */
  | 'authenticated'
  /** The refresh was rejected: no session cookie / revoked — the user must sign in. */
  | 'anonymous'
  /** The bounded wait elapsed. The attempt keeps running; the caller must not block. */
  | 'timeout'
  /** Network/API failure or the build has no configured API base URL. */
  | 'error';

export interface SessionRecoveryResult {
  status: SessionRecoveryStatus;
  accessToken: string | null;
  /** `null` when an already-present token short-circuited the attempt. */
  user: SessionIdentity | null;
  /** True when this caller joined an attempt another caller had started. */
  shared: boolean;
  /** Machine-readable cause, for diagnostics and tests (never shown raw). */
  reason:
    | 'token-present'
    | 'refreshed'
    | 'refresh-rejected'
    | 'timed-out'
    | 'failed'
    | 'cancelled'
    | null;
  /** Generation the attempt started in; a stale completion is reported here. */
  generation: number;
}

/** How long a caller waits for one recovery attempt before giving up. */
export const SESSION_RECOVERY_TIMEOUT_MS = 8_000;

export interface SessionRecoveryDeps {
  /** Defaults to the app-wide `apiClient.refresh()`. */
  refresh?: () => Promise<ApiResponse<RefreshResponse>>;
  /** Defaults to `setAccessToken` from `./session.ts`. */
  applyToken?: (token: string) => void;
  /** Defaults to `getAccessToken` from `./session.ts`. */
  currentToken?: () => string | null;
  timeoutMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface InflightAttempt {
  promise: Promise<SessionRecoveryResult>;
  generation: number;
}

let generation = 0;
let inflight: InflightAttempt | null = null;

/**
 * Invalidates every in-flight and future-completing recovery attempt.
 *
 * Called on logout and on account switch: after this, an attempt that was
 * already running cannot install its token (`status: 'cancelled'`), so a late
 * network completion can never resurrect the session that was just closed.
 */
export function invalidateSessionRecovery(): void {
  generation += 1;
}

/** Current generation — tests and diagnostics only. */
export function sessionRecoveryGeneration(): number {
  return generation;
}

/** True while one recovery attempt is in flight (shared by all callers). */
export function isSessionRecoveryInFlight(): boolean {
  return inflight !== null;
}

/** Test seam: drops the shared attempt and the generation counter. */
export function __resetSessionRecoveryForTests(): void {
  inflight = null;
  generation = 0;
}

/**
 * Returns an authenticated session if one can be obtained within the bound.
 *
 * Fast path: an access token already in memory is authoritative — no network
 * call, no rotation. Otherwise one `POST /auth/refresh` is attempted, shared
 * with any concurrent caller.
 */
export async function recoverSession(
  deps: SessionRecoveryDeps = {},
): Promise<SessionRecoveryResult> {
  const currentToken = deps.currentToken ?? getAccessToken;
  const existing = currentToken();
  if (existing) {
    return {
      status: 'authenticated',
      accessToken: existing,
      user: null,
      shared: false,
      reason: 'token-present',
      generation,
    };
  }

  const startedIn = generation;
  if (inflight && inflight.generation === startedIn) {
    // Single-flight: joining an attempt is exactly what stops two callers
    // from rotating the refresh token against each other.
    const result = await inflight.promise;
    return { ...result, shared: true };
  }

  const attempt: InflightAttempt = {
    generation: startedIn,
    promise: runRecovery(deps, startedIn),
  };
  inflight = attempt;

  const timeoutMs = deps.timeoutMs ?? SESSION_RECOVERY_TIMEOUT_MS;
  try {
    return await withTimeout(attempt.promise, timeoutMs, startedIn);
  } finally {
    if (inflight === attempt) {
      inflight = null;
    }
  }
}

async function runRecovery(
  deps: SessionRecoveryDeps,
  startedIn: number,
): Promise<SessionRecoveryResult> {
  const refresh = deps.refresh ?? (() => apiClient.refresh());
  const applyToken = deps.applyToken ?? setAccessToken;

  try {
    const envelope = await refresh();
    const token = envelope.data?.access_token;
    const user = envelope.data?.user;
    if (!token || !user) {
      return {
        status: 'anonymous',
        accessToken: null,
        user: null,
        shared: false,
        reason: 'refresh-rejected',
        generation: startedIn,
      };
    }
    if (generation !== startedIn) {
      // Logout / account switch happened while the request was in flight.
      // The token is dropped, never applied.
      return {
        status: 'anonymous',
        accessToken: null,
        user: null,
        shared: false,
        reason: 'cancelled',
        generation: startedIn,
      };
    }
    applyToken(token);
    return {
      status: 'authenticated',
      accessToken: token,
      user: { id: user.id, school_id: user.school_id ?? null, role: String(user.role) },
      shared: false,
      reason: 'refreshed',
      generation: startedIn,
    };
  } catch {
    return {
      status: 'anonymous',
      accessToken: null,
      user: null,
      shared: false,
      reason: 'failed',
      generation: startedIn,
    };
  }
}

/**
 * Bounds the wait without cancelling the work: the underlying attempt keeps
 * running (its token application is still generation-guarded), but the caller
 * — a background task the OS may kill at any moment — is never left hanging.
 */
async function withTimeout(
  promise: Promise<SessionRecoveryResult>,
  timeoutMs: number,
  startedIn: number,
): Promise<SessionRecoveryResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SessionRecoveryResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: 'timeout',
          accessToken: null,
          user: null,
          shared: false,
          reason: 'timed-out',
          generation: startedIn,
        }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
