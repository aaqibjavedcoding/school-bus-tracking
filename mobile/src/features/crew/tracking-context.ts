/**
 * Durable tracking context for the headless background task (pure logic).
 *
 * The OS can relaunch the app **headlessly** to run the crew location task: a
 * fresh JS process, no React screen, an empty in-memory access token. To send
 * anything useful that process must know *which* trip it is tracking — and it
 * must be able to prove the trip still belongs to the account whose session it
 * just recovered.
 *
 * What is persisted, and what never is:
 *
 * - **persisted**: `userId`, `schoolId`, `tripId`, `updatedAt` — non-secret
 *   identifiers, all of which the server re-authorizes on every request and
 *   every socket handshake anyway;
 * - **never persisted**: the access token (memory only), the refresh token
 *   (httpOnly cookie in the platform jar), any password or PIN.
 *
 * Ownership is checked at restore time, not at write time: a device handed to
 * another crew member, or a logout followed by a different login, must never
 * resume the previous account's trip. {@link decideTrackingContextRestore}
 * returns the reason as data so the controller can report honestly.
 */

/** AsyncStorage key. Deliberately distinct from the legacy bare-trip-id key. */
export const CREW_TRACKING_CONTEXT_KEY = '@sbt/crew-tracking-context';

/**
 * Legacy key written before this patch held a bare trip id with **no owner**,
 * so it could survive a logout and be resumed by the next account. It is read
 * once (only to delete it) and never trusted.
 */
export const LEGACY_CREW_ACTIVE_TRIP_KEY = '@sbt/crew-active-trip-id';

/**
 * A context older than this is not resumed: a trip cannot legitimately stay
 * `BOARDING`/`IN_PROGRESS` for half a day, and a stale id would only produce
 * `trip_not_open` rejections. The server remains the authority — this bound
 * exists so a headless process does not even try.
 */
export const TRACKING_CONTEXT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CrewTrackingContext {
  userId: string;
  schoolId: string | null;
  tripId: string;
  /** ISO-8601 device time the context was written. */
  updatedAt: string;
}

/** The session identity a restore is checked against. */
export interface TrackingContextSession {
  id: string;
  school_id: string | null;
}

export type TrackingContextDecision =
  /** Nothing was persisted (normal cold start with no tracking running). */
  | 'none'
  /** Persisted value was unreadable/corrupt — dropped, never guessed. */
  | 'corrupt'
  /** No session was recovered, so ownership cannot be proven — do not resume. */
  | 'no-session'
  /** The context belongs to a different user — never resume it. */
  | 'other-user'
  /** The context belongs to a different school/tenant — never resume it. */
  | 'other-school'
  /** The context is older than {@link TRACKING_CONTEXT_MAX_AGE_MS}. */
  | 'expired'
  /** Ownership and freshness verified: the trip may be resumed. */
  | 'resume';

export interface TrackingContextRestore {
  decision: TrackingContextDecision;
  /** The parsed context (when it parsed), regardless of the decision. */
  context: CrewTrackingContext | null;
}

/** Serialises the context; stable shape, no secrets. */
export function serializeCrewTrackingContext(context: CrewTrackingContext): string {
  return JSON.stringify({
    userId: context.userId,
    schoolId: context.schoolId,
    tripId: context.tripId,
    updatedAt: context.updatedAt,
  });
}

/** Builds a context stamped with `now` (ISO-8601). */
export function createCrewTrackingContext(input: {
  userId: string;
  schoolId: string | null;
  tripId: string;
  now: number;
}): CrewTrackingContext {
  return {
    userId: input.userId,
    schoolId: input.schoolId,
    tripId: input.tripId,
    updatedAt: new Date(input.now).toISOString(),
  };
}

/**
 * Parses a persisted context. Returns `null` for anything that is not exactly
 * this shape — including the legacy bare trip id, which carried no owner and
 * is therefore treated as corrupt rather than resumable.
 */
export function parseCrewTrackingContext(raw: string | null | undefined): CrewTrackingContext | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const userId = record.userId;
  const tripId = record.tripId;
  const updatedAt = record.updatedAt;
  const schoolId = record.schoolId;
  if (typeof userId !== 'string' || userId.length === 0) {
    return null;
  }
  if (typeof tripId !== 'string' || tripId.length === 0) {
    return null;
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(new Date(updatedAt).getTime())) {
    return null;
  }
  return {
    userId,
    tripId,
    updatedAt,
    schoolId: typeof schoolId === 'string' && schoolId.length > 0 ? schoolId : null,
  };
}

/**
 * Decides whether a persisted context may be resumed by *this* session.
 *
 * The order matters: ownership is checked before freshness, so a wrong-user
 * context is reported as `other-user` (a security-relevant fact) rather than
 * being quietly dropped as `expired`.
 */
export function decideTrackingContextRestore(input: {
  raw: string | null | undefined;
  session: TrackingContextSession | null;
  now?: number;
  maxAgeMs?: number;
}): TrackingContextRestore {
  const raw = input.raw ?? null;
  if (raw === null || raw.trim().length === 0) {
    return { decision: 'none', context: null };
  }
  const context = parseCrewTrackingContext(raw);
  if (!context) {
    return { decision: 'corrupt', context: null };
  }
  if (!input.session) {
    return { decision: 'no-session', context };
  }
  if (input.session.id !== context.userId) {
    return { decision: 'other-user', context };
  }
  if (
    context.schoolId !== null &&
    input.session.school_id !== null &&
    context.schoolId !== input.session.school_id
  ) {
    return { decision: 'other-school', context };
  }
  const maxAgeMs = input.maxAgeMs ?? TRACKING_CONTEXT_MAX_AGE_MS;
  const ageMs = (input.now ?? Date.now()) - new Date(context.updatedAt).getTime();
  if (ageMs > maxAgeMs) {
    return { decision: 'expired', context };
  }
  return { decision: 'resume', context };
}
