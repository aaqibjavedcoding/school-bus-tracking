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
  requiredFixesForProgression,
  selectProgressionCandidate,
  StopArrivalsService,
  DEFAULT_ARRIVAL_DETECTION_CONFIG,
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

  it('never generates arrivals for non-active trips', async () => {
    for (const status of [TripStatus.SCHEDULED, TripStatus.COMPLETED, TripStatus.CANCELLED]) {
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

  it('accepts fixes without accuracy by default (devices may omit it)', async () => {
    const harness = makeArrivalsHarness();
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

  it('rejects missing accuracy when the operator requires it', async () => {
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
      // Pinned at base 2: the warm-up fix must not record, so the two
      // concurrent confirmations below genuinely race for the same insert.
      { ...DEFAULT_ARRIVAL_DETECTION_CONFIG, requiredConsecutiveFixes: 2 },
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
    assert.deepEqual(assessFixEligibility(fix({ accuracy: null }), null, NOW, config), {
      eligible: true,
      reason: null,
    });
    assert.deepEqual(
      assessFixEligibility(fix({ accuracy: null }), null, NOW, {
        ...config,
        allowMissingAccuracy: false,
      }),
      { eligible: false, reason: 'missing-accuracy' },
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
  // Tier-pure selection math: pinned at base 2 so the escalation counts in
  // these specs ("needs 2 + 1", "2 + 1 + 1") stay independent of the product
  // default (`requiredConsecutiveFixes`, now 1).
  const config = { ...DEFAULT_ARRIVAL_DETECTION_CONFIG, requiredConsecutiveFixes: 2 };
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
  it('defaults to a single eligible in-geofence fix for the next stop', () => {
    // Pinned product decision (2026-09 batch 3A): confirmation must not be
    // the weakest link of the trip — the eligibility gate is the anti-jitter
    // gate, the immediate next stop records from one fix.
    assert.equal(DEFAULT_ARRIVAL_DETECTION_CONFIG.requiredConsecutiveFixes, 1);
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
    // Same mapping with the product default (base 1).
    assert.equal(requiredFixesForProgression(2, 0, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 1);
    assert.equal(requiredFixesForProgression(3, 1, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 2);
    assert.equal(requiredFixesForProgression(3, 0, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 3);
    assert.equal(requiredFixesForProgression(4, 0, 2, DEFAULT_ARRIVAL_DETECTION_CONFIG), 3);
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
