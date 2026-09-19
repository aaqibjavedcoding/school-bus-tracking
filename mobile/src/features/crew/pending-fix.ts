import type { TripLocationUpdatePayload } from '@school-bus-tracking/shared-types';

/**
 * The **bounded, latest-fresh-fix** retry policy for crew GPS.
 *
 * Before this patch a fix that arrived while the socket was down was dropped
 * outright — honest, but it meant a short tunnel or a token rotation cost the
 * school several seconds of position with no retry at all. This module adds
 * recovery without ever turning into an offline route-history subsystem:
 *
 * - **capacity 1, per trip**: only the newest fix is held. An older held fix
 *   is replaced, a fix for another trip is discarded. There is no queue, so
 *   there is nothing to grow and nothing to replay in a burst;
 * - **explicit age limit**: a fix older than {@link PENDING_FIX_MAX_AGE_MS} is
 *   never retried. Live tracking and stop-proximity are about *where the bus is
 *   now* — the server rejects stale fixes for arrivals/ETA anyway (see the
 *   Phase-1 freshness rules), and replaying one as current would be a lie;
 * - **stable idempotency**: the key is minted once, when the fix is captured,
 *   and reused on every retry, so a retry whose ack was lost in transit cannot
 *   insert a second `trip_locations` row;
 * - **original timestamps preserved**: the payload keeps the device's
 *   `recorded_at`; a retry never re-stamps a fix as fresh;
 * - **explicit attempt bound**: {@link PENDING_FIX_MAX_ATTEMPTS} per fix, then
 *   it is dropped and counted.
 *
 * Every discard is counted (`expiredCount`, `discardedStaleCount`,
 * `discardedTripCount`, `exhaustedCount`) so the Help screen and the tests can
 * report exactly how much was thrown away and why.
 *
 * **Documented limitation**: this is *not* offline route history. A long
 * offline stretch still loses the intermediate fixes — only the newest one
 * within the age window is retried on reconnect.
 */

/** Age beyond which a held fix is expired and must never be replayed. */
export const PENDING_FIX_MAX_AGE_MS = 90_000;

/** Send attempts for one held fix before it is dropped (counted). */
export const PENDING_FIX_MAX_ATTEMPTS = 3;

/**
 * How far ahead of the receive clock a device timestamp may be.
 *
 * A phone whose clock runs slightly fast must not have every fix discarded as
 * "from the future" — the server allows the same skew on ingest. Beyond this
 * bound the reading is a broken clock, not a live position, and is dropped.
 */
export const PENDING_FIX_FUTURE_TOLERANCE_MS = 60_000;

export interface PendingFixEntry {
  tripId: string;
  payload: TripLocationUpdatePayload;
  /** Minted once at capture time; stable across every retry. */
  idempotencyKey: string;
  /** Device time of the fix (ms epoch) — the payload's own `recorded_at`. */
  recordedAtMs: number;
  attempts: number;
  queuedAtMs: number;
}

export interface PendingFixCounters {
  /** Fixes captured for a later retry. */
  capturedCount: number;
  /** Held fixes replaced by a newer one. */
  replacedCount: number;
  /** Fixes discarded at capture because they were already too old. */
  discardedStaleCount: number;
  /** Fixes discarded because they belonged to another trip. */
  discardedTripCount: number;
  /** Fixes discarded because they were older than the held one. */
  discardedOlderCount: number;
  /** Retries actually performed. */
  retriedCount: number;
  /** Held fixes dropped at retry time for exceeding the age limit. */
  expiredCount: number;
  /** Held fixes dropped after the attempt bound. */
  exhaustedCount: number;
  /** Held fixes cleared by a server acknowledgement. */
  acknowledgedCount: number;
}

export interface PendingFixState extends PendingFixCounters {
  /** The one held fix, or `null`. */
  fix: PendingFixEntry | null;
}

export const initialPendingFixState: PendingFixState = {
  fix: null,
  capturedCount: 0,
  replacedCount: 0,
  discardedStaleCount: 0,
  discardedTripCount: 0,
  discardedOlderCount: 0,
  retriedCount: 0,
  expiredCount: 0,
  exhaustedCount: 0,
  acknowledgedCount: 0,
};

export type PendingFixOfferAction =
  | 'captured'
  | 'replaced'
  | 'discarded-stale'
  | 'discarded-trip'
  | 'discarded-older'
  | 'unchanged';

export interface PendingFixOffer {
  state: PendingFixState;
  action: PendingFixOfferAction;
}

/** Age of a fix in ms from its own `recorded_at` (device clock). */
function payloadAgeMs(payload: TripLocationUpdatePayload, now: number): number {
  const recorded = new Date(payload.recorded_at).getTime();
  if (!Number.isFinite(recorded)) {
    return Number.POSITIVE_INFINITY;
  }
  return now - recorded;
}

/**
 * Offers a fix that could not be delivered right now.
 *
 * The newest fix for the tracked trip wins; everything else is counted and
 * dropped. `maxAgeMs` is applied at capture time so an already-stale fix never
 * even enters the slot.
 */
export function offerPendingFix(
  state: PendingFixState,
  input: {
    tripId: string;
    payload: TripLocationUpdatePayload;
    idempotencyKey: string;
    now: number;
    maxAgeMs?: number;
  },
): PendingFixOffer {
  const maxAgeMs = input.maxAgeMs ?? PENDING_FIX_MAX_AGE_MS;

  if (input.tripId !== state.fix?.tripId && state.fix !== null) {
    // A fix for a different trip must never be replayed onto the tracked one.
    return {
      state: { ...state, discardedTripCount: state.discardedTripCount + 1 },
      action: 'discarded-trip',
    };
  }

  const ageMs = payloadAgeMs(input.payload, input.now);
  if (
    !Number.isFinite(ageMs) ||
    ageMs > maxAgeMs ||
    ageMs < -PENDING_FIX_FUTURE_TOLERANCE_MS
  ) {
    return {
      state: { ...state, discardedStaleCount: state.discardedStaleCount + 1 },
      action: 'discarded-stale',
    };
  }

  const held = state.fix;
  if (held && held.idempotencyKey === input.idempotencyKey) {
    return { state, action: 'unchanged' };
  }

  const entry: PendingFixEntry = {
    tripId: input.tripId,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    recordedAtMs: new Date(input.payload.recorded_at).getTime(),
    attempts: 0,
    queuedAtMs: input.now,
  };

  if (held && held.recordedAtMs >= entry.recordedAtMs) {
    // Never replace a newer held fix with an older one.
    return {
      state: { ...state, discardedOlderCount: state.discardedOlderCount + 1 },
      action: 'discarded-older',
    };
  }

  return {
    state: {
      ...state,
      fix: entry,
      capturedCount: state.capturedCount + 1,
      replacedCount: held ? state.replacedCount + 1 : state.replacedCount,
    },
    action: held ? 'replaced' : 'captured',
  };
}

export type PendingFixTakeAction =
  | 'retry'
  | 'empty'
  | 'expired'
  | 'exhausted'
  | 'other-trip';

export interface PendingFixTake {
  state: PendingFixState;
  /** The fix to (re)send, or `null` when nothing may be sent. */
  fix: PendingFixEntry | null;
  action: PendingFixTakeAction;
}

/**
 * Takes the held fix for one send attempt, or explains why nothing is sent.
 *
 * Taking consumes an attempt, so a caller that fails to send must not loop: the
 * bound is what stops a dead socket from being hammered.
 */
export function takePendingFix(
  state: PendingFixState,
  input: { tripId: string; now: number; maxAgeMs?: number; maxAttempts?: number },
): PendingFixTake {
  const maxAgeMs = input.maxAgeMs ?? PENDING_FIX_MAX_AGE_MS;
  const maxAttempts = input.maxAttempts ?? PENDING_FIX_MAX_ATTEMPTS;
  const held = state.fix;

  if (!held) {
    return { state, fix: null, action: 'empty' };
  }
  if (held.tripId !== input.tripId) {
    // The tracked trip changed: drop the old trip's fix, never replay it.
    return {
      state: { ...state, fix: null, discardedTripCount: state.discardedTripCount + 1 },
      fix: null,
      action: 'other-trip',
    };
  }
  const ageMs = input.now - held.recordedAtMs;
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    return {
      state: { ...state, fix: null, expiredCount: state.expiredCount + 1 },
      fix: null,
      action: 'expired',
    };
  }
  if (held.attempts >= maxAttempts) {
    return {
      state: { ...state, fix: null, exhaustedCount: state.exhaustedCount + 1 },
      fix: null,
      action: 'exhausted',
    };
  }

  return {
    state: { ...state, fix: { ...held, attempts: held.attempts + 1 }, retriedCount: state.retriedCount + 1 },
    fix: { ...held, attempts: held.attempts + 1 },
    action: 'retry',
  };
}

/**
 * Clears the held fix after the server acknowledged it.
 *
 * Keyed on the idempotency key: an ack for an older attempt (arriving late,
 * after a newer fix replaced the slot) must not wipe the newer one.
 */
export function acknowledgePendingFix(
  state: PendingFixState,
  idempotencyKey: string,
): PendingFixState {
  if (!state.fix || state.fix.idempotencyKey !== idempotencyKey) {
    return state;
  }
  return {
    ...state,
    fix: null,
    acknowledgedCount: state.acknowledgedCount + 1,
  };
}

/** True when a held fix exists for `tripId` and is still inside its age limit. */
export function hasRetryablePendingFix(
  state: PendingFixState,
  input: { tripId: string; now: number; maxAgeMs?: number },
): boolean {
  const held = state.fix;
  if (!held || held.tripId !== input.tripId) {
    return false;
  }
  const maxAgeMs = input.maxAgeMs ?? PENDING_FIX_MAX_AGE_MS;
  return input.now - held.recordedAtMs <= maxAgeMs;
}

/** Drops everything (logout, stop, trip change): never carries across accounts. */
export function clearPendingFix(state: PendingFixState): PendingFixState {
  return { ...state, fix: null };
}
