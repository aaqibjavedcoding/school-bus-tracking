import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PERSISTED_FIX_MAX_AGE_MS,
  STATS_PERSIST_MIN_INTERVAL_MS,
  createPersistedTrackingStats,
  decidePersistedStatsRestore,
  parsePersistedTrackingStats,
  serializePersistedTrackingStats,
  shouldPersistTrackingStats,
  type PersistedDeviceFix,
  type TrackingStatsDecision,
} from './tracking-stats-persistence.ts';

/**
 * Restoring "where this phone was" across an app restart, without ever
 * restoring it onto the wrong run.
 *
 * The bug being fixed (P2-7) is a false sentence — "No fix from this device
 * yet." after a restart, while the server held fixes from this very phone.
 * The bug this fix could *introduce* is far worse: a coordinate from an
 * earlier trip drawn as the bus's current position. Every case below exists
 * to pin one side or the other.
 */

const NOW = Date.UTC(2026, 8, 29, 9, 0, 0);
const SESSION = { id: 'user-1', school_id: 'school-1' };

function fix(overrides: Partial<PersistedDeviceFix> = {}): PersistedDeviceFix {
  return {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 8,
    recorded_at: new Date(NOW - 60_000).toISOString(),
    heading: 92,
    speed: 18,
    mocked: false,
    ...overrides,
  };
}

function stored(
  overrides: Partial<Parameters<typeof createPersistedTrackingStats>[0]> = {},
): string {
  return serializePersistedTrackingStats(
    createPersistedTrackingStats({
      userId: 'user-1',
      schoolId: 'school-1',
      tripId: 'trip-1',
      lastFix: fix(),
      lastAckAt: new Date(NOW - 55_000).toISOString(),
      now: NOW - 55_000,
      ...overrides,
    }),
  );
}

describe('persisted tracking stats — round trip', () => {
  it('keeps the fix’s own timestamps so freshness stays honest', () => {
    const raw = stored();
    const parsed = parsePersistedTrackingStats(raw);
    assert.ok(parsed);
    // The restored record must age exactly as the in-memory one would have:
    // a fix written a minute ago is a minute old, not "just now".
    assert.equal(parsed!.lastFix?.recorded_at, fix().recorded_at);
    assert.equal(parsed!.lastFix?.accuracy, 8);
    assert.equal(parsed!.lastFix?.heading, 92);
    assert.equal(parsed!.lastFix?.speed, 18);
    assert.equal(parsed!.lastFix?.mocked, false);
  });

  it('carries the mock-location flag through, because the warning must survive too', () => {
    const raw = stored({ lastFix: fix({ mocked: true }) });
    assert.equal(parsePersistedTrackingStats(raw)?.lastFix?.mocked, true);
  });

  const rejected: Array<{ name: string; raw: string | null }> = [
    { name: 'nothing stored', raw: null },
    { name: 'empty string', raw: '   ' },
    { name: 'not JSON', raw: '{oops' },
    { name: 'not an object', raw: '"trip-1"' },
    { name: 'no owner', raw: JSON.stringify({ tripId: 't', updatedAt: new Date(NOW).toISOString() }) },
    {
      name: 'no trip',
      raw: JSON.stringify({ userId: 'u', updatedAt: new Date(NOW).toISOString(), lastAckAt: null }),
    },
    {
      name: 'no fix and no acknowledgement',
      raw: JSON.stringify({
        userId: 'u',
        tripId: 't',
        updatedAt: new Date(NOW).toISOString(),
        lastFix: null,
        lastAckAt: null,
      }),
    },
    {
      name: 'a fix without coordinates',
      raw: JSON.stringify({
        userId: 'u',
        tripId: 't',
        updatedAt: new Date(NOW).toISOString(),
        lastFix: { recorded_at: new Date(NOW).toISOString() },
        lastAckAt: null,
      }),
    },
  ];

  for (const testCase of rejected) {
    it(`refuses to parse: ${testCase.name}`, () => {
      assert.equal(parsePersistedTrackingStats(testCase.raw), null);
    });
  }
});

describe('persisted tracking stats — who and which trip may restore it', () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof decidePersistedStatsRestore>[0];
    expected: TrackingStatsDecision;
  }> = [
    {
      name: 'the same driver, the same trip, minutes ago',
      input: { raw: stored(), session: SESSION, tripId: 'trip-1', now: NOW },
      expected: 'restore',
    },
    {
      name: 'nothing persisted',
      input: { raw: null, session: SESSION, tripId: 'trip-1', now: NOW },
      expected: 'none',
    },
    {
      name: 'a corrupt record',
      input: { raw: '{', session: SESSION, tripId: 'trip-1', now: NOW },
      expected: 'corrupt',
    },
    {
      name: 'no session to prove ownership',
      input: { raw: stored(), session: null, tripId: 'trip-1', now: NOW },
      expected: 'no-session',
    },
    {
      name: 'another driver on the same phone',
      input: {
        raw: stored(),
        session: { id: 'user-2', school_id: 'school-1' },
        tripId: 'trip-1',
        now: NOW,
      },
      expected: 'other-user',
    },
    {
      name: 'another school',
      input: {
        raw: stored(),
        session: { id: 'user-1', school_id: 'school-2' },
        tripId: 'trip-1',
        now: NOW,
      },
      expected: 'other-school',
    },
    {
      name: 'the next run of the day',
      input: { raw: stored(), session: SESSION, tripId: 'trip-2', now: NOW },
      expected: 'other-trip',
    },
    {
      name: 'no trip on the lifecycle at all',
      input: { raw: stored(), session: SESSION, tripId: null, now: NOW },
      expected: 'other-trip',
    },
    {
      name: 'yesterday’s position',
      input: {
        raw: stored({
          lastFix: fix({ recorded_at: new Date(NOW - PERSISTED_FIX_MAX_AGE_MS - 60_000).toISOString() }),
          lastAckAt: null,
          now: NOW - PERSISTED_FIX_MAX_AGE_MS - 60_000,
        }),
        session: SESSION,
        tripId: 'trip-1',
        now: NOW,
      },
      expected: 'expired',
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.expected}`, () => {
      assert.equal(decidePersistedStatsRestore(testCase.input).decision, testCase.expected);
    });
  }

  it('never restores a marker for a trip that is not on screen', () => {
    // The single most important assertion in this file: a restored position
    // is only ever shown for the run it was measured on.
    for (const tripId of [null, 'trip-2', 'trip-1']) {
      const result = decidePersistedStatsRestore({
        raw: stored(),
        session: SESSION,
        tripId,
        now: NOW,
      });
      assert.equal(result.decision === 'restore', tripId === 'trip-1');
    }
  });

  it('ages on the newest timestamp in the record, not on the write', () => {
    // A late acknowledgement rewrites the record; that must not make an old
    // coordinate look recent — but a record whose *fix* is old while the ack
    // is fresh is still legitimately restorable (the ack is real news).
    const raw = stored({
      lastFix: fix({ recorded_at: new Date(NOW - PERSISTED_FIX_MAX_AGE_MS - 1).toISOString() }),
      lastAckAt: new Date(NOW - 1_000).toISOString(),
      now: NOW - 1_000,
    });
    assert.equal(
      decidePersistedStatsRestore({ raw, session: SESSION, tripId: 'trip-1', now: NOW }).decision,
      'restore',
    );
  });
});

describe('persisted tracking stats — when to write', () => {
  const base = {
    tripId: 'trip-1',
    lastFixRecordedAt: new Date(NOW - 4_000).toISOString(),
    lastAckAt: new Date(NOW - 4_000).toISOString(),
  };

  it('writes the first record immediately', () => {
    assert.equal(
      shouldPersistTrackingStats({ written: null, next: base, writtenAt: null, now: NOW }),
      true,
    );
  });

  it('writes a trip change at once, throttle or not', () => {
    assert.equal(
      shouldPersistTrackingStats({
        written: { ...base, tripId: 'trip-0' },
        next: base,
        writtenAt: NOW - 1,
        now: NOW,
      }),
      true,
    );
  });

  it('skips a republish that carries no new information', () => {
    assert.equal(
      shouldPersistTrackingStats({
        written: base,
        next: base,
        writtenAt: NOW - STATS_PERSIST_MIN_INTERVAL_MS * 10,
        now: NOW,
      }),
      false,
    );
  });

  it('throttles a stream of fixes to one write per interval', () => {
    const next = { ...base, lastFixRecordedAt: new Date(NOW).toISOString() };
    assert.equal(
      shouldPersistTrackingStats({
        written: base,
        next,
        writtenAt: NOW - (STATS_PERSIST_MIN_INTERVAL_MS - 1),
        now: NOW,
      }),
      false,
    );
    assert.equal(
      shouldPersistTrackingStats({
        written: base,
        next,
        writtenAt: NOW - STATS_PERSIST_MIN_INTERVAL_MS,
        now: NOW,
      }),
      true,
    );
  });

  it('writes nothing while there is nothing to remember', () => {
    assert.equal(
      shouldPersistTrackingStats({
        written: null,
        next: { tripId: 'trip-1', lastFixRecordedAt: null, lastAckAt: null },
        writtenAt: null,
        now: NOW,
      }),
      false,
    );
    assert.equal(
      shouldPersistTrackingStats({
        written: null,
        next: { tripId: null, lastFixRecordedAt: base.lastFixRecordedAt, lastAckAt: null },
        writtenAt: null,
        now: NOW,
      }),
      false,
      'a fix with no trip has nowhere to belong',
    );
  });
});
