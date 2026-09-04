import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UniqueConstraintError } from 'sequelize';
import {
  LIVE_TRACKING_EVENTS,
  TripStatus,
  liveTrackingRoomName,
} from '@school-bus-tracking/shared-types';
import {
  DEFAULT_STOPS,
  ROUTE_A,
  ROUTE_B,
  SCHOOL_A,
  SCHOOL_B,
  STOP_1,
  STOP_2,
  TRIP_A,
  TRIP_CANCELLED,
  TRIP_COMPLETED,
  TRIP_OTHER_SCHOOL,
  asTrip,
  makeArrival,
  makeArrivalsHarness,
  makeFix,
  makeStop,
  makeTrip,
} from './eta.test-utils';
import { pickStopArrivalCandidate } from './stop-arrivals.service';

const closeTo = (actual: number, expected: number, tolerance = 5): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

describe('StopArrivalsService geofence evaluation', () => {
  it('records an arrival when the GPS enters a stop geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    // ~41 m from stop 1 — inside its 100 m radius.
    const fix = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    const recorded = await harness.service.onAcceptedFix(trip, fix as never);

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
    assert.equal(recorded.stop.name, 'Green Park Stop');
    assert.equal(harness.arrivals.created.length, 1);

    const created = harness.arrivals.created[0];
    assert.equal(created['school_id'], SCHOOL_A);
    assert.equal(created['trip_id'], TRIP_A);
    assert.equal(created['stop_id'], STOP_1);
    assert.equal(created['latitude'], fix.latitude);
    assert.equal(created['longitude'], fix.longitude);
    assert.ok(created['arrived_at'] instanceof Date);
    closeTo(created['distance_meters'] as number, 41);
  });

  it('records nothing when the GPS is outside every geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const fix = makeFix({ latitude: 40.75, longitude: -74.1 }); // kilometres away

    const recorded = await harness.service.onAcceptedFix(trip, fix as never);

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
    assert.equal(harness.arrivalNotifications.length, 0);
  });

  it('does not repeat an arrival for every fix inside the same geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    const first = await harness.service.onAcceptedFix(trip, inside as never);
    const second = await harness.service.onAcceptedFix(trip, inside as never);
    const third = await harness.service.onAcceptedFix(trip, inside as never);

    assert.ok(first);
    assert.equal(second, null);
    assert.equal(third, null);
    assert.equal(harness.arrivals.created.length, 1);
    assert.equal(harness.arrivalNotifications.length, 1);
    const arrivalEvents = harness.broadcasts.filter(
      (entry) => entry.event === LIVE_TRACKING_EVENTS.stopArrived,
    );
    assert.equal(arrivalEvents.length, 1);
  });

  it('never duplicates an arrival that already exists in the database', async () => {
    const existing = makeArrival({ stop_id: STOP_1 });
    const harness = makeArrivalsHarness({ arrivals: [existing] });
    const trip = asTrip(makeTrip());
    const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    const recorded = await harness.service.onAcceptedFix(trip, inside as never);

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
    assert.equal(harness.arrivalNotifications.length, 0);
  });

  it('treats a unique-constraint race as already recorded (no second event)', async () => {
    const race = new UniqueConstraintError({
      message: 'duplicate key value violates unique constraint "uq_trip_stop_arrivals_trip_stop"',
      errors: [
        {
          message: 'stop_id must be unique',
          type: 'unique violation',
          path: 'stop_id',
          value: STOP_1,
        },
      ] as never,
    });
    const harness = makeArrivalsHarness({ createError: race });
    const trip = asTrip(makeTrip());
    const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    const recorded = await harness.service.onAcceptedFix(trip, inside as never);

    assert.equal(recorded, null);
    assert.equal(harness.arrivalNotifications.length, 0);
    assert.equal(
      harness.broadcasts.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.stopArrived).length,
      0,
    );
    // The ETA broadcast still went out for the accepted fix.
    assert.equal(
      harness.broadcasts.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.etaUpdate).length,
      1,
    );
  });

  it('records separate visits of consecutive stops as separate arrivals', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());

    const atStop1 = await harness.service.onAcceptedFix(
      trip,
      makeFix({ latitude: 40.7003, longitude: -73.9997 }) as never,
    );
    const atStop2 = await harness.service.onAcceptedFix(
      trip,
      makeFix({ latitude: 40.7001, longitude: -73.9898 }) as never,
    );

    assert.ok(atStop1);
    assert.ok(atStop2);
    assert.equal(atStop1.stop.id, STOP_1);
    assert.equal(atStop2.stop.id, STOP_2);
    assert.equal(harness.arrivals.created.length, 2);
    assert.equal(harness.arrivalNotifications.length, 2);
  });

  it('records only the earliest-in-sequence stop per fix (no arrival bursts)', async () => {
    // Huge overlapping geofences: one fix sits inside stops 1 and 2.
    const stops = [
      makeStop({ id: STOP_1, sequence_number: 1, geofence_radius_meters: 2000 }),
      makeStop({ id: STOP_2, sequence_number: 2, geofence_radius_meters: 2000 }),
    ];
    const harness = makeArrivalsHarness({ stops });
    const trip = asTrip(makeTrip());

    const recorded = await harness.service.onAcceptedFix(
      trip,
      makeFix({ latitude: 40.7003, longitude: -73.9997 }) as never,
    );

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
    assert.equal(harness.arrivals.created.length, 1);
  });

  it('only evaluates stops of the trip route (wrong-route isolation)', async () => {
    // A stop of another route sits exactly where the bus is; the trip's own
    // route has no stop there.
    const stops = [
      ...DEFAULT_STOPS,
      makeStop({
        id: '22222222-2222-4222-8222-222222220004',
        route_id: ROUTE_B,
        name: 'Birch Rd',
        sequence_number: 9,
        latitude: 40.75,
        longitude: -74.1,
      }),
    ];
    const harness = makeArrivalsHarness({ stops });
    const trip = asTrip(makeTrip({ route_id: ROUTE_A }));
    const fix = makeFix({ latitude: 40.75, longitude: -74.1 });

    const recorded = await harness.service.onAcceptedFix(trip, fix as never);

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
  });

  it('never matches a stop of another school (cross-school isolation)', async () => {
    const stops = [
      ...DEFAULT_STOPS,
      makeStop({
        id: '22222222-2222-4222-8222-222222220005',
        school_id: SCHOOL_B,
        route_id: ROUTE_A,
        name: 'Cedar Ln',
        sequence_number: 0,
        latitude: 40.75,
        longitude: -74.1,
      }),
    ];
    const harness = makeArrivalsHarness({ stops });
    const trip = asTrip(makeTrip({ school_id: SCHOOL_A }));
    const fix = makeFix({ latitude: 40.75, longitude: -74.1 });

    const recorded = await harness.service.onAcceptedFix(trip, fix as never);

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
  });

  it('never generates arrivals for completed or cancelled trips', async () => {
    for (const status of [TripStatus.COMPLETED, TripStatus.CANCELLED]) {
      const harness = makeArrivalsHarness();
      const trip = asTrip(
        makeTrip({
          id: status === TripStatus.COMPLETED ? TRIP_COMPLETED : TRIP_CANCELLED,
          status,
        }),
      );
      const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

      const recorded = await harness.service.onAcceptedFix(trip, inside as never);

      assert.equal(recorded, null, `terminal status ${status}`);
      assert.equal(harness.arrivals.created.length, 0, `terminal status ${status}`);
      assert.equal(harness.arrivalNotifications.length, 0, `terminal status ${status}`);
      assert.equal(harness.broadcasts.length, 0, `terminal status ${status}`);
    }
  });

  it('broadcasts trip:stop:arrived and trip:eta:update to the trip room', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    await harness.service.onAcceptedFix(trip, inside as never);

    const arrived = harness.broadcasts.find(
      (entry) => entry.event === LIVE_TRACKING_EVENTS.stopArrived,
    );
    const eta = harness.broadcasts.find((entry) => entry.event === LIVE_TRACKING_EVENTS.etaUpdate);
    assert.ok(arrived);
    assert.ok(eta);
    assert.equal(arrived.room, liveTrackingRoomName(TRIP_A));
    assert.equal(eta.room, liveTrackingRoomName(TRIP_A));

    const payload = arrived.payload as Record<string, unknown>;
    assert.equal(payload['trip_id'], TRIP_A);
    assert.equal(payload['school_id'], SCHOOL_A);
    assert.equal(payload['stop_id'], STOP_1);
    assert.equal(payload['stop_name'], 'Green Park Stop');
    assert.equal(payload['sequence_number'], 1);
    assert.equal(payload['tracking_state'], 'active');
  });

  it('asks the notification service about the reached stop exactly once per visit', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    await harness.service.onAcceptedFix(trip, inside as never);
    await harness.service.onAcceptedFix(trip, inside as never);

    assert.equal(harness.arrivalNotifications.length, 1);
    const notification = harness.arrivalNotifications[0];
    assert.equal(notification.school_id, SCHOOL_A);
    assert.equal(notification.trip_id, TRIP_A);
    assert.equal(notification.stop.id, STOP_1);
    assert.equal(notification.stop.name, 'Green Park Stop');
    assert.ok(notification.occurred_at instanceof Date);
  });

  it('computes the ETA from the latest fix and the fresh arrival state', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const inside = makeFix({ latitude: 40.7003, longitude: -73.9997 });

    await harness.service.onAcceptedFix(trip, inside as never);

    assert.equal(harness.etaCalls.length, 1);
    const call = harness.etaCalls[0];
    assert.equal(call.trip.id, TRIP_A);
    assert.equal(call.latest?.id, inside.id);
    // The newly created arrival is included so the next stop advances.
    assert.equal(call.arrivals?.length, 1);
    assert.equal(call.arrivals?.[0].stop_id, STOP_1);
    assert.equal(call.stops?.length, 3);
  });

  it('resets the per-process arrival memory for a trip without errors', async () => {
    const harness = makeArrivalsHarness();
    harness.service.resetForTrip(TRIP_A);
    // Nothing to assert beyond "does not throw" — the database still owns
    // the authoritative duplicate protection.
  });

  it('evaluates only the trip tenant even when the fix claims another school', async () => {
    const harness = makeArrivalsHarness();
    // The trip row's tenant wins; the fix's own school_id is irrelevant.
    const trip = asTrip(makeTrip({ school_id: SCHOOL_A }));
    const fix = makeFix({
      school_id: SCHOOL_B,
      trip_id: TRIP_OTHER_SCHOOL,
      latitude: 40.7003,
      longitude: -73.9997,
    });

    const recorded = await harness.service.onAcceptedFix(trip, fix as never);

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
    const created = harness.arrivals.created[0];
    assert.equal(created['school_id'], SCHOOL_A);
    assert.equal(created['trip_id'], TRIP_A);
  });
});

describe('pickStopArrivalCandidate', () => {
  const fix = { latitude: 40.7003, longitude: -73.9997 };

  it('returns null for empty route stop sets', () => {
    assert.equal(pickStopArrivalCandidate([], new Set(), undefined, fix), null);
  });

  it('skips inactive stops and stops without coordinates or radius', () => {
    const candidates = [
      makeStop({ id: STOP_1, sequence_number: 1, latitude: 40.7003, longitude: -73.9997 }),
      makeStop({
        id: STOP_2,
        sequence_number: 2,
        latitude: 40.7003,
        longitude: -73.9997,
        is_active: false,
      }),
      makeStop({
        id: '22222222-2222-4222-8222-222222220003',
        sequence_number: 3,
        latitude: null,
        longitude: null,
      }),
      makeStop({
        id: '22222222-2222-4222-8222-222222220004',
        sequence_number: 4,
        latitude: 40.7003,
        longitude: -73.9997,
        geofence_radius_meters: 0,
      }),
    ];
    const chosen = pickStopArrivalCandidate(candidates, new Set(), undefined, fix);
    assert.ok(chosen);
    assert.equal(chosen.id, STOP_1);
  });

  it('skips stops that already arrived or were seen this process', () => {
    const stops = [
      makeStop({ id: STOP_1, sequence_number: 1, latitude: 40.7003, longitude: -73.9997 }),
      makeStop({ id: STOP_2, sequence_number: 2, latitude: 40.7003, longitude: -73.9997 }),
    ];
    assert.equal(pickStopArrivalCandidate(stops, new Set([STOP_1]), undefined, fix)?.id, STOP_2);
    assert.equal(pickStopArrivalCandidate(stops, new Set(), new Set([STOP_1, STOP_2]), fix), null);
  });
});
