/**
 * Durable **tracking stats** — the newest fix this device produced and the
 * newest server acknowledgement — as pure logic.
 *
 * ### The lie this removes
 *
 * `tracking-lifecycle.ts` kept `lastFix` / `lastAckAt` in memory only. An app
 * restart therefore reset them, and the driver map's panel said
 * *"No fix from this device yet."* while the server was holding fixes this
 * very phone had sent two minutes earlier (P2-7). The sentence was false, it
 * was the most alarming thing on the screen, and nothing on the screen could
 * make it go away except waiting for the next fix.
 *
 * Persisting the two values with their **original timestamps** is what fixes
 * it: `deriveCrewTrackingStatus` then ages them exactly as it would have if
 * the process had never died, so a restored fix reads "last known, 3 min ago"
 * — never "live", and never "no fix".
 *
 * ### The three rules that keep a restored fix honest
 *
 * 1. **Scoped to the trip.** A stored fix carries the `tripId` it was measured
 *    on and is refused for any other trip. A position from this morning's run
 *    must never appear as this afternoon's bus — the marker is the one thing
 *    on the screen a driver reads as "where I am *now*".
 * 2. **Scoped to the account** (`userId` / `schoolId`), the same ownership
 *    check `tracking-context.ts` applies: a handed-over phone or a different
 *    login resumes nothing.
 * 3. **Bounded by age.** Past {@link PERSISTED_FIX_MAX_AGE_MS} the record is
 *    dropped rather than restored. The status derivation would age it into
 *    "stale" anyway; refusing it up front means a day-old coordinate is never
 *    even drawn.
 *
 * Nothing secret is stored: a coordinate this device produced, its accuracy,
 * heading and speed, and two timestamps. No token, no PIN.
 */

/** AsyncStorage key. Separate from the context so either can be dropped alone. */
export const CREW_TRACKING_STATS_KEY = '@sbt/crew-tracking-stats';

/**
 * Oldest record that may be restored.
 *
 * Matched to `TRACKING_CONTEXT_MAX_AGE_MS` (12 h) on purpose: the context is
 * what makes a trip resumable at all, so a fix that outlives it could only
 * ever be restored next to a trip the lifecycle has already forgotten.
 */
export const PERSISTED_FIX_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * How often the record may be rewritten.
 *
 * Fixes arrive every ~4 s and the publish throttle already reduces that to
 * ~10 s of UI updates; writing AsyncStorage on each one would be a disk write
 * per fix for a value only read once per process. 10 s bounds the worst-case
 * loss to one fix, which the status line describes accurately anyway.
 */
export const STATS_PERSIST_MIN_INTERVAL_MS = 10_000;

/** The fix shape the lifecycle publishes (`CrewLocationStats['lastFix']`). */
export interface PersistedDeviceFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** ISO-8601 device time — restored as-is so freshness stays honest. */
  recorded_at: string;
  heading: number | null;
  speed: number | null;
  mocked: boolean;
}

export interface PersistedTrackingStats {
  userId: string;
  schoolId: string | null;
  tripId: string;
  lastFix: PersistedDeviceFix | null;
  /** Server receipt time of the newest acknowledged fix. */
  lastAckAt: string | null;
  /** ISO-8601 device time the record was written. */
  updatedAt: string;
}

export type TrackingStatsDecision =
  /** Nothing was persisted. */
  | 'none'
  /** Unreadable/unknown shape — dropped, never guessed. */
  | 'corrupt'
  /** No session to check ownership against. */
  | 'no-session'
  | 'other-user'
  | 'other-school'
  /** Belongs to a different trip: it must not be drawn on this one. */
  | 'other-trip'
  /** Older than {@link PERSISTED_FIX_MAX_AGE_MS}. */
  | 'expired'
  /** Ownership, trip and freshness all check out. */
  | 'restore';

export interface TrackingStatsRestore {
  decision: TrackingStatsDecision;
  /** The parsed record (when it parsed), whatever the decision. */
  stats: PersistedTrackingStats | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/** Parses a stored fix; `null` for anything that is not exactly this shape. */
export function parsePersistedFix(value: unknown): PersistedDeviceFix | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.latitude) || !isFiniteNumber(record.longitude)) return null;
  if (!isIsoTimestamp(record.recorded_at)) return null;
  return {
    latitude: record.latitude,
    longitude: record.longitude,
    accuracy: nullableNumber(record.accuracy),
    recorded_at: record.recorded_at,
    heading: nullableNumber(record.heading),
    speed: nullableNumber(record.speed),
    mocked: record.mocked === true,
  };
}

export function parsePersistedTrackingStats(
  raw: string | null | undefined,
): PersistedTrackingStats | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const { userId, tripId, updatedAt, schoolId, lastAckAt } = record;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (typeof tripId !== 'string' || tripId.length === 0) return null;
  if (!isIsoTimestamp(updatedAt)) return null;

  const lastFix = parsePersistedFix(record.lastFix);
  const ack = isIsoTimestamp(lastAckAt) ? lastAckAt : null;
  // A record with neither half carries no information; treating it as corrupt
  // keeps "restore" meaning "there is something to show".
  if (!lastFix && !ack) return null;

  return {
    userId,
    tripId,
    updatedAt,
    schoolId: typeof schoolId === 'string' && schoolId.length > 0 ? schoolId : null,
    lastFix,
    lastAckAt: ack,
  };
}

export function serializePersistedTrackingStats(stats: PersistedTrackingStats): string {
  return JSON.stringify(stats);
}

/** Builds the record for the current lifecycle state, stamped with `now`. */
export function createPersistedTrackingStats(input: {
  userId: string;
  schoolId: string | null;
  tripId: string;
  lastFix: PersistedDeviceFix | null;
  lastAckAt: string | null;
  now: number;
}): PersistedTrackingStats {
  return {
    userId: input.userId,
    schoolId: input.schoolId,
    tripId: input.tripId,
    lastFix: input.lastFix,
    lastAckAt: input.lastAckAt,
    updatedAt: new Date(input.now).toISOString(),
  };
}

/**
 * Decides whether a persisted record may be restored **for this session and
 * this trip**.
 *
 * Ownership is checked before the trip and the trip before the age, so the
 * reported reason is the most security-relevant true one — the same ordering
 * `decideTrackingContextRestore` uses, and for the same reason: the decision
 * is data the caller logs and acts on.
 */
export function decidePersistedStatsRestore(input: {
  raw: string | null | undefined;
  session: { id: string; school_id: string | null } | null;
  /** The trip the lifecycle is actually on; `null` restores nothing. */
  tripId: string | null;
  now?: number;
  maxAgeMs?: number;
}): TrackingStatsRestore {
  const raw = input.raw ?? null;
  if (raw === null || raw.trim().length === 0) return { decision: 'none', stats: null };

  const stats = parsePersistedTrackingStats(raw);
  if (!stats) return { decision: 'corrupt', stats: null };
  if (!input.session) return { decision: 'no-session', stats };
  if (input.session.id !== stats.userId) return { decision: 'other-user', stats };
  if (
    stats.schoolId !== null &&
    input.session.school_id !== null &&
    stats.schoolId !== input.session.school_id
  ) {
    return { decision: 'other-school', stats };
  }
  // No trip, or another trip: the position belongs to a run that is not on
  // screen, and drawing it would be the worst failure this module can have.
  if (!input.tripId || input.tripId !== stats.tripId) {
    return { decision: 'other-trip', stats };
  }

  const maxAgeMs = input.maxAgeMs ?? PERSISTED_FIX_MAX_AGE_MS;
  const now = input.now ?? Date.now();
  // Age is measured on the *fix*, not on the write: a record rewritten by a
  // late acknowledgement must not make an old coordinate look recent.
  const stamps = [stats.lastFix?.recorded_at, stats.lastAckAt, stats.updatedAt].filter(
    (value): value is string => typeof value === 'string',
  );
  const newest = Math.max(...stamps.map((value) => new Date(value).getTime()));
  if (!Number.isFinite(newest) || now - newest > maxAgeMs) {
    return { decision: 'expired', stats };
  }

  return { decision: 'restore', stats };
}

/** The part of the lifecycle's stats this module stores. */
export interface TrackingStatsSnapshot {
  tripId: string | null;
  lastFixRecordedAt: string | null;
  lastAckAt: string | null;
}

/**
 * Whether the record is worth rewriting right now.
 *
 * Four rules, in order:
 *
 * 1. nothing to store (no fix, no acknowledgement) → no;
 * 2. a **different trip** → yes, immediately: the stored record would
 *    otherwise name the wrong run, which is the one state this module must
 *    never be in, even for ten seconds;
 * 3. nothing changed → no (a re-publish is not new information);
 * 4. otherwise throttle to {@link STATS_PERSIST_MIN_INTERVAL_MS}.
 */
export function shouldPersistTrackingStats(input: {
  /** What was last written, or `null` when nothing has been. */
  written: TrackingStatsSnapshot | null;
  next: TrackingStatsSnapshot;
  /** Device time of the last write; `null` when nothing has been written. */
  writtenAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const { written, next } = input;
  if (!next.tripId) return false;
  if (!next.lastFixRecordedAt && !next.lastAckAt) return false;
  if (!written || written.tripId !== next.tripId) return true;
  if (
    written.lastFixRecordedAt === next.lastFixRecordedAt &&
    written.lastAckAt === next.lastAckAt
  ) {
    return false;
  }
  const minIntervalMs = input.minIntervalMs ?? STATS_PERSIST_MIN_INTERVAL_MS;
  if (input.writtenAt === null) return true;
  return input.now - input.writtenAt >= minIntervalMs;
}
