import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TripLocationUpdatePayload } from '@school-bus-tracking/shared-types';
import {
  PENDING_FIX_FUTURE_TOLERANCE_MS,
  PENDING_FIX_MAX_AGE_MS,
  PENDING_FIX_MAX_ATTEMPTS,
  acknowledgePendingFix,
  clearPendingFix,
  hasRetryablePendingFix,
  initialPendingFixState,
  offerPendingFix,
  takePendingFix,
} from './pending-fix.ts';

/**
 * The bounded latest-fresh-fix retry policy.
 *
 * The invariants that matter: there is never more than one held fix, a held fix
 * keeps its original device timestamp and its original idempotency key across
 * retries, an expired fix is counted and dropped instead of being replayed as a
 * current position, and every discard is reported.
 */

const NOW = Date.parse('2026-09-19T08:00:00.000Z');

function payload(recordedAtMs: number, tripId = 'trip-1'): TripLocationUpdatePayload {
  return {
    trip_id: tripId,
    latitude: 21.1458,
    longitude: 79.0882,
    recorded_at: new Date(recordedAtMs).toISOString(),
    accuracy: 8,
  };
}

function offer(
  state = initialPendingFixState,
  recordedAtMs = NOW,
  options: { key?: string; tripId?: string; now?: number } = {},
) {
  const p = payload(recordedAtMs, options.tripId ?? 'trip-1');
  return {
    payload: p,
    result: offerPendingFix(state, {
      tripId: options.tripId ?? 'trip-1',
      payload: p,
      idempotencyKey: options.key ?? `key-${recordedAtMs}`,
      // The clock defaults to the fix's own time: a fix is normally offered the
      // moment the device produced it.
      now: options.now ?? Math.max(NOW, recordedAtMs),
    }),
  };
}

describe('offerPendingFix', () => {
  it('captures a fresh fix when the slot is empty', () => {
    const { result } = offer();
    assert.equal(result.action, 'captured');
    assert.equal(result.state.fix?.idempotencyKey, `key-${NOW}`);
    assert.equal(result.state.capturedCount, 1);
  });

  it('holds exactly one fix: a newer one replaces the older', () => {
    const first = offer();
    const second = offer(first.result.state, NOW + 4_000);
    assert.equal(second.result.action, 'replaced');
    assert.equal(second.result.state.fix?.recordedAtMs, NOW + 4_000);
    assert.equal(second.result.state.replacedCount, 1);
    assert.equal(second.result.state.capturedCount, 2);
    assert.ok(second.result.state.fix, 'the slot never holds a list — capacity is 1');
  });

  it('never lets an older fix displace a newer one', () => {
    const newest = offer(initialPendingFixState, NOW + 10_000);
    const older = offer(newest.result.state, NOW);
    assert.equal(older.result.action, 'discarded-older');
    assert.equal(older.result.state.fix?.recordedAtMs, NOW + 10_000);
    assert.equal(older.result.state.discardedOlderCount, 1);
  });

  it('discards a fix that is already too old to be a live position', () => {
    const { result } = offer(initialPendingFixState, NOW - PENDING_FIX_MAX_AGE_MS - 1);
    assert.equal(result.action, 'discarded-stale');
    assert.equal(result.state.fix, null);
    assert.equal(result.state.discardedStaleCount, 1);
  });

  it('tolerates a slightly fast device clock but not a broken one', () => {
    const slightlyFast = offerPendingFix(initialPendingFixState, {
      tripId: 'trip-1',
      payload: payload(NOW + 30_000),
      idempotencyKey: 'key-fast',
      now: NOW,
    });
    assert.equal(slightlyFast.action, 'captured');

    const broken = offerPendingFix(initialPendingFixState, {
      tripId: 'trip-1',
      payload: payload(NOW + PENDING_FIX_FUTURE_TOLERANCE_MS + 60_000),
      idempotencyKey: 'key-broken',
      now: NOW,
    });
    assert.equal(broken.action, 'discarded-stale');
    assert.equal(broken.state.discardedStaleCount, 1);
  });

  it('never mixes another trip’s fix into the held slot', () => {
    const held = offer(initialPendingFixState, NOW, { tripId: 'trip-1' });
    const foreign = offer(held.result.state, NOW + 1_000, { tripId: 'trip-2' });
    assert.equal(foreign.result.action, 'discarded-trip');
    assert.equal(foreign.result.state.fix?.tripId, 'trip-1');
    assert.equal(foreign.result.state.discardedTripCount, 1);
  });

  it('is idempotent for the same fix (a redelivered task execution)', () => {
    const first = offer(initialPendingFixState, NOW, { key: 'key-a' });
    const again = offer(first.result.state, NOW, { key: 'key-a' });
    assert.equal(again.result.action, 'unchanged');
    assert.equal(again.result.state.capturedCount, 1);
  });

  it('preserves the original device timestamp and the minted key', () => {
    const { payload: p, result } = offer(initialPendingFixState, NOW - 12_345, { key: 'stable-key' });
    assert.equal(result.state.fix?.payload.recorded_at, p.recorded_at);
    assert.equal(result.state.fix?.payload.recorded_at, new Date(NOW - 12_345).toISOString());
    assert.equal(result.state.fix?.idempotencyKey, 'stable-key');
  });
});

describe('takePendingFix', () => {
  it('returns the held fix for a retry with the same stable key', () => {
    const held = offer(initialPendingFixState, NOW - 5_000, { key: 'stable-key' });
    const first = takePendingFix(held.result.state, { tripId: 'trip-1', now: NOW });
    assert.equal(first.action, 'retry');
    assert.equal(first.fix?.idempotencyKey, 'stable-key');
    assert.equal(first.fix?.attempts, 1);

    const second = takePendingFix(first.state, { tripId: 'trip-1', now: NOW });
    assert.equal(second.fix?.idempotencyKey, 'stable-key', 'the key never changes between retries');
    assert.equal(second.fix?.attempts, 2);
    assert.equal(second.state.retriedCount, 2);
  });

  it('expires a held fix past the age limit and counts it', () => {
    const held = offer(initialPendingFixState, NOW - 1_000);
    const taken = takePendingFix(held.result.state, {
      tripId: 'trip-1',
      now: NOW + PENDING_FIX_MAX_AGE_MS + 1,
    });
    assert.equal(taken.action, 'expired');
    assert.equal(taken.fix, null);
    assert.equal(taken.state.fix, null);
    assert.equal(taken.state.expiredCount, 1);
  });

  it('stops after the attempt bound instead of hammering a dead socket', () => {
    let state = offer(initialPendingFixState, NOW).result.state;
    for (let attempt = 0; attempt < PENDING_FIX_MAX_ATTEMPTS; attempt += 1) {
      const taken = takePendingFix(state, { tripId: 'trip-1', now: NOW + attempt * 1_000 });
      assert.equal(taken.action, 'retry', `attempt ${attempt + 1}`);
      state = taken.state;
    }
    const final = takePendingFix(state, { tripId: 'trip-1', now: NOW + 5_000 });
    assert.equal(final.action, 'exhausted');
    assert.equal(final.state.exhaustedCount, 1);
    assert.equal(final.state.fix, null);
  });

  it('drops the held fix when the tracked trip changed', () => {
    const held = offer(initialPendingFixState, NOW);
    const taken = takePendingFix(held.result.state, { tripId: 'trip-2', now: NOW });
    assert.equal(taken.action, 'other-trip');
    assert.equal(taken.state.fix, null);
  });

  it('reports an empty slot without inventing a fix', () => {
    const taken = takePendingFix(initialPendingFixState, { tripId: 'trip-1', now: NOW });
    assert.equal(taken.action, 'empty');
    assert.equal(taken.fix, null);
  });

  it('knows whether a retry is currently possible', () => {
    const held = offer(initialPendingFixState, NOW - 5_000).result.state;
    assert.equal(hasRetryablePendingFix(held, { tripId: 'trip-1', now: NOW }), true);
    assert.equal(
      hasRetryablePendingFix(held, { tripId: 'trip-1', now: NOW + PENDING_FIX_MAX_AGE_MS + 1 }),
      false,
    );
    assert.equal(hasRetryablePendingFix(held, { tripId: 'trip-other', now: NOW }), false);
  });
});

describe('acknowledgePendingFix / clearPendingFix', () => {
  it('clears the slot when the server acknowledged that exact fix', () => {
    const held = offer(initialPendingFixState, NOW, { key: 'stable-key' }).result.state;
    const acked = acknowledgePendingFix(held, 'stable-key');
    assert.equal(acked.fix, null);
    assert.equal(acked.acknowledgedCount, 1);
  });

  it('keeps a newer fix when a late ack arrives for the previous one', () => {
    const held = offer(initialPendingFixState, NOW + 4_000, { key: 'new-key' }).result.state;
    const acked = acknowledgePendingFix(held, 'old-key');
    assert.equal(acked.fix?.idempotencyKey, 'new-key');
    assert.equal(acked.acknowledgedCount, 0);
  });

  it('drops everything on stop/logout so nothing carries across accounts', () => {
    const held = offer(initialPendingFixState, NOW).result.state;
    assert.equal(clearPendingFix(held).fix, null);
    assert.equal(clearPendingFix(held).capturedCount, 1, 'counters survive a clear for reporting');
  });
});
