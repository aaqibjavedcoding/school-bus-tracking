import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TripStatus } from '@school-bus-tracking/shared-types';
import type { TripStopArrivedEvent } from '@school-bus-tracking/shared-types';
import { ArrivedStopAnnouncer } from './arrived-stop-announcer.ts';

/**
 * Pure replay coverage for the server GPS-arrival edge policy. The only
 * arrival authority is the server event; these tests deliberately do not
 * manufacture an arrival from a device location.
 */

const TRIP_A = '55555555-5555-4555-8555-555555550001';
const TRIP_B = '55555555-5555-4555-8555-555555550002';
const STOP_A = '22222222-2222-4222-8222-222222220001';

function arrivedEvent(overrides: Partial<TripStopArrivedEvent> = {}): TripStopArrivedEvent {
  return {
    trip_id: TRIP_A,
    school_id: '11111111-1111-4111-8111-111111110001',
    trip_status: TripStatus.IN_PROGRESS,
    tracking_state: 'active',
    stop_id: STOP_A,
    stop_name: 'Oak Avenue',
    sequence_number: 2,
    arrived_at: '2026-10-01T06:52:30.000Z',
    latitude: 19.076,
    longitude: 72.8777,
    distance_meters: 18,
    source: 'geofence',
    ...overrides,
  };
}

const SPOKEN = { type: 'stop.arrived', stopName: 'Oak Avenue', studentCount: 0 } as const;

describe('ArrivedStopAnnouncer', () => {
  const rules: ReadonlyArray<{ name: string; verify: () => void }> = [
    {
      name: 'stays silent for a null event or invalid trip id',
      verify: () => {
        const announcer = new ArrivedStopAnnouncer();
        assert.equal(announcer.observe(null), null);
        assert.equal(announcer.observe(arrivedEvent({ trip_id: '' })), null);
        assert.equal(announcer.observe(arrivedEvent({ trip_id: '   ' })), null);
      },
    },
    {
      name: 'resets its per-stop memory when the trip changes',
      verify: () => {
        const announcer = new ArrivedStopAnnouncer();
        assert.deepEqual(announcer.observe(arrivedEvent()), SPOKEN);
        assert.deepEqual(
          announcer.observe(arrivedEvent({ trip_id: TRIP_B })),
          SPOKEN,
          'the same route stop is news again on a new run',
        );
      },
    },
    {
      name: 'suppresses a crew-marked null/null arrival',
      verify: () => {
        const announcer = new ArrivedStopAnnouncer();
        assert.equal(
          announcer.observe(
            arrivedEvent({ latitude: null, longitude: null, source: 'crew', stop_id: 'crew-stop' }),
          ),
          null,
          'useCrewStopMark already announced the local stop.recorded receipt',
        );
      },
    },
    {
      name: 'speaks the same GPS stop only once per trip',
      verify: () => {
        const announcer = new ArrivedStopAnnouncer();
        const event = arrivedEvent();
        assert.deepEqual(announcer.observe(event), SPOKEN);
        assert.equal(announcer.observe(event), null);
        assert.equal(announcer.observe({ ...event }), null, 'reconnect resend is the same edge');
      },
    },
    {
      name: 'never emits a nameless arrival line',
      verify: () => {
        const announcer = new ArrivedStopAnnouncer();
        assert.equal(announcer.observe(arrivedEvent({ stop_name: '' })), null);
        assert.equal(announcer.observe(arrivedEvent({ stop_name: '   ' })), null);
      },
    },
  ];

  for (const rule of rules) test(rule.name, rule.verify);

  test('synthetic trip-screen replay: one GPS voice fact and one manifest navigation', () => {
    const announcer = new ArrivedStopAnnouncer();
    const feedbackEvents: unknown[] = [];
    const manifestNavigations: string[] = [];
    const navigated = new Set<string>();

    /** Mirrors the trip screen's trip guard, manual-mark suppression and ref key. */
    const replay = (activeTripId: string, event: TripStopArrivedEvent): void => {
      if (event.trip_id !== activeTripId) return; // old room frame after a trip switch
      const feedbackEvent = announcer.observe(event);
      if (feedbackEvent !== null) feedbackEvents.push(feedbackEvent);
      if (event.latitude === null && event.longitude === null) return;
      if (event.trip_status !== TripStatus.BOARDING && event.trip_status !== TripStatus.IN_PROGRESS)
        return;
      const navigationKey = `${activeTripId}:${event.stop_id}`;
      if (navigated.has(navigationKey)) return;
      navigated.add(navigationKey);
      manifestNavigations.push(`/manifest?stopId=${event.stop_id}`);
    };

    const gpsArrival = arrivedEvent();
    replay(TRIP_A, gpsArrival);
    replay(TRIP_A, gpsArrival); // reconnect/rerender duplicate
    replay(
      TRIP_A,
      arrivedEvent({
        stop_id: '22222222-2222-4222-8222-222222220002',
        stop_name: 'Manual Mark Stop',
        latitude: null,
        longitude: null,
        distance_meters: null,
        source: 'crew',
      }),
    );
    // A trip switch can leave one old lastArrival value around until the new
    // room emits. It must neither speak nor navigate for the new screen.
    replay(TRIP_B, gpsArrival);

    assert.deepEqual(feedbackEvents, [SPOKEN]);
    assert.deepEqual(manifestNavigations, [`/manifest?stopId=${STOP_A}`]);
  });
});
