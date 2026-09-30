import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UniqueConstraintError } from 'sequelize';
import {
  LIVE_TRACKING_EVENTS,
  TripStatus,
  liveTrackingRoomName,
} from '@school-bus-tracking/shared-types';
import type { Trip } from '../../database/models';
import {
  DEFAULT_STOPS,
  ROUTE_A,
  ROUTE_B,
  SCHOOL_A,
  SCHOOL_B,
  STOP_1,
  STOP_2,
  STOP_3,
  STOP_NO_COORDS,
  TRIP_A,
  TRIP_CANCELLED,
  TRIP_COMPLETED,
  TRIP_OTHER_SCHOOL,
  asTrip,
  makeArrival,
  makeArrivalsHarness,
  makeFix,
  makeStop,
  makeStopsRepo,
  makeTrip,
  minimalEtaResponse,
  type ArrivalsHarness,
  type StubFix,
} from './eta.test-utils';
import {
  assessFixEligibility,
  effectiveStopRadiusMeters,
  fixAccuracySufficientForStop,
  hasMovedOnTowardAheadStop,
  requiredFixesForProgression,
  selectProgressionCandidate,
  stopsPassedByFrontier,
  StopArrivalsService,
  DEFAULT_ARRIVAL_DETECTION_CONFIG,
  updateInsideEvidence,
} from './stop-arrivals.service';
import type { StopArrivalNotificationInput } from '../notifications/notifications.service';

const closeTo = (actual: number, expected: number, tolerance = 5): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

/**
 * Phase 1: a controllable GPS clock. Each `fix()` advances the clock by
 * `dtMs` and stamps the fix there, so consecutive same-spot fixes look
 * stationary and stop transitions can be given realistic travel times
 * (the implausible-jump gate would otherwise reject teleports).
 */
function clockFrom(startIso: string) {
  let now = new Date(startIso).getTime();
  return {
    fix(overrides: Partial<StubFix> = {}, dtMs = 3000): StubFix {
      now += dtMs;
      return makeFix({
        recorded_at: new Date(now),
        received_at: new Date(now + 500),
        ...overrides,
      });
    },
    now(): Date {
      return new Date(now + 500);
    },
    ms(): number {
      return now;
    },
  };
}

const evaluate = (harness: ArrivalsHarness, trip: Trip, fix: StubFix, at: Date) =>
  harness.service.onAcceptedFix(trip, fix as never, at);

/** Inside STOP_1 (~41 m), STOP_2 (~20 m) and STOP_3 (~14 m) respectively. */
const AT_STOP_1 = { latitude: 40.7003, longitude: -73.9997 };
const AT_STOP_2 = { latitude: 40.7001, longitude: -73.9898 };
const AT_STOP_3 = { latitude: 40.6999, longitude: -73.9801 };

describe('StopArrivalsService geofence evaluation', () => {
  it('records an arrival when the GPS enters a stop geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // One eligible in-geofence fix is proof enough for the next stop.
    const fix = clock.fix({ ...AT_STOP_1 });
    const recorded = await evaluate(harness, trip, fix, clock.now());

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
    // Phase 1: the arrival is timestamped at the original fix time.
    assert.equal(
      (created['arrived_at'] as Date).getTime(),
      new Date(fix.recorded_at as string | number | Date).getTime(),
    );
    closeTo(created['distance_meters'] as number, 41);
  });

  it('records nothing when the GPS is outside every geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    const fix = clock.fix({ latitude: 40.75, longitude: -74.1 }); // kilometres away

    const recorded = await evaluate(harness, trip, fix, clock.now());

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
    assert.equal(harness.arrivalNotifications.length, 0);
  });

  it('does not record boarding-phase fixes and starts fresh when the trip becomes in progress', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip({ status: TripStatus.BOARDING }));
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Tracking remains active in BOARDING, but this pipeline must not load
    // stops, update inside evidence, advance ETA, or create an arrival.
    const boarding = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    assert.equal(boarding, null);
    assert.equal(harness.arrivals.created.length, 0);
    assert.equal(harness.broadcasts.length, 0);

    // The same position is the first ever arrival-evidence fix after the
    // lifecycle transition — it records normally, with no fabricated history.
    trip.status = TripStatus.IN_PROGRESS;
    const inProgress = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    assert.ok(inProgress);
    assert.equal(inProgress.stop.id, STOP_1);
    assert.equal(harness.arrivals.created.length, 1);
  });

  it('does not repeat an arrival for every fix inside the same geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const first = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const second = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const third = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

    assert.ok(first); // one eligible in-geofence fix records immediately
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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const first = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const second = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

    assert.equal(first, null);
    assert.equal(second, null);
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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const first = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

    assert.equal(first, null);
    assert.equal(recorded, null);
    assert.equal(harness.arrivalNotifications.length, 0);
    assert.equal(
      harness.broadcasts.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.stopArrived).length,
      0,
    );
    // The ETA broadcast still went out for each accepted fix.
    assert.equal(
      harness.broadcasts.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.etaUpdate).length,
      2,
    );
  });

  it('records separate visits of consecutive stops as separate arrivals', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const atStop1 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const againAtStop1 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    // ~840 m down-route: a realistic two-minute drive, not a jump.
    const atStop2 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 120_000), clock.now());

    assert.ok(atStop1);
    assert.equal(againAtStop1, null);
    assert.ok(atStop2);
    assert.equal(atStop1.stop.id, STOP_1);
    assert.equal(atStop2.stop.id, STOP_2);
    assert.equal(harness.arrivals.created.length, 2);
    assert.equal(harness.arrivalNotifications.length, 2);
  });

  it('records only one stop per fix (no arrival bursts)', async () => {
    // Huge overlapping geofences: one fix sits inside stops 1 and 2.
    const stops = [
      makeStop({ id: STOP_1, sequence_number: 1, geofence_radius_meters: 2000 }),
      makeStop({ id: STOP_2, sequence_number: 2, geofence_radius_meters: 2000 }),
    ];
    const harness = makeArrivalsHarness({ stops });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
    assert.equal(harness.arrivals.created.length, 1, 'one fix records at most one arrival');
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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ latitude: 40.75, longitude: -74.1 }), clock.now());
    const recorded = await evaluate(
      harness,
      trip,
      clock.fix({ latitude: 40.75, longitude: -74.1 }),
      clock.now(),
    );

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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ latitude: 40.75, longitude: -74.1 }), clock.now());
    const recorded = await evaluate(
      harness,
      trip,
      clock.fix({ latitude: 40.75, longitude: -74.1 }),
      clock.now(),
    );

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
  });

  it('never generates arrivals outside the in-progress arrival-recording window', async () => {
    for (const status of [
      TripStatus.SCHEDULED,
      TripStatus.BOARDING,
      TripStatus.COMPLETED,
      TripStatus.CANCELLED,
    ]) {
      const harness = makeArrivalsHarness();
      const trip = asTrip(
        makeTrip({
          id: status === TripStatus.COMPLETED ? TRIP_COMPLETED : TRIP_CANCELLED,
          status,
        }),
      );
      const clock = clockFrom('2026-09-01T06:41:30.000Z');

      await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
      const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

      assert.equal(recorded, null, `non-active status ${status}`);
      assert.equal(harness.arrivals.created.length, 0, `non-active status ${status}`);
      assert.equal(harness.arrivalNotifications.length, 0, `non-active status ${status}`);
      assert.equal(harness.broadcasts.length, 0, `non-active status ${status}`);
    }
  });

  it('broadcasts trip:stop:arrived and trip:eta:update to the trip room', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const inside = clock.fix({ ...AT_STOP_1 });
    await evaluate(harness, trip, inside, clock.now());

    assert.equal(harness.etaCalls.length, 2);
    const call = harness.etaCalls[1];
    assert.equal(call.trip.id, TRIP_A);
    assert.equal(call.latest?.id, inside.id);
    // The newly created arrival is included so the next stop advances.
    assert.equal(call.arrivals?.length, 1);
    assert.equal(call.arrivals?.[0].stop_id, STOP_1);
    assert.equal(call.stops?.length, 3);
    // Phase 1: the reference clock travels with the ETA request.
    assert.ok(call.now instanceof Date);
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
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    const claimed = {
      school_id: SCHOOL_B,
      trip_id: TRIP_OTHER_SCHOOL,
      ...AT_STOP_1,
    };

    const recorded = await evaluate(harness, trip, clock.fix(claimed), clock.now());
    const second = await evaluate(harness, trip, clock.fix(claimed), clock.now());

    assert.ok(recorded);
    assert.equal(second, null);
    assert.equal(recorded.stop.id, STOP_1);
    const created = harness.arrivals.created[0];
    assert.equal(created['school_id'], SCHOOL_A);
    assert.equal(created['trip_id'], TRIP_A);
  });
});

describe('StopArrivalsService Phase 1 freshness and quality', () => {
  it('ignores stale fixes (offline replay) but still broadcasts the ETA round', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    // The newest fix of an offline batch, uploaded two hours late.
    const fix = makeFix({
      ...AT_STOP_1,
      recorded_at: new Date('2026-09-01T04:41:30.000Z'),
      received_at: new Date('2026-09-01T06:41:30.000Z'),
    });

    const recorded = await evaluate(harness, trip, fix, new Date('2026-09-01T06:41:30.000Z'));

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
    assert.equal(harness.arrivalNotifications.length, 0);
    // Ingestion is untouched: the ETA round still runs (with staleness info).
    assert.equal(harness.etaCalls.length, 1);
    assert.ok(harness.etaCalls[0].now instanceof Date);
  });

  it('recovers after an offline replay once fresh fixes arrive', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const staleAt = new Date('2026-09-01T06:41:30.000Z');
    await evaluate(
      harness,
      trip,
      makeFix({
        ...AT_STOP_1,
        recorded_at: new Date('2026-09-01T04:41:30.000Z'),
        received_at: staleAt,
      }),
      staleAt,
    );

    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const again = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
    assert.equal(again, null);
  });

  it('ignores fixes dated beyond the future tolerance', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const now = new Date('2026-09-01T06:41:30.000Z');
    const future = makeFix({
      ...AT_STOP_1,
      recorded_at: new Date(now.getTime() + 120_000), // 2 min ahead, tolerance 1 min
      received_at: now,
    });

    await evaluate(harness, trip, future, now);
    const recorded = await evaluate(harness, trip, future, now);

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
  });

  it('accepts fixes within the future tolerance', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const now = new Date('2026-09-01T06:41:30.000Z');
    const skewed = makeFix({
      ...AT_STOP_1,
      recorded_at: new Date(now.getTime() + 30_000), // inside the 1 min tolerance
      received_at: now,
    });

    const recorded = await evaluate(harness, trip, skewed, now);

    assert.ok(recorded);
    // …but the arrival is never dated in the future.
    assert.equal(harness.arrivals.created.length, 1);
    assert.ok((harness.arrivals.created[0]['arrived_at'] as Date).getTime() <= now.getTime());
  });

  it('ignores inaccurate fixes even when repeated inside the geofence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    for (let i = 0; i < 4; i += 1) {
      const recorded = await evaluate(
        harness,
        trip,
        clock.fix({ ...AT_STOP_1, accuracy: 500 }),
        clock.now(),
      );
      assert.equal(recorded, null, `fix ${i}`);
    }
    assert.equal(harness.arrivals.created.length, 0);
  });

  it('accepts fixes without accuracy when the operator allows it', async () => {
    // The production default rejects unknown-accuracy fixes (see the
    // `assessFixEligibility` and DEFAULT_ARRIVAL_DETECTION_CONFIG specs); this
    // pins the opt-in path for deployments whose devices omit the field.
    const harness = makeArrivalsHarness({ config: { allowMissingAccuracy: true } });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const recorded = await evaluate(
      harness,
      trip,
      clock.fix({ ...AT_STOP_1, accuracy: null }),
      clock.now(),
    );

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
  });

  it('rejects missing accuracy by default (and when the operator requires it)', async () => {
    const harness = makeArrivalsHarness({ config: { allowMissingAccuracy: false } });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1, accuracy: null }), clock.now());
    const recorded = await evaluate(
      harness,
      trip,
      clock.fix({ ...AT_STOP_1, accuracy: null }),
      clock.now(),
    );

    assert.equal(recorded, null);
    assert.equal(harness.arrivals.created.length, 0);
  });

  it('ignores an implausible jump and recovers on the following fixes', async () => {
    // Pinned at base 2: this test is about jump-gating of accumulated
    // evidence, not the confirm-from-one-fix product default.
    const harness = makeArrivalsHarness({ config: { requiredConsecutiveFixes: 2 } });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    // Teleport ~1.7 km in 3 s — a GPS glitch, not a bus.
    const jumped = await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }), clock.now());
    assert.equal(jumped, null);
    // Back at stop 1: still implausible against the glitch point …
    const back = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    assert.equal(back, null);
    // … then the reference re-syncs and the confirmation lands.
    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
    assert.equal(harness.arrivalNotifications.length, 1);
  });

  it('records a stationary bus without heading or speed', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    // Detection never relies on heading — stationary fixes confirm by
    // sustained presence alone.
    const stationary = { ...AT_STOP_1, heading: null, speed: 0 };

    const recorded = await evaluate(harness, trip, clock.fix(stationary), clock.now());

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_1);
  });

  it('preserves partial evidence inside the hysteresis fringe', async () => {
    // Pinned at base 2: the point is that the fringe preserves (not wipes)
    // the partial inside-evidence of the first fix.
    const harness = makeArrivalsHarness({ config: { requiredConsecutiveFixes: 2 } });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    // ~111 m from stop 1: past the 100 m radius, inside the 20 m fringe.
    const fringe = { latitude: 40.701, longitude: -74.0 };

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const fringed = await evaluate(harness, trip, clock.fix(fringe, 30_000), clock.now());
    assert.equal(fringed, null);
    const recorded = await evaluate(
      harness,
      trip,
      clock.fix({ ...AT_STOP_1 }, 30_000),
      clock.now(),
    );

    assert.ok(recorded, 'fringe jitter must not wipe the first inside fix');
    assert.equal(recorded.stop.id, STOP_1);
  });

  it('resets evidence once the fix leaves the hysteresis fringe', async () => {
    // Pinned at base 2: evidence must visibly rebuild after a real exit.
    const harness = makeArrivalsHarness({ config: { requiredConsecutiveFixes: 2 } });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    // ~200 m from stop 1: outside radius + fringe.
    const outside = { latitude: 40.7018, longitude: -74.0 };

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    await evaluate(harness, trip, clock.fix(outside, 30_000), clock.now());
    const rebuilt = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 30_000), clock.now());
    assert.equal(rebuilt, null, 'evidence must rebuild after leaving');
    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    assert.ok(recorded);
  });

  it('records exactly one arrival for concurrent duplicate fixes', async () => {
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
    // First insert wins, the racing second hits the unique index — the
    // database-level backstop for concurrent evaluations / instances.
    let creates = 0;
    const created: Array<Record<string, unknown>> = [];
    const arrivalsRepo = {
      findAll: async () => [],
      create: async (payload: Record<string, unknown>) => {
        creates += 1;
        if (creates > 1) {
          throw race;
        }
        created.push(payload);
        return {
          id: 'arrival-1',
          arrived_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
          ...payload,
        };
      },
    };
    const stopsStore = makeStopsRepo(DEFAULT_STOPS);
    const arrivalNotifications: StopArrivalNotificationInput[] = [];
    const service = new StopArrivalsService(
      stopsStore.repo as never,
      arrivalsRepo as never,
      {
        computeTripEta: async (input: never) =>
          minimalEtaResponse(
            (input as { trip: { id: string; school_id: string; status: TripStatus } }).trip,
            (input as { latest: StubFix | null }).latest,
          ),
      } as never,
      {
        notifyStopArrival: async (input: StopArrivalNotificationInput): Promise<void> => {
          arrivalNotifications.push(input);
        },
      } as never,
      // Pinned at base 2 (dwell disabled): the warm-up fix must not record, so
      // the two concurrent confirmations below genuinely race for the same
      // insert. Dwell has its own spec; it would otherwise mask this race.
      { ...DEFAULT_ARRIVAL_DETECTION_CONFIG, requiredConsecutiveFixes: 2, minDwellMs: 0 },
    );

    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    await service.onAcceptedFix(trip, clock.fix({ ...AT_STOP_1 }) as never, clock.now());

    const fix = clock.fix({ ...AT_STOP_1 });
    const at = clock.now();
    const [a, b] = await Promise.all([
      service.onAcceptedFix(trip, fix as never, at),
      service.onAcceptedFix(trip, fix as never, at),
    ]);

    const winners = [a, b].filter((result) => result !== null);
    assert.equal(winners.length, 1);
    assert.equal(created.length, 1);
    assert.equal(arrivalNotifications.length, 1);
  });

  it('rebuilds progression after a restart from the database arrivals', async () => {
    // Fresh process memory (new harness), but stop 1 already recorded.
    const harness = makeArrivalsHarness({ arrivals: [makeArrival({ stop_id: STOP_1 })] });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 120_000), clock.now());
    const again = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }), clock.now());

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_2);
    assert.equal(again, null);
  });
});

describe('StopArrivalsService Phase 1 stop progression', () => {
  it('skips a missed stop and keeps later stops working (skip/recovery)', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const atStop1 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    assert.ok(atStop1);

    // Stop 2 never produced a fix (missed samples); stop 3 needs the
    // skip-tier evidence (base 1 + skip extra 1 consecutive fixes).
    const early = await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }, 180_000), clock.now());
    assert.equal(early, null);
    const atStop3 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }), clock.now());
    assert.ok(atStop3);
    assert.equal(atStop3.stop.id, STOP_3);

    // The skipped stop behind the frontier is never recorded afterwards —
    // the skip is final, later stops proceed.
    for (let i = 0; i < 3; i += 1) {
      const late = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 120_000), clock.now());
      assert.equal(late, null, `late fix ${i}`);
    }
    assert.equal(harness.arrivalNotifications.length, 2);
  });

  it('re-syncs far ahead of the frontier with stronger evidence', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Fresh trip, first fixes already at stop 3 (mid-route join): the
    // re-sync tier needs base 1 + skip extra 1 + re-sync 1 consecutive fixes.
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }), clock.now());
    const recorded = await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }), clock.now());

    assert.ok(recorded);
    assert.equal(recorded.stop.id, STOP_3);
    assert.equal(harness.arrivalNotifications.length, 1);
  });

  it('does not record a far-ahead stop from a single glitch fix', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    // One stray fix near stop 3, then back at stop 1 — no arrival, no skip.
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_3 }, 180_000), clock.now());
    const back = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 180_000), clock.now());

    assert.equal(back, null);
    assert.equal(harness.arrivals.created.length, 1);
    assert.equal(harness.arrivals.created[0]['stop_id'], STOP_1);
  });

  it('passes the reference clock through getProgress to the ETA', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const at = new Date('2026-09-01T06:41:30.000Z');

    await harness.service.getProgress(
      trip,
      makeFix({ recorded_at: at, received_at: at }) as never,
      at,
    );

    assert.equal(harness.etaCalls.length, 1);
    assert.equal(harness.etaCalls[0].now, at);
  });
});

describe('assessFixEligibility', () => {
  const config = { ...DEFAULT_ARRIVAL_DETECTION_CONFIG };
  const NOW = new Date('2026-09-01T06:41:30.000Z').getTime();
  const fix = (
    overrides: Partial<{
      latitude: number;
      longitude: number;
      accuracy: number | null;
      recordedMs: number;
    }> = {},
  ) => ({
    latitude: 40.7003,
    longitude: -73.9997,
    accuracy: 10,
    recordedMs: NOW - 2000,
    ...overrides,
  });

  it('accepts a fresh accurate fix without history', () => {
    assert.deepEqual(assessFixEligibility(fix(), null, NOW, config), {
      eligible: true,
      reason: null,
    });
  });

  it('rejects stale fixes but accepts the freshness boundary', () => {
    assert.deepEqual(
      assessFixEligibility(fix({ recordedMs: NOW - config.maxFixAgeMs - 1 }), null, NOW, config),
      { eligible: false, reason: 'stale' },
    );
    assert.deepEqual(
      assessFixEligibility(fix({ recordedMs: NOW - config.maxFixAgeMs }), null, NOW, config),
      { eligible: true, reason: null },
    );
  });

  it('rejects fixes beyond the future tolerance', () => {
    assert.deepEqual(
      assessFixEligibility(
        fix({ recordedMs: NOW + config.futureToleranceMs + 1 }),
        null,
        NOW,
        config,
      ),
      { eligible: false, reason: 'future' },
    );
    assert.deepEqual(
      assessFixEligibility(fix({ recordedMs: NOW + config.futureToleranceMs }), null, NOW, config),
      { eligible: true, reason: null },
    );
  });

  it('rejects inaccurate fixes at the accuracy boundary', () => {
    assert.deepEqual(
      assessFixEligibility(fix({ accuracy: config.maxAccuracyMeters + 1 }), null, NOW, config),
      { eligible: false, reason: 'inaccurate' },
    );
    assert.deepEqual(
      assessFixEligibility(fix({ accuracy: config.maxAccuracyMeters }), null, NOW, config),
      { eligible: true, reason: null },
    );
  });

  it('honours the missing-accuracy policy', () => {
    // Default: an unknown accuracy cannot be trusted to localise inside a small
    // geofence, so it is ineligible.
    assert.deepEqual(assessFixEligibility(fix({ accuracy: null }), null, NOW, config), {
      eligible: false,
      reason: 'missing-accuracy',
    });
    // Opt in per deployment (some devices legitimately omit the field).
    assert.deepEqual(
      assessFixEligibility(fix({ accuracy: null }), null, NOW, {
        ...config,
        allowMissingAccuracy: true,
      }),
      { eligible: true, reason: null },
    );
  });

  it('rejects implausible jumps but accepts plausible drives', () => {
    const last = { latitude: 40.7003, longitude: -73.9997, recordedMs: NOW - 5000 };
    // ~1.7 km in 3 s — impossible.
    assert.deepEqual(
      assessFixEligibility(
        { latitude: 40.6999, longitude: -73.9801, accuracy: 10, recordedMs: NOW - 2000 },
        last,
        NOW,
        config,
      ),
      { eligible: false, reason: 'implausible-jump' },
    );
    // ~840 m in two minutes — a normal drive between stops.
    assert.deepEqual(
      assessFixEligibility(
        {
          latitude: 40.7001,
          longitude: -73.9898,
          accuracy: 10,
          recordedMs: last.recordedMs + 120_000,
        },
        last,
        last.recordedMs + 120_500,
        config,
      ),
      { eligible: true, reason: null },
    );
  });

  it('never treats small stationary wander as a jump', () => {
    const last = { latitude: 40.7003, longitude: -73.9997, recordedMs: NOW - 1000 };
    assert.deepEqual(
      assessFixEligibility(
        { latitude: 40.70032, longitude: -73.99968, accuracy: 10, recordedMs: NOW },
        last,
        NOW + 500,
        config,
      ),
      { eligible: true, reason: null },
    );
  });

  it('treats a large displacement at coinciding timestamps as a jump', () => {
    const last = { latitude: 40.7003, longitude: -73.9997, recordedMs: NOW };
    assert.deepEqual(
      assessFixEligibility(
        { latitude: 40.72, longitude: -73.99, accuracy: 10, recordedMs: NOW },
        last,
        NOW + 500,
        config,
      ),
      { eligible: false, reason: 'implausible-jump' },
    );
  });
});

describe('selectProgressionCandidate', () => {
  // Tier-pure selection math: the escalation counts in these specs
  // ("needs 2 + 1", "2 + 1 + 1") are pinned explicitly so they stay
  // independent of any future change to the product default. Dwell is disabled
  // here so these count-only assertions do not depend on fix timestamps (the
  // dwell rule has its own dedicated spec below).
  const config = {
    ...DEFAULT_ARRIVAL_DETECTION_CONFIG,
    requiredConsecutiveFixes: 2,
    minDwellMs: 0,
  };
  const fix = { latitude: 40.7003, longitude: -73.9997, recordedMs: 100_000 };
  const stops = () => [
    makeStop({ id: STOP_1, sequence_number: 1, latitude: 40.7003, longitude: -73.9997 }),
    makeStop({ id: STOP_2, sequence_number: 2, latitude: 40.7003, longitude: -73.9997 }),
  ];

  it('returns null for empty route stop sets', () => {
    assert.equal(
      selectProgressionCandidate({
        stops: [],
        arrivedStopIds: new Set(),
        seenStopIds: undefined,
        inside: new Map(),
        fix,
        config,
      }),
      null,
    );
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
    const inside = new Map(
      candidates.map((stop) => [stop.id, { count: 9, sinceMs: fix.recordedMs - 60_000 }]),
    );
    const chosen = selectProgressionCandidate({
      stops: candidates,
      arrivedStopIds: new Set(),
      seenStopIds: undefined,
      inside,
      fix,
      config,
    });
    assert.ok(chosen);
    assert.equal(chosen.stop.id, STOP_1);
  });

  it('skips stops that already arrived or were seen this process', () => {
    const inside = new Map([
      [STOP_1, { count: 9, sinceMs: 0 }],
      [STOP_2, { count: 9, sinceMs: 0 }],
    ]);
    const chosen = selectProgressionCandidate({
      stops: stops(),
      arrivedStopIds: new Set([STOP_1]),
      seenStopIds: undefined,
      inside,
      fix,
      config,
    });
    // STOP_2 is ahead of the stop-1 frontier and fully evidenced.
    assert.ok(chosen);
    assert.equal(chosen.stop.id, STOP_2);
    assert.equal(
      selectProgressionCandidate({
        stops: stops(),
        arrivedStopIds: new Set(),
        seenStopIds: new Set([STOP_1, STOP_2]),
        inside,
        fix,
        config,
      }),
      null,
    );
  });

  it('requires consecutive evidence before confirming', () => {
    const routeStops = stops();
    const partial = new Map([[STOP_1, { count: 1, sinceMs: fix.recordedMs }]]);
    assert.equal(
      selectProgressionCandidate({
        stops: routeStops,
        arrivedStopIds: new Set(),
        seenStopIds: undefined,
        inside: partial,
        fix,
        config,
      }),
      null,
    );
    const confirmed = new Map([[STOP_1, { count: 2, sinceMs: fix.recordedMs - 3000 }]]);
    const chosen = selectProgressionCandidate({
      stops: routeStops,
      arrivedStopIds: new Set(),
      seenStopIds: undefined,
      inside: confirmed,
      fix,
      config,
    });
    assert.ok(chosen);
    assert.equal(chosen.stop.id, STOP_1);
  });

  it('lets a skipped-ahead stop win once its extra evidence lands', () => {
    const routeStops = [
      makeStop({ id: STOP_1, sequence_number: 1 }),
      makeStop({ id: STOP_2, sequence_number: 2, latitude: 40.7003, longitude: -73.9997 }),
      makeStop({ id: STOP_3, sequence_number: 3, latitude: 40.7003, longitude: -73.9997 }),
    ];
    // Stop 3 is one past the next unarrived stop 2: needs 2 + 1 fixes.
    const partial = new Map([[STOP_3, { count: 2, sinceMs: fix.recordedMs - 6000 }]]);
    assert.equal(
      selectProgressionCandidate({
        stops: routeStops,
        arrivedStopIds: new Set([STOP_1]),
        seenStopIds: undefined,
        inside: partial,
        fix,
        config,
      }),
      null,
    );
    const confirmed = new Map([[STOP_3, { count: 3, sinceMs: fix.recordedMs - 9000 }]]);
    const chosen = selectProgressionCandidate({
      stops: routeStops,
      arrivedStopIds: new Set([STOP_1]),
      seenStopIds: undefined,
      inside: confirmed,
      fix,
      config,
    });
    assert.ok(chosen);
    assert.equal(chosen.stop.id, STOP_3);
  });

  it('never records a stop behind the progress frontier', () => {
    const routeStops = [
      makeStop({ id: STOP_1, sequence_number: 1, latitude: 40.7003, longitude: -73.9997 }),
      makeStop({ id: STOP_2, sequence_number: 2, latitude: 40.7003, longitude: -73.9997 }),
      makeStop({ id: STOP_3, sequence_number: 3 }),
    ];
    const inside = new Map([
      [STOP_1, { count: 9, sinceMs: 0 }],
      [STOP_2, { count: 9, sinceMs: 0 }],
    ]);
    assert.equal(
      selectProgressionCandidate({
        stops: routeStops,
        arrivedStopIds: new Set([STOP_3]),
        seenStopIds: undefined,
        inside,
        fix,
        config,
      }),
      null,
    );
  });

  it('demands re-sync evidence far beyond the skip window', () => {
    const stop4 = makeStop({
      id: '22222222-2222-4222-8222-222222220004',
      sequence_number: 4,
      latitude: 40.7003,
      longitude: -73.9997,
    });
    const routeStops = [
      makeStop({ id: STOP_1, sequence_number: 1 }),
      makeStop({ id: STOP_2, sequence_number: 2 }),
      makeStop({ id: STOP_3, sequence_number: 3 }),
      stop4,
    ];
    // Frontier 1, window 2: stop 4 needs 2 + 1 + 1 fixes.
    const partial = new Map([[stop4.id, { count: 3, sinceMs: fix.recordedMs - 9000 }]]);
    assert.equal(
      selectProgressionCandidate({
        stops: routeStops,
        arrivedStopIds: new Set([STOP_1]),
        seenStopIds: undefined,
        inside: partial,
        fix,
        config,
      }),
      null,
    );
    const confirmed = new Map([[stop4.id, { count: 4, sinceMs: fix.recordedMs - 12_000 }]]);
    const chosen = selectProgressionCandidate({
      stops: routeStops,
      arrivedStopIds: new Set([STOP_1]),
      seenStopIds: undefined,
      inside: confirmed,
      fix,
      config,
    });
    assert.ok(chosen);
    assert.equal(chosen.stop.id, stop4.id);
  });

  it('ranks overlapping stops by evidence, then distance, then sequence', () => {
    const near = makeStop({
      id: STOP_2,
      sequence_number: 2,
      latitude: 40.7003,
      longitude: -73.9997,
      geofence_radius_meters: 500,
    });
    const far = makeStop({
      id: STOP_3,
      sequence_number: 3,
      latitude: 40.702,
      longitude: -73.9997,
      geofence_radius_meters: 500,
    });
    const routeStops = [makeStop({ id: STOP_1, sequence_number: 1 }), near, far];
    // Both qualify with equal evidence (stop 2 at the skip tier, stop 3 at
    // the re-sync tier with 4 fixes).
    const inside = new Map([
      [STOP_2, { count: 4, sinceMs: 0 }],
      [STOP_3, { count: 4, sinceMs: 0 }],
    ]);
    const chosen = selectProgressionCandidate({
      stops: routeStops,
      arrivedStopIds: new Set(),
      seenStopIds: undefined,
      inside,
      fix,
      config,
    });
    assert.ok(chosen);
    // Equal evidence → the nearer stop wins despite the higher sequence.
    assert.equal(chosen.stop.id, STOP_2);

    // Equal evidence at equal distance → the earlier sequence wins.
    const twin = makeStop({
      id: STOP_3,
      sequence_number: 3,
      latitude: 40.7003,
      longitude: -73.9997,
      geofence_radius_meters: 500,
    });
    const twinChosen = selectProgressionCandidate({
      stops: [makeStop({ id: STOP_1, sequence_number: 1 }), near, twin],
      arrivedStopIds: new Set(),
      seenStopIds: undefined,
      inside,
      fix,
      config,
    });
    assert.ok(twinChosen);
    assert.equal(twinChosen.stop.id, STOP_2);
  });

  it('honours the minimum dwell span when configured', () => {
    const routeStops = stops();
    const dwell = { ...config, minDwellMs: 10_000 };
    const quick = new Map([[STOP_1, { count: 5, sinceMs: fix.recordedMs - 3000 }]]);
    assert.equal(
      selectProgressionCandidate({
        stops: routeStops,
        arrivedStopIds: new Set(),
        seenStopIds: undefined,
        inside: quick,
        fix,
        config: dwell,
      }),
      null,
    );
    const settled = new Map([[STOP_1, { count: 5, sinceMs: fix.recordedMs - 12_000 }]]);
    const chosen = selectProgressionCandidate({
      stops: routeStops,
      arrivedStopIds: new Set(),
      seenStopIds: undefined,
      inside: settled,
      fix,
      config: dwell,
    });
    assert.ok(chosen);
    assert.equal(chosen.stop.id, STOP_1);
  });
});

describe('StopArrivalsService arrival → notification durability (fix D)', () => {
  it('persists the arrival and the notification fan-out in one transaction', async () => {
    const clock = clockFrom('2026-09-18T06:00:00.000Z');
    const harness = makeArrivalsHarness({ withTransaction: true });
    const trip = asTrip(makeTrip());

    const recorded = await evaluate(harness, trip, clock.fix(AT_STOP_1), clock.now());
    const again = await evaluate(harness, trip, clock.fix(AT_STOP_1), clock.now());

    assert.ok(recorded, 'the arrival is recorded');
    assert.equal(again, null, 'the same visit records exactly once');
    assert.equal(harness.transaction?.stats.started, 1, 'exactly one transaction');
    assert.equal(harness.transaction?.stats.committed, 1);
    assert.equal(harness.transaction?.stats.rolledBack, 0);
    assert.equal(harness.arrivals.rows.length, 1, 'the arrival row exists');
    assert.equal(harness.arrivalNotifications.length, 1, 'and its notification intent');
    assert.ok(
      harness.notificationCalls[0].transaction,
      'the fan-out joined the arrival transaction',
    );
  });

  it('rolls the arrival back when the notification fan-out fails (no committed arrival without intent)', async () => {
    const clock = clockFrom('2026-09-18T06:00:00.000Z');
    const harness = makeArrivalsHarness({
      withTransaction: true,
      notificationError: new Error('notification insert failed'),
    });
    const trip = asTrip(makeTrip());

    // With the confirm-from-one-fix default every eligible fix attempts to
    // record — and every attempt rolls back with its fan-out.
    const first = await evaluate(harness, trip, clock.fix(AT_STOP_1), clock.now());
    const second = await evaluate(harness, trip, clock.fix(AT_STOP_1), clock.now());
    const third = await evaluate(harness, trip, clock.fix(AT_STOP_1), clock.now());

    assert.equal(first, null, 'the fix yields no recorded arrival');
    assert.equal(second, null);
    assert.equal(third, null);
    assert.equal(harness.transaction?.stats.rolledBack, 3, 'every attempt rolled back');
    assert.equal(harness.arrivals.rows.length, 0, 'no arrival survived the rollback');
    assert.equal(harness.arrivalNotifications.length, 0);
    assert.equal(
      harness.broadcasts.filter((b) => b.event === LIVE_TRACKING_EVENTS.stopArrived).length,
      0,
      'a rolled-back arrival is never broadcast',
    );
  });

  it('recovers on the next fix once the fan-out works again', async () => {
    const clock = clockFrom('2026-09-18T06:00:00.000Z');
    const failing = makeArrivalsHarness({
      withTransaction: true,
      notificationError: new Error('temporary failure'),
    });
    const trip = asTrip(makeTrip());
    await evaluate(failing, trip, clock.fix(AT_STOP_1), clock.now());
    assert.equal(
      failing.transaction?.stats.rolledBack,
      1,
      'the failing attempt rolled back (a real transaction leaves no row)',
    );

    // Same trip/fix sequence, healthy notifications service.
    const healthy = makeArrivalsHarness({ withTransaction: true });
    const recovered = await evaluate(healthy, trip, clock.fix(AT_STOP_1), clock.now());
    const again = await evaluate(healthy, trip, clock.fix(AT_STOP_1), clock.now());

    assert.ok(recovered, 'the arrival is recorded on the retry');
    assert.equal(again, null);
    assert.equal(healthy.arrivals.rows.length, 1);
    assert.equal(healthy.arrivalNotifications.length, 1);
  });

  it('does not mark the stop as seen when the transaction rolled back', async () => {
    const clock = clockFrom('2026-09-18T06:00:00.000Z');
    const harness = makeArrivalsHarness({
      withTransaction: true,
      notificationError: new Error('boom'),
    });
    const trip = asTrip(makeTrip());

    const first = await evaluate(harness, trip, clock.fix(AT_STOP_1), clock.now());
    // The attempt failed and rolled back — nothing was recorded.
    assert.equal(first, null);
    harness.arrivals.rows.length = 0;
    const service = harness.service as unknown as { seenByTrip: Map<string, Set<string>> };
    assert.ok(
      !service.seenByTrip.get(TRIP_A)?.has(STOP_1),
      'a rolled-back arrival must not enter the in-memory seen set',
    );
  });
});

describe('arrival confirmation default and progression tiers', () => {
  it('requires two sustained in-geofence fixes for the next stop by default', () => {
    // Deep-fix P0-1: one fix is too weak for a small geofence, so the next
    // stop records from two consecutive eligible fixes with a 10 s dwell. The
    // departure / inter-stop gates (not this count) are what stop a stationary
    // bus cascading through every stop.
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.requiredConsecutiveFixes, 2);
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.minDwellMs, 10_000);
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.allowMissingAccuracy, false);
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.minInterStopMs, 30_000);
    // Deep-fix R2: the route-blind distance floor is OFF by default — it is
    // what silently dropped close consecutive stops (see the config doc).
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.minInterStopDistanceMeters, 0);
    // Deep-fix R1: every stop's effective radius is floored — the arrival
    // zone is a circle a parked bus can stand inside, never a point. The
    // floor is 25 m, not 50 (the drawn ring was far too big) and not 5 (a
    // 5 m circle makes the accuracy gate unsatisfiable for a phone fix).
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.minEffectiveRadiusMeters, 25);
  });

  it('maps each progression tier to its required consecutive fixes', () => {
    const tiers = {
      requiredConsecutiveFixes: 2,
      skipExtraFixes: 1,
      maxSkipAhead: 2,
    };
    // Next unarrived (sequence 2): the base tier only.
    assert.equal(requiredFixesForProgression(2, 0, 2, tiers), 2);
    assert.equal(requiredFixesForProgression(1, 0, 2, tiers), 2);
    // One past the next unarrived, within the skip window of the frontier
    // (1 + 2 = 3): base + skip extra.
    assert.equal(requiredFixesForProgression(3, 1, 2, tiers), 3);
    // Beyond the skip window of the frontier: + re-sync (2 + 1 + 1).
    assert.equal(requiredFixesForProgression(4, 1, 2, tiers), 4);
    assert.equal(requiredFixesForProgression(3, 0, 2, tiers), 4);
    // Same mapping with the product default (base 2).
    assert.equal(requiredFixesForProgression(2, 0, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 2);
    assert.equal(requiredFixesForProgression(3, 1, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 3);
    assert.equal(requiredFixesForProgression(3, 0, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 4);
    assert.equal(requiredFixesForProgression(4, 0, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 4);
  });
});

describe('getProgress arrival_diagnostics', () => {
  it('explains the last fix rejection and the per-stop evidence state', async () => {
    const harness = makeArrivalsHarness();
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Stale fix: the rejection reason must surface in the diagnostics.
    await evaluate(
      harness,
      trip,
      makeFix({
        ...AT_STOP_1,
        recorded_at: new Date('2026-09-01T04:41:30.000Z'),
        received_at: new Date('2026-09-01T06:41:30.000Z'),
      }),
      clock.now(),
    );
    const staleProgress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(staleProgress.arrival_diagnostics?.last_fix_rejection, 'stale');
    assert.deepEqual(staleProgress.arrival_diagnostics?.unsurveyed_stops, []);
    assert.equal(staleProgress.arrival_diagnostics?.pending_stops.length, 3);

    // A stop far ahead of the frontier reports its escalated tier
    // (base 1 + skip extra 1 + re-sync 1 at frontier 0).
    const ahead = staleProgress.arrival_diagnostics?.pending_stops.find(
      (entry) => entry.stop_id === STOP_3,
    );
    assert.equal(ahead?.inside_count, 0);
    assert.equal(ahead?.required_fixes, 3);

    // One eligible fix records the next stop and clears the rejection.
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.last_fix_rejection, null);
    const pending = progress.arrival_diagnostics?.pending_stops.map((entry) => entry.stop_id);
    assert.deepEqual(pending, [STOP_2, STOP_3]);
  });

  it('lists un-surveyed stops once and never waits on them', async () => {
    const unSurveyed = makeStop({
      id: STOP_NO_COORDS,
      name: 'Unsurveyed Lane',
      sequence_number: 2,
      latitude: null,
      longitude: null,
    });
    const harness = makeArrivalsHarness({
      stops: [makeStop({ id: STOP_1, sequence_number: 1 }), unSurveyed, makeStop({ id: STOP_3, sequence_number: 3, longitude: -73.98 })],
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Stop 1 records from one fix; the un-surveyed stop 2 is announced …
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }), clock.now());
    const progress = await harness.service.getProgress(trip, null, clock.now());

    const warnings = progress.arrival_diagnostics?.unsurveyed_stops ?? [];
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.stop_id, STOP_NO_COORDS);
    assert.equal(warnings[0]?.code, 'stop_missing_coordinates');
    assert.equal(warnings[0]?.stop_name, 'Unsurveyed Lane');

    // … never waits on it: pending stops are recordable-only, so progress
    // evidence moves to stop 3 (the `next_stop` mirror of this rule is pinned
    // in eta.service.spec with a real EtaService).
    const pendingIds = (progress.arrival_diagnostics?.pending_stops ?? []).map((entry) => entry.stop_id);
    assert.deepEqual(pendingIds, [STOP_3]);
  });
});

describe('StopArrivalsService P0-1 stationary-bus cascade gates (production defaults)', () => {
  // These regression cases run with the FULL production detection config
  // (two confirming fixes, a 10 s dwell, missing-accuracy rejected, and the
  // 30 s / 50 m inter-stop gates) — the harness otherwise relaxes confirmation
  // strength for the mechanic specs above.
  const PROD = DEFAULT_ARRIVAL_DETECTION_CONFIG;

  // Three heavily overlapping geofences: a bus parked at one point sits inside
  // all three at once — the exact field condition that cascaded every stop.
  const OVERLAPPING_STOPS = [
    makeStop({ id: STOP_1, name: 'Home', sequence_number: 1, geofence_radius_meters: 2000 }),
    makeStop({ id: STOP_2, name: 'Oak Ave', sequence_number: 2, longitude: -73.99, geofence_radius_meters: 2000 }),
    makeStop({ id: STOP_3, name: 'Maple St', sequence_number: 3, longitude: -73.98, geofence_radius_meters: 2000 }),
  ];

  it('(a) a stationary bus inside three overlapping geofences records ONLY the first stop', async () => {
    const harness = makeArrivalsHarness({ stops: OVERLAPPING_STOPS, config: PROD });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Six stationary fixes, 11 s apart (satisfying the 10 s dwell). Without
    // the departure gate this cascaded stop 1 → 2 → 3.
    for (let i = 0; i < 6; i += 1) {
      await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 11_000), clock.now());
    }

    assert.equal(harness.arrivals.created.length, 1, 'exactly one stop records');
    assert.equal(harness.arrivals.created[0]['stop_id'], STOP_1);
    assert.equal(harness.arrivalNotifications.length, 1, 'exactly one parent notification');
    assert.equal(
      harness.broadcasts.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.stopArrived).length,
      1,
      'no cascade announcements',
    );

    // The subsequent fixes were rejected with an explainable diagnostic reason.
    const progress = await harness.service.getProgress(trip, null, clock.now());
    const diag = progress.arrival_diagnostics;
    assert.equal(diag?.last_gate_block, 'awaiting-departure');
    assert.equal(diag?.departure_gate?.frontier_stop_id, STOP_1);
    assert.equal(diag?.departure_gate?.departed, false);
    assert.equal(diag?.last_arrival?.stop_id, STOP_1);
    const firstPending = diag?.pending_stops[0];
    assert.equal(firstPending?.stop_id, STOP_2);
    assert.equal(firstPending?.blocked_reason, 'awaiting-departure');
  });

  it('(b) a bus that departs stop N then enters stop N+1 records N+1 normally', async () => {
    const harness = makeArrivalsHarness({ config: PROD });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Records stop 1 (two confirming fixes, 11 s apart).
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 11_000), clock.now());
    const recordedStop1 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 11_000), clock.now());
    assert.ok(recordedStop1);
    assert.equal(recordedStop1.stop.id, STOP_1);

    // A fix on the road between the stops — outside stop 1's geofence — opens
    // the departure gate.
    await evaluate(harness, trip, clock.fix({ latitude: 40.7, longitude: -73.995 }, 11_000), clock.now());

    // Two confirming fixes at stop 2, well past the 30 s / 50 m inter-stop
    // gates: it records normally.
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 30_000), clock.now());
    const recordedStop2 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 11_000), clock.now());

    assert.ok(recordedStop2, 'a genuinely moving bus still records the next stop');
    assert.equal(recordedStop2.stop.id, STOP_2);
    assert.equal(harness.arrivals.created.length, 2);
  });

  it('(c) the inter-stop time gate blocks an instant re-record after a departure', async () => {
    // Departure gate satisfied on its own, dwell/confirmation minimised — so
    // the ONLY thing under test is the 30 s inter-stop cooldown. Distance gate
    // disabled to isolate it.
    const harness = makeArrivalsHarness({
      config: { ...PROD, requiredConsecutiveFixes: 1, minDwellMs: 0, minInterStopDistanceMeters: 0 },
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Stop 1 records at t = 5 s.
    const stop1 = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 5_000), clock.now());
    assert.ok(stop1);

    // Depart stop 1 (outside its geofence).
    await evaluate(harness, trip, clock.fix({ latitude: 40.7, longitude: -73.995 }, 5_000), clock.now());

    // Enter stop 2 only 20 s after the stop 1 arrival — the cooldown blocks it.
    const tooSoon = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 10_000), clock.now());
    assert.equal(tooSoon, null, 'a second stop cannot record within the cooldown');
    const progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.last_gate_block, 'inter-stop-cooldown');

    // Once the cooldown has elapsed (> 30 s after the stop 1 arrival) it records.
    const later = await evaluate(harness, trip, clock.fix({ ...AT_STOP_2 }, 20_000), clock.now());
    assert.ok(later, 'the same stop records once the cooldown clears');
    assert.equal(later.stop.id, STOP_2);
  });

  it('(d) a fix with accuracy worse than the stop\'s effective radius is ignored', async () => {
    // Deep-fix R1 re-derived this case: the gate is no longer `radius / 2` but
    // `min(ARRIVAL_MAX_ACCURACY_METERS, effectiveRadius)`. A 40 m stop has an
    // effective radius of 50 m (the floor), so:
    // - a 30 m fix — typical urban/indoor phone accuracy, and the reading that
    //   the old /2 rule threw away even though the bus was inside the circle —
    //   now COUNTS (that is the field defect this batch fixes);
    // - a 60 m fix is coarser than the whole circle and still never counts.
    const stop = makeStop({
      id: STOP_1,
      sequence_number: 1,
      latitude: 40.7003,
      longitude: -73.9997,
      geofence_radius_meters: 40,
    });
    const harness = makeArrivalsHarness({
      stops: [stop],
      config: { ...PROD, requiredConsecutiveFixes: 1, minDwellMs: 0 },
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');
    const atCenter = { latitude: 40.7003, longitude: -73.9997 };

    // A coarse-but-inside fix: accuracy 60 m cannot localise inside a 50 m
    // effective circle, so it never counts toward the stop.
    await evaluate(harness, trip, clock.fix({ ...atCenter, accuracy: 60 }, 11_000), clock.now());
    const tooCoarse = await evaluate(
      harness,
      trip,
      clock.fix({ ...atCenter, accuracy: 60 }, 11_000),
      clock.now(),
    );
    assert.equal(tooCoarse, null, 'accuracy > effective radius never counts toward the stop');
    assert.equal(harness.arrivals.created.length, 0);

    // A typical-phone fix (30 m accuracy) records the same stop: the bus is
    // inside the circle and the fix is precise enough to say so.
    const typicalPhone = await evaluate(
      harness,
      trip,
      clock.fix({ ...atCenter, accuracy: 30 }, 11_000),
      clock.now(),
    );
    assert.ok(typicalPhone, 'a 30 m-accuracy fix inside a 50 m effective circle records');
    assert.equal(typicalPhone.stop.id, STOP_1);
  });

  it('(e) a crew-marked arrival also arms the departure gate', async () => {
    const harness = makeArrivalsHarness({
      stops: OVERLAPPING_STOPS,
      config: { ...PROD, requiredConsecutiveFixes: 1, minDwellMs: 0 },
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // The crew taps "Arrived" at stop 1 — the manual escape hatch, instant.
    await harness.service.recordCrewStopMark({
      trip,
      stop: { id: STOP_1, name: 'Home', sequence_number: 1 },
      actorUserId: '77777777-7777-4777-8777-777777770001',
      skipReason: null,
    });
    assert.equal(harness.arrivals.created.length, 1);

    // The bus is still parked at stop 1, inside stop 2's overlapping geofence.
    // Because the crew mark armed the departure gate, stop 2 must not record.
    for (let i = 0; i < 4; i += 1) {
      const blocked = await evaluate(harness, trip, clock.fix({ ...AT_STOP_1 }, 11_000), clock.now());
      assert.equal(blocked, null, `crew-marked frontier holds stop 2 (fix ${i})`);
    }
    assert.equal(
      harness.arrivals.created.filter((row) => row['stop_id'] === STOP_2).length,
      0,
      'no geofence arrival for stop 2 while the bus has not departed stop 1',
    );

    const progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.last_gate_block, 'awaiting-departure');
    assert.equal(progress.arrival_diagnostics?.departure_gate?.frontier_stop_id, STOP_1);
  });
});

/**
 * Deep-fix R1 — the arrival zone is a standard circle, not a point.
 *
 * Field defect: a bus parked at a stop (live GPS wandering ±3–6 m) only
 * recorded when a fix landed almost exactly on the stop's coordinates,
 * because (a) legacy stops could store a 10 m radius — smaller than the
 * phone's reported accuracy — and (b) the per-stop accuracy gate demanded
 * accuracy ≤ radius/2 (5 m for a 10 m stop). These cases pin the fix: the
 * effective-radius floor (max(stored, ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS))
 * everywhere the radius participates, and the accuracy gate softened to
 * `min(ARRIVAL_MAX_ACCURACY_METERS, effectiveRadius)`.
 */
describe('R1 effective arrival circle (standard circle, not a point)', () => {
  const PROD = DEFAULT_ARRIVAL_DETECTION_CONFIG;

  /** ~20 m north of a point at 40.7°N (1° latitude ≈ 111.1 km). */
  const ABOUT_20M_NORTH = { latitude: 40.70018, longitude: -74.0 };
  /** ~40 m north of the same point. */
  const ABOUT_40M_NORTH = { latitude: 40.70036, longitude: -74.0 };
  /** ~80 m north of the same point. */
  const ABOUT_80M_NORTH = { latitude: 40.70072, longitude: -74.0 };

  it('floors a 10 m stop to the effective radius for evidence and selection', () => {
    const stop = makeStop({ id: STOP_1, geofence_radius_meters: 10 });
    // The stored radius is 10 m; the effective radius is the 25 m floor.
    assert.equal(effectiveStopRadiusMeters(stop, PROD), 25);
    // A larger stored radius is the admin's intent and passes through.
    assert.equal(
      effectiveStopRadiusMeters(makeStop({ geofence_radius_meters: 150 }), PROD),
      150,
    );

    // Inside-evidence: a fix 20 m from the stop with typical phone accuracy
    // accumulates evidence for the 10 m stop (outside its stored radius,
    // inside the effective circle).
    const inside = new Map<string, { count: number; sinceMs: number }>();
    updateInsideEvidence(
      inside,
      [stop],
      new Set<string>(),
      undefined,
      { latitude: ABOUT_20M_NORTH.latitude, longitude: ABOUT_20M_NORTH.longitude, accuracy: 15 },
      1_000,
      PROD.exitHysteresisMeters,
      PROD,
    );
    assert.equal(inside.get(STOP_1)?.count, 1, 'a 20 m fix counts for a floored 10 m stop');

    // Candidate selection uses the same circle: two fixes of evidence + the
    // dwell span qualify the stop as the progression candidate.
    const selection = selectProgressionCandidate({
      stops: [stop],
      arrivedStopIds: new Set<string>(),
      seenStopIds: undefined,
      inside: new Map<string, { count: number; sinceMs: number }>([
        [STOP_1, { count: 2, sinceMs: 1_000 }],
      ]),
      fix: { ...ABOUT_20M_NORTH, recordedMs: 12_000 },
      config: PROD,
    });
    assert.ok(selection, 'a fix 20 m from a 10 m stop selects it via the effective radius');
    assert.equal(selection.stop.id, STOP_1);
    closeTo(selection.distanceMeters, 20, 6);
  });

  it('a 10 m stop records from a fix 20 m away with 15 m accuracy (production defaults)', async () => {
    // The exact field scenario: a small legacy stop, the bus parked ~20 m
    // short of the pin (admins pin stops on roads), phone accuracy 15 m —
    // the typical figure the 25 m floor exists to keep recordable.
    const harness = makeArrivalsHarness({
      stops: [makeStop({ id: STOP_1, geofence_radius_meters: 10 })],
      config: PROD,
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    const first = await evaluate(
      harness,
      trip,
      clock.fix({ ...ABOUT_20M_NORTH, accuracy: 15 }, 11_000),
      clock.now(),
    );
    assert.equal(first, null, 'the first fix only accumulates evidence');
    const second = await evaluate(
      harness,
      trip,
      clock.fix({ ...ABOUT_20M_NORTH, accuracy: 15 }, 11_000),
      clock.now(),
    );

    assert.ok(second, 'two sustained fixes inside the effective circle record the stop');
    assert.equal(second.stop.id, STOP_1);
    closeTo(second.distanceMeters, 20, 6);
    assert.equal(harness.arrivalNotifications.length, 1);
  });

  it('the accuracy gate is min(maxAccuracy, effectiveRadius) — the /2 divisor is gone', () => {
    // The old rule: a 40 m radius demanded ≤ 20 m accuracy. The new rule uses
    // the effective radius (50 m floor), so a 30 m fix counts and a 60 m fix
    // does not — the gate rejects only fixes too coarse for the whole circle.
    assert.equal(fixAccuracySufficientForStop(30, 50, PROD), true);
    assert.equal(fixAccuracySufficientForStop(50, 50, PROD), true);
    assert.equal(fixAccuracySufficientForStop(60, 50, PROD), false);
    // The global ceiling still applies even to large stops.
    assert.equal(fixAccuracySufficientForStop(120, 150, PROD), false);
    // Unknown accuracy stays ineligible by default (anti-cascade is the
    // departure/dwell/cooldown gates' job, not this field).
    assert.equal(fixAccuracySufficientForStop(null, 50, PROD), false);
    assert.equal(
      fixAccuracySufficientForStop(null, 50, { ...PROD, allowMissingAccuracy: true }),
      true,
    );
  });

  it('the departure gate waits for the EFFECTIVE radius + hysteresis, not the stored one', async () => {
    // Stop 1 stores a 10 m radius. Departure must require the bus to leave
    // the 25 m effective circle (+20 m fringe = 45 m), not the 30 m the
    // stored radius would imply — otherwise a bus 40 m out (still inside the
    // effective margin) would look "departed".
    const harness = makeArrivalsHarness({
      stops: DEFAULT_STOPS.map((stop) =>
        stop.id === STOP_1 ? { ...stop, geofence_radius_meters: 10 } : stop,
      ),
      config: { ...PROD, requiredConsecutiveFixes: 1, minDwellMs: 0 },
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Record stop 1 (~20 m from the pin — outside the stored 10 m circle,
    // inside the 25 m effective one: only the floor makes this record).
    const recorded = await evaluate(
      harness,
      trip,
      clock.fix({ ...ABOUT_20M_NORTH }, 5_000),
      clock.now(),
    );
    assert.ok(recorded, 'stop 1 records via the effective radius');
    assert.equal(recorded.stop.id, STOP_1);

    // A fix 40 m north of stop 1: outside stored 10 m + 20 m fringe, but still
    // inside the effective 25 m + 20 m = 45 m — NOT departed (and stop 2,
    // ~840 m away, is not even a candidate yet, so nothing records).
    await evaluate(harness, trip, clock.fix({ ...ABOUT_40M_NORTH }, 5_000), clock.now());
    let progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.departure_gate?.departed, false);
    assert.equal(harness.arrivals.created.length, 1);

    // A fix 80 m north of stop 1 — beyond the effective circle + fringe —
    // opens the gate.
    await evaluate(harness, trip, clock.fix({ ...ABOUT_80M_NORTH }, 5_000), clock.now());
    progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.departure_gate?.departed, true);
  });
});

/**
 * Deep-fix R2 — close consecutive stops must record when the bus serves them.
 *
 * Field defect: stop 2 appeared in the stops list but "the bus never took its
 * name" — no arrival row, no voice line. Root cause (re-verified on this
 * codebase): the stop editor's spacing rule (`2 × the larger radius`,
 * `stops/stop-spacing.ts`) allows stops 20–30 m apart whenever both radii are
 * ≤ 15 m — legal data at the legacy 10 m validation minimum, so such routes
 * exist. On them:
 *
 * - the 50 m `ARRIVAL_MIN_INTERSTOP_DISTANCE_METERS` gate (route-blind,
 *   measured from the previous arrival's RECORDING FIX) blocked stop 2 for
 *   the whole dwell, and
 * - the departure gate (radius + 20 m hysteresis) compounded it: standing
 *   30 m from stop 1 is never "departed" from a 10 m + 20 m = 30 m margin,
 *   let alone the 70 m effective margin R1 introduced.
 *
 * By the time either gate opened, the bus had left stop 2's geofence, the
 * frontier moved on, and "skip is final" dropped stop 2 silently.
 *
 * The fix (both gates): the distance gate defaults to 0 (disabled — the env
 * stays for deployments that want an absolute floor), and the departure gate
 * gained a geometry-aware "moved on toward a later stop" clause
 * (`hasMovedOnTowardAheadStop`). The anti-cascade load now rests entirely on
 * the departure gate + the 30 s cooldown + the 10 s dwell + the consecutive
 * fix count — none of which is distance-blind.
 */
describe('R2 close consecutive stops (production defaults)', () => {
  const PROD = DEFAULT_ARRIVAL_DETECTION_CONFIG;

  // Two stops 30 m apart, both legacy 10 m radii (the only data shape the
  // editor permits at that spacing). Effective radius: 50 m each (the R1
  // floor), so the circles overlap — exactly the field geometry.
  const CLOSE_STOPS = [
    makeStop({ id: STOP_1, name: 'Home', sequence_number: 1, latitude: 40.7, longitude: -74.0, geofence_radius_meters: 10 }),
    makeStop({ id: STOP_2, name: 'Oak Ave', sequence_number: 2, latitude: 40.70027, longitude: -74.0, geofence_radius_meters: 10 }),
    makeStop({ id: STOP_3, name: 'Maple St', sequence_number: 3, latitude: 40.706, longitude: -73.99, geofence_radius_meters: 100 }),
  ];
  const AT_CLOSE_STOP_1 = { latitude: 40.7, longitude: -74.0 };
  const AT_CLOSE_STOP_2 = { latitude: 40.70027, longitude: -74.0 };

  it('two stops 30 m apart both record when the bus serves them (40 s dwell)', async () => {
    const harness = makeArrivalsHarness({ stops: CLOSE_STOPS, config: PROD });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // The bus dwells at stop 1: two fixes 11 s apart record it.
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    const stop1 = await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    assert.ok(stop1, 'stop 1 records');
    assert.equal(stop1.stop.id, STOP_1);

    // One more fix still parked at stop 1 — stop 2 must NOT record even
    // though the (floored, overlapping) circle contains this fix: the bus is
    // closest to the frontier, so the departure gate holds (the new cascade
    // risk the effective-radius floor could have created — pinned here).
    const stillParked = await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    assert.equal(stillParked, null, 'a stationary bus at stop 1 does not cascade to stop 2');

    // The bus drives the 30 m leg and dwells ~40 s at stop 2.
    let stop2: { stop: { id: string } } | null = null;
    for (let i = 0; i < 5; i += 1) {
      const recorded = await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_2, accuracy: 10 }, 11_000), clock.now());
      if (recorded !== null) {
        stop2 = recorded;
        break;
      }
    }
    assert.ok(stop2, 'stop 2 records once the bus is at it and the cooldown has elapsed');
    assert.equal(stop2.stop.id, STOP_2);
    assert.equal(harness.arrivals.created.length, 2, 'exactly the two served stops');
    assert.equal(harness.arrivalNotifications.length, 2);

    // And the diagnostics no longer claim an inter-stop-distance block.
    const progress = await harness.service.getProgress(trip, null, clock.now());
    assert.notEqual(progress.arrival_diagnostics?.last_gate_block, 'inter-stop-distance');
  });

  it('the departure gate explains itself while the bus stands at the close next stop', async () => {
    const harness = makeArrivalsHarness({ stops: CLOSE_STOPS, config: PROD });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Record stop 1, then move to stop 2 immediately (within the cooldown).
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    // Two fixes at stop 2 so it is a full-evidence candidate. (With the 25 m
    // effective floor, standing at stop 1 no longer accumulates evidence for
    // a stop 30 m away — the circles no longer overlap, which is exactly the
    // "the ring is far too big" complaint being fixed.)
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_2, accuracy: 10 }, 11_000), clock.now());
    // Still inside the 30 s cooldown: the held reason is the cooldown, not a
    // distance gate — the reason the card shows must be actionable.
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_2, accuracy: 10 }, 11_000), clock.now());
    const progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.last_gate_block, 'inter-stop-cooldown');
    assert.equal(progress.arrival_diagnostics?.departure_gate?.departed, true);
  });

  it('hasMovedOnTowardAheadStop — the pure geometry of the second departure shape', () => {
    const frontier = CLOSE_STOPS[0];
    const ahead = CLOSE_STOPS;
    const arrived = new Set<string>([STOP_1]);

    // Standing AT stop 2: inside its circle and closer to it than to stop 1.
    assert.equal(
      hasMovedOnTowardAheadStop({ fix: AT_CLOSE_STOP_2, frontierStop: frontier, routeStops: ahead, arrivedStopIds: arrived, config: PROD }),
      true,
    );

    // Standing AT the frontier stop (30 m from stop 2, inside its overlapping
    // circle): NOT moved on — the stationary cascade stays blocked.
    assert.equal(
      hasMovedOnTowardAheadStop({ fix: AT_CLOSE_STOP_1, frontierStop: frontier, routeStops: ahead, arrivedStopIds: arrived, config: PROD }),
      false,
    );

    // Exactly midway between the two (15 m each way): a tie is conservative.
    const midway = { latitude: 40.700135, longitude: -74.0 };
    assert.equal(
      hasMovedOnTowardAheadStop({ fix: midway, frontierStop: frontier, routeStops: ahead, arrivedStopIds: arrived, config: PROD }),
      false,
    );

    // Closer to stop 2 but OUTSIDE its effective circle (~55 m from stop 2,
    // ~85 m from stop 1): not arrival evidence of anything — the gate stays
    // closed; "moved on" must mean AT a later stop, not merely nearer to it.
    const nearButOutside = { latitude: 40.700764, longitude: -74.0 };
    assert.equal(
      hasMovedOnTowardAheadStop({ fix: nearButOutside, frontierStop: frontier, routeStops: ahead, arrivedStopIds: arrived, config: PROD }),
      false,
    );

    // Arrived stops are never "moved on toward" — the frontier comparison
    // only looks at unarrived stops ahead of it.
    assert.equal(
      hasMovedOnTowardAheadStop({ fix: AT_CLOSE_STOP_2, frontierStop: frontier, routeStops: ahead, arrivedStopIds: new Set<string>([STOP_1, STOP_2]), config: PROD }),
      false,
    );
  });

  it('a route-blind inter-stop distance gate can still be configured for fleets that want one', async () => {
    // The env stays meaningful: an operator can restore an absolute floor.
    const harness = makeArrivalsHarness({
      stops: CLOSE_STOPS,
      config: { ...PROD, minInterStopDistanceMeters: 50 },
    });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_1, accuracy: 10 }, 11_000), clock.now());
    // Two fixes at stop 2: full evidence, so the only thing left holding it
    // is the configured route-blind distance floor.
    await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_2, accuracy: 10 }, 45_000), clock.now());
    const blocked = await evaluate(harness, trip, clock.fix({ ...AT_CLOSE_STOP_2, accuracy: 10 }, 45_000), clock.now());
    assert.equal(blocked, null, 'with the floor configured, the 30 m leg is held');
    const progress = await harness.service.getProgress(trip, null, clock.now());
    assert.equal(progress.arrival_diagnostics?.last_gate_block, 'inter-stop-distance');
  });
});

/**
 * Deep-fix R2 — the skip is still final, but it is no longer SILENT.
 *
 * The geofence path used to let the frontier pass an unarrived stop without
 * a word: no arrival row, no event, no voice line — "stop 2 was never taken".
 * Now every frontier advance broadcasts `trip:stop:skipped` for each active
 * stop left behind without a row, exactly once per stop, and a crew mark
 * advancing the frontier does the same. A stop the crew explicitly skipped
 * has a row of its own (and a local receipt on the tapping device), so it is
 * never re-announced on the room.
 */
describe('R2 trip:stop:skipped broadcast', () => {
  const PROD = DEFAULT_ARRIVAL_DETECTION_CONFIG;

  const FOUR_STOPS = [
    makeStop({ id: STOP_1, name: 'Home', sequence_number: 1 }),
    makeStop({ id: STOP_2, name: 'Oak Ave', sequence_number: 2, longitude: -73.99 }),
    makeStop({ id: STOP_3, name: 'Maple St', sequence_number: 3, longitude: -73.98 }),
    makeStop({
      id: '22222222-2222-4222-8222-222222220007',
      name: 'Cedar Ln',
      sequence_number: 4,
      longitude: -73.97,
    }),
  ];
  const AT_STOP_4 = { latitude: 40.7, longitude: -73.97 };

  const skipEvents = (harness: ArrivalsHarness) =>
    harness.broadcasts.filter((entry) => entry.event === LIVE_TRACKING_EVENTS.stopSkipped);

  it('fires exactly once per passed stop when the geofence frontier jumps ahead', async () => {
    const harness = makeArrivalsHarness({ stops: FOUR_STOPS, config: PROD });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Stop 1 records normally.
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1, accuracy: 10 }, 11_000), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1, accuracy: 10 }, 11_000), clock.now());
    assert.equal(skipEvents(harness).length, 0, 'nothing is skipped before the frontier moves');

    // The bus never enters stop 2's circle (a different street, a missed
    // turn) and surfaces at stop 3 — the skip-ahead tier needs 3 sustained
    // fixes + the dwell, then the cooldown from stop 1.
    for (let i = 0; i < 4; i += 1) {
      await evaluate(harness, trip, clock.fix({ ...AT_STOP_3, accuracy: 10 }, 12_000), clock.now());
    }
    assert.equal(harness.arrivals.created.length, 2, 'stop 3 recorded via the skip-ahead tier');
    let skips = skipEvents(harness);
    assert.equal(skips.length, 1, 'stop 2 is announced as skipped, exactly once');
    assert.equal((skips[0]?.payload as { stop_id?: string })?.stop_id, STOP_2);
    assert.equal((skips[0]?.payload as { stop_name?: string })?.stop_name, 'Oak Ave');
    assert.equal((skips[0]?.payload as { sequence_number?: number })?.sequence_number, 2);
    assert.equal((skips[0]?.payload as { source?: string })?.source, 'geofence');

    // Stop 4 records later; the frontier moves again and would re-derive
    // stop 2 — the once-per-stop memory must hold.
    for (let i = 0; i < 4; i += 1) {
      await evaluate(harness, trip, clock.fix({ ...AT_STOP_4, accuracy: 10 }, 12_000), clock.now());
    }
    assert.equal(harness.arrivals.created.length, 3, 'stop 4 recorded');
    skips = skipEvents(harness);
    assert.equal(skips.length, 1, 'the same passed stop is never announced twice');
    assert.equal((skips[0]?.payload as { stop_id?: string })?.stop_id, STOP_2);
  });

  it('a crew mark advancing the frontier announces the passed stops it creates', async () => {
    const harness = makeArrivalsHarness({ stops: FOUR_STOPS, config: PROD });
    const trip = asTrip(makeTrip());
    const clock = clockFrom('2026-09-01T06:41:30.000Z');

    // Stop 1 by geofence; stop 2 never served.
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1, accuracy: 10 }, 11_000), clock.now());
    await evaluate(harness, trip, clock.fix({ ...AT_STOP_1, accuracy: 10 }, 11_000), clock.now());

    // The crew taps "Arrived" at stop 3 — stop 2 falls behind the frontier.
    await harness.service.recordCrewStopMark({
      trip,
      stop: { id: STOP_3, name: 'Maple St', sequence_number: 3 },
      actorUserId: '77777777-7777-4777-8777-777777770001',
      skipReason: null,
      now: clock.now(),
    });

    const skips = skipEvents(harness);
    assert.equal(skips.length, 1, 'the crew-driven frontier advance announces stop 2');
    const payload = skips[0]?.payload as { stop_id?: string; source?: string };
    assert.equal(payload?.stop_id, STOP_2);
    assert.equal(payload?.source, 'crew');

    // A crew SKIP of stop 4 writes stop 4's own row: no skip event for it
    // (the tapping device speaks its own receipt; the row carries the reason).
    await harness.service.recordCrewStopMark({
      trip,
      stop: {
        id: '22222222-2222-4222-8222-222222220007',
        name: 'Cedar Ln',
        sequence_number: 4,
      },
      actorUserId: '77777777-7777-4777-8777-777777770001',
      skipReason: 'road closed',
      now: clock.now(),
    });
    const afterCrewSkip = skipEvents(harness);
    assert.equal(afterCrewSkip.length, 1, 'a crew-skipped stop is not re-announced on the room');
    assert.equal((afterCrewSkip[0]?.payload as { stop_id?: string })?.stop_id, STOP_2);
  });

  it('stopsPassedByFrontier — the pure derivation of "left behind"', () => {
    const stops = [
      ...FOUR_STOPS,
      // An inactive stop behind the frontier is not part of the run.
      makeStop({
        id: '22222222-2222-4222-8222-222222220008',
        name: 'Old Lane',
        sequence_number: 2,
        is_active: false,
      }),
      // An un-surveyed stop behind the frontier was still passed — included.
      makeStop({
        id: STOP_NO_COORDS,
        name: 'Unsurveyed Lane',
        sequence_number: 2,
        latitude: null,
        longitude: null,
      }),
    ];
    const arrived = new Set<string>([STOP_1, STOP_3]);
    const passed = stopsPassedByFrontier(stops, arrived, 3);

    assert.deepEqual(
      passed.map((stop) => stop.id),
      [STOP_2, STOP_NO_COORDS],
      'unarrived active stops behind the frontier, unsurveyed included, in sequence order',
    );

    // Boundary: a stop AT the frontier sequence is the frontier itself, not
    // passed; nothing is passed while no arrival exists (frontier 0).
    assert.deepEqual(stopsPassedByFrontier(stops, new Set<string>(), 0), []);
    // With only stop 2 arrived, the stop left behind is stop 1.
    assert.deepEqual(
      stopsPassedByFrontier(stops, new Set<string>([STOP_2]), 2).map((stop) => stop.id),
      [STOP_1],
    );
  });
});
