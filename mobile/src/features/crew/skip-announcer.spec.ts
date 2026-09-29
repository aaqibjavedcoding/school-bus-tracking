import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TripStatus } from '@school-bus-tracking/shared-types';
import type { TripStopSkippedEvent } from '@school-bus-tracking/shared-types';
import { SkippedStopAnnouncer } from './skip-announcer.ts';

/**
 * The R2 skip-announcement policy, table-driven. Every rule here guards a
 * field failure mode: a skip spoken twice makes the crew stop trusting the
 * announcements; a skip never spoken is the silent drop this whole fix
 * exists to end.
 */

const TRIP_A = '55555555-5555-4555-8555-555555550001';
const TRIP_B = '55555555-5555-4555-8555-555555550002';

function skippedEvent(overrides: Partial<TripStopSkippedEvent> = {}): TripStopSkippedEvent {
  return {
    trip_id: TRIP_A,
    school_id: '11111111-1111-4111-8111-111111110001',
    trip_status: TripStatus.IN_PROGRESS,
    tracking_state: 'active',
    stop_id: '22222222-2222-4222-8222-222222220002',
    stop_name: 'Oak Ave',
    sequence_number: 2,
    skipped_at: '2026-09-01T06:52:30.000Z',
    source: 'geofence',
    ...overrides,
  };
}

describe('SkippedStopAnnouncer', () => {
  it('speaks a passed stop exactly once, however often it is re-observed', () => {
    const announcer = new SkippedStopAnnouncer();
    const event = skippedEvent();

    assert.deepEqual(announcer.observe(event), { type: 'stop.passed', sequenceNumber: 2 });
    // The trip screen re-renders on every ETA push; the same broadcast (or a
    // resent frame after a reconnect) must not speak again.
    assert.equal(announcer.observe(event), null);
    assert.equal(announcer.observe(event), null);
  });

  it('speaks each stop of a multi-stop gap once', () => {
    const announcer = new SkippedStopAnnouncer();
    assert.deepEqual(
      announcer.observe(skippedEvent({ stop_id: 'stop-2', sequence_number: 2 })),
      { type: 'stop.passed', sequenceNumber: 2 },
    );
    assert.deepEqual(
      announcer.observe(skippedEvent({ stop_id: 'stop-3', sequence_number: 3 })),
      { type: 'stop.passed', sequenceNumber: 3 },
    );
    assert.equal(announcer.observe(skippedEvent({ stop_id: 'stop-2', sequence_number: 2 })), null);
  });

  it('starts over for a new run on the same route', () => {
    const announcer = new SkippedStopAnnouncer();
    announcer.observe(skippedEvent());
    const secondRun = announcer.observe(skippedEvent({ trip_id: TRIP_B }));
    assert.deepEqual(secondRun, { type: 'stop.passed', sequenceNumber: 2 });
  });

  it('reset() forgets the trip — a remounted screen still speaks', () => {
    const announcer = new SkippedStopAnnouncer();
    announcer.observe(skippedEvent());
    announcer.reset();
    assert.deepEqual(announcer.observe(skippedEvent()), { type: 'stop.passed', sequenceNumber: 2 });
  });

  it('stays silent for an absent event or a corrupt payload', () => {
    const announcer = new SkippedStopAnnouncer();
    assert.equal(announcer.observe(null), null);
    // No usable sequence number: the spoken line is "Stop {number} …", so a
    // numberless event is dropped here rather than spoken with a hole.
    assert.equal(
      announcer.observe(skippedEvent({ stop_id: 'stop-9', sequence_number: 0 })),
      null,
    );
    assert.equal(
      announcer.observe(skippedEvent({ stop_id: 'stop-9', sequence_number: Number.NaN })),
      null,
    );
    // A later good event for the same trip still speaks.
    assert.deepEqual(
      announcer.observe(skippedEvent({ stop_id: 'stop-4', sequence_number: 4 })),
      { type: 'stop.passed', sequenceNumber: 4 },
    );
  });
});
