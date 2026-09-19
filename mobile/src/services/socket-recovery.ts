import type { TripLocationUpdateAck } from '@school-bus-tracking/shared-types';

/**
 * Recovery policy for the crew GPS socket: **bounded**, classified and
 * explicitly cancellable.
 *
 * Socket.IO's own `reconnection: true` (see `./socket-options.ts`) already
 * covers transient transport loss while the process lives. What it cannot do
 * is distinguish a network blip from an *authorization* failure:
 *
 * - the gateways refuse a handshake with no/expired JWT by calling
 *   `client.disconnect(true)`, which the client observes as
 *   `io server disconnect` — and Socket.IO deliberately **does not
 *   auto-reconnect** after a server-initiated disconnect;
 * - the session-revalidation sweep emits `session:revoked` with a reason and
 *   then force-disconnects (`token_expired` is recoverable with a fresh token,
 *   `school_deactivated` / `user_deactivated` are permanent for this account);
 * - a `transport close` / `ping timeout` is plain network loss.
 *
 * This module turns those signals into one decision — retry (and how long to
 * wait), refresh-then-retry, or stop for good — so the tracking controller
 * never retries an unauthorized socket in a tight loop and never gives up on a
 * recoverable one. It is pure and native-free, so every branch is unit-tested.
 */

/** Event the server emits right before force-disconnecting a socket. */
export const SESSION_REVOKED_EVENT = 'session:revoked';

/** Reasons the session-revalidation sweep sends with `session:revoked`. */
export type SessionRevokedReason = 'token_expired' | 'school_deactivated' | 'user_deactivated';

export type SocketDisconnectClass =
  /** We called `disconnect()` (logout / stop) — never retry. */
  | 'client-stop'
  /** Handshake refused or the access token expired — refresh, then reconnect. */
  | 'auth-expired'
  /** Tenant/user deactivated — access is permanently gone for this account. */
  | 'auth-revoked'
  /** Transport loss while the process lives — Socket.IO/backoff retries. */
  | 'network'
  /** Unclassified disconnect; treated like network loss, still bounded. */
  | 'unknown';

/**
 * Classifies a Socket.IO disconnect into a recovery decision class.
 *
 * `reason` is the string Socket.IO hands to the `disconnect` listener;
 * `revokedReason` is the payload of a `session:revoked` event seen on the same
 * socket just before it (tracked by the caller — the server sends it first).
 */
export function classifySocketDisconnect(input: {
  reason?: string | null;
  revokedReason?: string | null;
}): SocketDisconnectClass {
  const reason = input.reason ?? null;
  const revoked = input.revokedReason ?? null;

  if (reason === 'io client disconnect') {
    return 'client-stop';
  }
  if (reason === 'io server disconnect') {
    if (revoked === 'school_deactivated' || revoked === 'user_deactivated') {
      return 'auth-revoked';
    }
    // `token_expired`, or a handshake the gateway refused outright (missing /
    // invalid / expired JWT): both need a fresh token before reconnecting.
    return 'auth-expired';
  }
  if (reason === 'transport close' || reason === 'transport error' || reason === 'ping timeout') {
    return 'network';
  }
  return 'unknown';
}

/** True when a disconnect class justifies another (bounded) attempt. */
export function isRetryableDisconnect(kind: SocketDisconnectClass): boolean {
  return kind === 'network' || kind === 'unknown' || kind === 'auth-expired';
}

/** True when the class means "refresh the session before reconnecting". */
export function needsSessionRefresh(kind: SocketDisconnectClass): boolean {
  return kind === 'auth-expired';
}

/** Configuration of the bounded exponential backoff. */
export interface RecoveryPolicyConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Hard cap on consecutive attempts; `null` would mean "forever" — never used. */
  maxAttempts: number;
  factor: number;
}

/**
 * Crew GPS recovery budget: 1 s → 2 s → 4 s → 8 s → 16 s → 20 s, then stop.
 *
 * Six attempts (~51 s of trying) is long enough to ride out a lift, a tunnel
 * or a token rotation, and short enough that a revoked or misconfigured socket
 * stops burning radio and battery instead of retrying forever. A new fix, a
 * trip start or an explicit user Retry resets the budget.
 */
export const TRACKING_RECOVERY_POLICY: RecoveryPolicyConfig = {
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
  maxAttempts: 6,
  factor: 2,
};

/** Delay before attempt `attempt` (1-based), capped at `maxDelayMs`. */
export function recoveryDelayMs(attempt: number, config: RecoveryPolicyConfig): number {
  if (!Number.isFinite(attempt) || attempt <= 0) {
    return config.baseDelayMs;
  }
  const raw = config.baseDelayMs * Math.pow(config.factor, attempt - 1);
  return Math.min(Math.round(raw), config.maxDelayMs);
}

export interface RecoveryAttempt {
  /** 1-based attempt number. */
  attempt: number;
  delayMs: number;
}

export interface RecoveryPolicy {
  /** Next attempt, or `null` once the budget is exhausted (stop retrying). */
  next(): RecoveryAttempt | null;
  /** The attempt count so far. */
  readonly attempts: number;
  /** True when no further attempt will be scheduled without a `reset()`. */
  readonly exhausted: boolean;
  /** Clears the budget: new fix, trip start, explicit user retry. */
  reset(): void;
}

/** Creates one bounded backoff budget (never infinite, never zero-delay). */
export function createRecoveryPolicy(
  config: RecoveryPolicyConfig = TRACKING_RECOVERY_POLICY,
): RecoveryPolicy {
  let attempts = 0;
  return {
    next(): RecoveryAttempt | null {
      if (attempts >= config.maxAttempts) {
        return null;
      }
      attempts += 1;
      return { attempt: attempts, delayMs: recoveryDelayMs(attempts, config) };
    },
    get attempts(): number {
      return attempts;
    },
    get exhausted(): boolean {
      return attempts >= config.maxAttempts;
    },
    reset(): void {
      attempts = 0;
    },
  };
}

/** What a `trip:location:update` ack means for the tracking controller. */
export type LocationAckClass =
  /** Stored by the server: this is a real, server-acknowledged update. */
  | 'accepted'
  /** Stored, but an older/equal timestamp — it did not move the live position. */
  | 'accepted-stale'
  /** Server-side rate limit: drop this fix, keep streaming. */
  | 'throttled'
  /** The session behind the socket is no longer valid: refresh + reconnect. */
  | 'session'
  /** Not allowed / trip no longer open: stop tracking, do not retry. */
  | 'permanent'
  /** The payload itself was unusable: drop the fix, do not retry it. */
  | 'invalid';

/**
 * Maps a server ack onto a recovery class.
 *
 * Only `accepted` / `accepted-stale` mean the school can see the position —
 * every UI claim about "live" tracking is derived from that, never from the
 * device having obtained a local fix.
 */
export function classifyLocationAck(ack: TripLocationUpdateAck): LocationAckClass {
  if (ack.status === 'accepted') {
    return ack.stale === true ? 'accepted-stale' : 'accepted';
  }
  switch (ack.reason) {
    case 'throttled':
      return 'throttled';
    case 'unauthenticated':
      return 'session';
    case 'unauthorized':
    case 'trip_not_found':
    case 'trip_not_open':
      return 'permanent';
    default:
      return 'invalid';
  }
}

/** True when a rejection means this account may no longer track this trip. */
export function isPermanentLocationRejection(kind: LocationAckClass): boolean {
  return kind === 'permanent';
}

/**
 * Minimal socket surface the bounded connect wait needs. Declared
 * structurally so it is testable with a fake and satisfied by a
 * `socket.io-client` socket.
 */
export interface RecoverableSocket {
  connected: boolean;
  connect(): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface SocketConnectWaitResult {
  connected: boolean;
  /** True when the bound elapsed without a `connect`. */
  timedOut: boolean;
  /** First `connect_error` message seen, when any (never a token). */
  error: string | null;
}

/**
 * Requests a connection and waits **at most** `timeoutMs` for it.
 *
 * A background task must never hang on a socket that will not connect: the
 * wait is bounded, listeners are always removed, and the caller decides what a
 * failure means (backoff, refresh, or give up for this execution).
 */
export async function connectSocketWithBound(
  socket: RecoverableSocket,
  options: { timeoutMs: number },
): Promise<SocketConnectWaitResult> {
  if (socket.connected) {
    return { connected: true, timedOut: false, error: null };
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 0;
  let onConnect: (() => void) | null = null;
  let onError: ((...args: unknown[]) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<SocketConnectWaitResult>((resolve) => {
      const finish = (result: SocketConnectWaitResult): void => {
        resolve(result);
      };
      let firstError: string | null = null;

      onConnect = () => finish({ connected: true, timedOut: false, error: firstError });
      onError = (...args: unknown[]) => {
        const raw = args[0];
        firstError = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : null;
      };

      socket.on('connect', onConnect);
      socket.on('connect_error', onError);

      if (timeoutMs > 0) {
        timer = setTimeout(
          () => finish({ connected: socket.connected, timedOut: true, error: firstError }),
          timeoutMs,
        );
      }

      try {
        socket.connect();
      } catch {
        finish({ connected: false, timedOut: false, error: 'connect-threw' });
      }
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (onConnect) {
      socket.off('connect', onConnect);
    }
    if (onError) {
      socket.off('connect_error', onError);
    }
  }
}

/**
 * Waits **at most** `timeoutMs` for an emit acknowledgement.
 *
 * `emit` is injected so the wait stays testable and so the caller keeps owning
 * the payload. A missing ack inside the bound is reported as `null`, never as
 * an accepted update: an unacknowledged fix is not proof the school saw it.
 */
export async function emitWithAckBound<T>(
  emit: (ack: (value: T) => void) => void,
  timeoutMs: number,
): Promise<{ ack: T | null; timedOut: boolean }> {
  const bound = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ack = await new Promise<T | null>((resolve) => {
      if (bound > 0) {
        timer = setTimeout(() => resolve(null), bound);
      }
      try {
        emit((value: T) => resolve(value));
      } catch {
        resolve(null);
      }
    });
    return { ack, timedOut: ack === null };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
