import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  LIVE_TRACKING_EVENTS,
  TripStatus,
  UserRole,
  liveTrackingRoomName,
} from '@school-bus-tracking/shared-types';
import {
  Trip,
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  TripLocation,
} from '../../database/models';
import { LiveTrackingService } from './live-tracking.service';
import {
  LIVE_TRACKING_NO_LOCATION_MESSAGE,
  LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
} from './live-tracking.constants';
import {
  ADMIN_A,
  ASSIGNMENTS,
  CONDUCTOR_A,
  CONDUCTOR_ROSTERED,
  DRIVER_A,
  DRIVER_EXPIRED,
  DRIVER_OTHER_SCHOOL,
  DRIVER_ROSTERED,
  DRIVER_UNRELATED,
  GUARDIANS,
  PARENT_A,
  PARENT_INACTIVE_LINK,
  PARENT_OTHER_SCHOOL,
  PARENT_UNRELATED,
  ROUTE_A,
  ROUTE_A2,
  SCHOOL_A,
  SCHOOL_B,
  SUPER_ADMIN,
  STOPS,
  STUDENTS,
  TRIP_A,
  TRIP_A_CANCELLED,
  TRIP_A_COMPLETED,
  TRIP_A_SCHEDULED,
  TRIP_OTHER_ROUTE,
  TRIP_OTHER_SCHOOL,
  TRIP_ROSTERED_CREW,
  actorOf,
  makeBroadcastCapture,
  makeLocation,
  makeLocationStore,
  makeTrip,
  matchesWhere,
  locationPayload,
  makeNoopArrivalsStub,
  type StubTrip,
} from './live-tracking.test-utils';

const ADMIN = actorOf(UserRole.SCHOOL_ADMIN, ADMIN_A);
const SUPER = actorOf(UserRole.SUPER_ADMIN, SUPER_ADMIN);
const DRIVER = actorOf(UserRole.DRIVER, DRIVER_A);
const CONDUCTOR = actorOf(UserRole.CONDUCTOR, CONDUCTOR_A);
const UNRELATED_DRIVER = actorOf(UserRole.DRIVER, DRIVER_UNRELATED);
const UNRELATED_CONDUCTOR = actorOf(UserRole.CONDUCTOR, DRIVER_UNRELATED);
const ROASTER_DRIVER = actorOf(UserRole.DRIVER, DRIVER_ROSTERED);
const ROASTER_CONDUCTOR = actorOf(UserRole.CONDUCTOR, CONDUCTOR_ROSTERED);
const EXPIRED_DRIVER = actorOf(UserRole.DRIVER, DRIVER_EXPIRED);
const OTHER_SCHOOL_DRIVER = actorOf(UserRole.DRIVER, DRIVER_OTHER_SCHOOL, SCHOOL_B);
const PARENT = actorOf(UserRole.PARENT, PARENT_A);
const UNRELATED_PARENT = actorOf(UserRole.PARENT, PARENT_UNRELATED);
const INACTIVE_LINK_PARENT = actorOf(UserRole.PARENT, PARENT_INACTIVE_LINK);
const OTHER_SCHOOL_PARENT = actorOf(UserRole.PARENT, PARENT_OTHER_SCHOOL, SCHOOL_B);

const TRIPS: StubTrip[] = [
  makeTrip({ id: TRIP_A, status: TripStatus.IN_PROGRESS }),
  makeTrip({ id: TRIP_A_SCHEDULED, status: TripStatus.SCHEDULED }),
  makeTrip({ id: TRIP_A_COMPLETED, status: TripStatus.COMPLETED }),
  makeTrip({ id: TRIP_A_CANCELLED, status: TripStatus.CANCELLED }),
  makeTrip({
    id: TRIP_ROSTERED_CREW,
    status: TripStatus.IN_PROGRESS,
    driver_id: null,
    conductor_id: null,
  }),
  makeTrip({
    id: TRIP_OTHER_ROUTE,
    status: TripStatus.IN_PROGRESS,
    route_id: '11111111-1111-4111-8111-11111111bbbb',
  }),
  makeTrip({
    id: TRIP_OTHER_SCHOOL,
    school_id: SCHOOL_B,
    route_id: '11111111-1111-4111-8111-11111111cccc',
    driver_id: DRIVER_OTHER_SCHOOL,
    conductor_id: null,
    status: TripStatus.IN_PROGRESS,
  }),
];

function tripRepo() {
  return {
    findOne: async (query: { where: Record<string, unknown> }) =>
      (TRIPS.find((trip) =>
        matchesWhere(trip as unknown as Record<string, unknown>, query.where),
      ) ?? null) as unknown as Trip,
  } as unknown as typeof Trip;
}

function assignmentRepo() {
  return {
    findAll: async (query: { where: Record<string, unknown> }) =>
      ASSIGNMENTS.filter((assignment) =>
        matchesWhere(assignment as unknown as Record<string, unknown>, query.where),
      ) as unknown as RouteAssignment[],
  } as unknown as typeof RouteAssignment;
}

function stopRepo() {
  return {
    findAll: async (query: { where: Record<string, unknown>; attributes?: string[] }) =>
      STOPS.filter((stop) =>
        matchesWhere(stop as unknown as Record<string, unknown>, query.where),
      ) as unknown as Stop[],
  } as unknown as typeof Stop;
}

function studentRepo() {
  return {
    findAll: async (query: { where: Record<string, unknown>; attributes?: string[] }) =>
      STUDENTS.filter((student) =>
        matchesWhere(student as unknown as Record<string, unknown>, query.where),
      ) as unknown as Student[],
  } as unknown as typeof Student;
}

function guardianRepo() {
  return {
    findAll: async (query: { where: Record<string, unknown> }) =>
      GUARDIANS.filter((guardian) =>
        matchesWhere(guardian as unknown as Record<string, unknown>, query.where),
      ) as unknown as StudentGuardian[],
  } as unknown as typeof StudentGuardian;
}

interface MakeServiceOptions {
  config?: import('./live-tracking.service').LiveTrackingConfig;
  attachBroadcaster?: boolean;
  seedLocations?: Parameters<typeof makeLocationStore>[0];
  /** Overrides the no-op Task 22 arrivals double (spy in integration tests). */
  arrivals?: import('../eta/stop-arrivals.service').StopArrivalsService;
}

function makeService(options: MakeServiceOptions = {}) {
  const store = makeLocationStore(options.seedLocations);
  const capture = makeBroadcastCapture();
  const service = new LiveTrackingService(
    store.repo as unknown as typeof TripLocation,
    tripRepo(),
    assignmentRepo(),
    studentRepo(),
    stopRepo(),
    guardianRepo(),
    options.config ?? { gpsMinIntervalMs: 0, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
    options.arrivals ?? makeNoopArrivalsStub(),
  );
  if (options.attachBroadcaster !== false) {
    service.attachBroadcaster(capture.fn);
  }
  return { service, store, capture };
}

async function expectRejected(
  promise: Promise<unknown>,
  status: number,
  message: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error);
    const httpError = error as { getStatus?: () => number };
    assert.equal(httpError.getStatus?.(), status);
    assert.equal(error.message, message);
    return true;
  });
}

describe('LiveTrackingService.recordLocation — validation', () => {
  it('accepts a valid fix from the assigned driver and persists it with server stamps', async () => {
    const { service, store, capture } = makeService();
    const before = new Date();

    const { ack, broadcast } = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    const after = new Date();

    assert.equal(ack.status, 'accepted');
    assert.equal(ack.trip_id, TRIP_A);
    assert.equal(ack.stale, false);
    assert.ok(ack.received_at !== undefined);

    assert.equal(store.createPayloads.length, 1);
    const persisted = store.createPayloads[0];
    // The tenant and trip come from the verified records, never the payload.
    assert.equal(persisted.school_id, SCHOOL_A);
    assert.equal(persisted.trip_id, TRIP_A);
    assert.equal(persisted.latitude, 51.5);
    assert.equal(persisted.longitude, -0.1);
    assert.equal(persisted.accuracy, 12);
    assert.equal(persisted.speed, 24.5);
    assert.equal(persisted.heading, 88);
    assert.ok(persisted.recorded_at instanceof Date);
    const received = persisted.received_at as Date;
    assert.ok(received.getTime() >= before.getTime() && received.getTime() <= after.getTime());

    assert.equal(capture.emitted.length, 1);
    assert.equal(capture.emitted[0].room, liveTrackingRoomName(TRIP_A));
    assert.equal(capture.emitted[0].event, LIVE_TRACKING_EVENTS.locationUpdate);
    const payload = capture.emitted[0].payload as Record<string, unknown>;
    assert.equal(payload.school_id, SCHOOL_A);
    assert.equal(payload.trip_status, TripStatus.IN_PROGRESS);
    assert.equal(payload.tracking_state, 'active');
    assert.equal(payload.received_at, ack.received_at);
    assert.ok(broadcast !== undefined);
  });

  it('accepts a fix from the assigned conductor too', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(CONDUCTOR, locationPayload(TRIP_A));
    assert.equal(ack.status, 'accepted');
    assert.equal(store.createPayloads.length, 1);
  });

  it('accepts optional readings being omitted and stores them as null', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(DRIVER, {
      trip_id: TRIP_A,
      latitude: 51.5,
      longitude: -0.1,
      recorded_at: new Date().toISOString(),
    });
    assert.equal(ack.status, 'accepted');
    const persisted = store.createPayloads[0];
    assert.equal(persisted.accuracy, null);
    assert.equal(persisted.speed, null);
    assert.equal(persisted.heading, null);
  });

  it('rejects out-of-range and malformed coordinates', async () => {
    const cases: Array<Record<string, unknown>> = [
      { latitude: 90.0001 },
      { latitude: -90.1 },
      { longitude: 180.5 },
      { longitude: -181 },
      { latitude: Number.NaN },
      { longitude: Number.POSITIVE_INFINITY },
      { latitude: '51.5' },
      { longitude: '0.1' },
    ];
    for (const overrides of cases) {
      const { service, store, capture } = makeService();
      const { ack } = await service.recordLocation(DRIVER, locationPayload(TRIP_A, overrides));
      assert.equal(
        ack.status,
        'rejected',
        `lat=${String(overrides.latitude)} lon=${String(overrides.longitude)}`,
      );
      assert.equal(ack.reason, 'invalid_payload');
      assert.equal(store.createPayloads.length, 0);
      assert.equal(capture.emitted.length, 0);
    }
  });

  it('rejects out-of-range device readings', async () => {
    const cases: Array<Record<string, unknown>> = [
      { accuracy: -1 },
      { accuracy: 10_001 },
      { speed: -0.5 },
      { speed: 301 },
      { heading: 360.5 },
      { heading: -1 },
    ];
    for (const overrides of cases) {
      const { service, store } = makeService();
      const { ack } = await service.recordLocation(DRIVER, locationPayload(TRIP_A, overrides));
      assert.equal(ack.status, 'rejected', JSON.stringify(overrides));
      assert.equal(ack.reason, 'invalid_payload');
      assert.equal(store.createPayloads.length, 0);
    }
  });

  it('accepts boundary values (±90, ±180, accuracy 10000, speed 300, heading 360)', async () => {
    const { service } = makeService();
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 90,
        longitude: -180,
        accuracy: 10_000,
        speed: 300,
        heading: 360,
      }),
    );
    assert.equal(ack.status, 'accepted');
  });

  it('rejects malformed payloads (non-object, missing fields, bad trip id)', async () => {
    const { service, store } = makeService();

    const cases: unknown[] = [
      null,
      undefined,
      'a-string',
      42,
      [],
      { latitude: 1, longitude: 2, recorded_at: new Date().toISOString() }, // no trip_id
      { trip_id: 'not-a-uuid', latitude: 1, longitude: 2, recorded_at: new Date().toISOString() },
      { trip_id: TRIP_A, latitude: 1, recorded_at: new Date().toISOString() }, // no longitude
      { trip_id: TRIP_A, latitude: 1, longitude: 2 }, // no recorded_at
    ];
    for (const payload of cases) {
      const { ack } = await service.recordLocation(DRIVER, payload);
      assert.equal(ack.status, 'rejected', `payload ${JSON.stringify(payload)}`);
      assert.equal(ack.reason, 'invalid_payload');
    }
    assert.equal(store.createPayloads.length, 0);
  });

  it('rejects unparseable recorded_at', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, { recorded_at: 'yesterday, probably' }),
    );
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'invalid_payload');
    assert.equal(store.createPayloads.length, 0);
  });

  it('rejects unknown fields — a smuggled school_id or server time never lands', async () => {
    const { service, store } = makeService();

    for (const extra of [
      { school_id: SCHOOL_B },
      { received_at: '2020-01-01T00:00:00.000Z' },
      { driver_id: DRIVER_A },
    ]) {
      const { ack } = await service.recordLocation(DRIVER, locationPayload(TRIP_A, extra));
      assert.equal(ack.status, 'rejected');
      assert.equal(ack.reason, 'invalid_payload');
    }
    assert.equal(store.createPayloads.length, 0);
  });
});

describe('LiveTrackingService.recordLocation — authorization', () => {
  it('rejects a driver of the same school who is not crew of the trip', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(UNRELATED_DRIVER, locationPayload(TRIP_A));
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(store.createPayloads.length, 0);
  });

  it('rejects a conductor who is not crew of the trip', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(UNRELATED_CONDUCTOR, locationPayload(TRIP_A));
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(store.createPayloads.length, 0);
  });

  it('rejects the school admin: only the crew may send fixes', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(ADMIN, locationPayload(TRIP_A));
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(store.createPayloads.length, 0);
  });

  it('rejects a parent: only the crew may send fixes', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(PARENT, locationPayload(TRIP_A));
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(store.createPayloads.length, 0);
  });

  it('rejects the platform SUPER_ADMIN', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(SUPER, locationPayload(TRIP_A));
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(store.createPayloads.length, 0);
  });

  it('hides cross-tenant trips behind the generic trip_not_found', async () => {
    const { service, store } = makeService();
    // A school-B driver probing a school-A trip id…
    const { ack } = await service.recordLocation(OTHER_SCHOOL_DRIVER, locationPayload(TRIP_A));
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'trip_not_found');
    // …and the other way around: a school-A driver probing a school-B trip.
    const foreign = await service.recordLocation(DRIVER, locationPayload(TRIP_OTHER_SCHOOL));
    assert.equal(foreign.ack.status, 'rejected');
    assert.equal(foreign.ack.reason, 'trip_not_found');
    assert.equal(store.createPayloads.length, 0);
  });

  it('accepts rostered crew (active assignment) and rejects an expired roster row', async () => {
    const { service, store } = makeService();

    const roaster = await service.recordLocation(
      ROASTER_DRIVER,
      locationPayload(TRIP_ROSTERED_CREW),
    );
    assert.equal(roaster.ack.status, 'accepted');

    const roasterConductor = await service.recordLocation(
      ROASTER_CONDUCTOR,
      locationPayload(TRIP_ROSTERED_CREW),
    );
    assert.equal(roasterConductor.ack.status, 'accepted');

    const expired = await service.recordLocation(
      EXPIRED_DRIVER,
      locationPayload(TRIP_ROSTERED_CREW),
    );
    assert.equal(expired.ack.status, 'rejected');
    assert.equal(expired.ack.reason, 'unauthorized');

    // A roster row on a *different* route does not authorize this trip.
    const otherRoute = await service.recordLocation(
      ROASTER_DRIVER,
      locationPayload(TRIP_OTHER_ROUTE),
    );
    assert.equal(otherRoute.ack.status, 'rejected');
    assert.equal(otherRoute.ack.reason, 'unauthorized');

    assert.equal(store.createPayloads.length, 2);
  });
});

describe('LiveTrackingService.recordLocation — lifecycle gating', () => {
  it('rejects updates for SCHEDULED, COMPLETED and CANCELLED trips with trip_not_open', async () => {
    for (const tripId of [TRIP_A_SCHEDULED, TRIP_A_COMPLETED, TRIP_A_CANCELLED]) {
      const { service, store } = makeService();
      const { ack } = await service.recordLocation(DRIVER, locationPayload(tripId));
      assert.equal(ack.status, 'rejected');
      assert.equal(ack.reason, 'trip_not_open');
      assert.equal(store.createPayloads.length, 0);
    }
  });

  it('accepts updates while BOARDING', async () => {
    const { service } = makeServiceForTrips([makeTrip({ status: TripStatus.BOARDING })]);
    const { ack } = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(ack.status, 'accepted');
  });
});

describe('LiveTrackingService.recordLocation — timestamps', () => {
  it('accepts a fix recorded slightly in the future (within the skew window)', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, { recorded_at: new Date(Date.now() + 60_000).toISOString() }),
    );
    assert.equal(ack.status, 'accepted');
    assert.equal(store.createPayloads.length, 1);
  });

  it('rejects a fix far in the future with future_timestamp', async () => {
    const { service, store, capture } = makeService();
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, { recorded_at: new Date(Date.now() + 10 * 60_000).toISOString() }),
    );
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'future_timestamp');
    assert.equal(store.createPayloads.length, 0);
    assert.equal(capture.emitted.length, 0);
  });

  it('rejects a fix far in the past with invalid_timestamp', async () => {
    const { service, store } = makeService();
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, { recorded_at: new Date(Date.now() - 25 * 3_600_000).toISOString() }),
    );
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'invalid_timestamp');
    assert.equal(store.createPayloads.length, 0);
  });

  it('honors the configured skew windows', async () => {
    const strict = makeService({
      config: { gpsMinIntervalMs: 0, maxFutureSkewMs: 0, maxPastSkewMs: 0 },
    });
    const { ack } = await strict.service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, { recorded_at: new Date(Date.now() + 50).toISOString() }),
    );
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'future_timestamp');
  });
});

describe('LiveTrackingService.recordLocation — ordering and duplicates', () => {
  it('keeps the newest fix as latest when an older fix arrives out of order', async () => {
    const { service, store, capture } = makeService();
    const base = Date.now();
    const newer = new Date(base + 10_000).toISOString();
    const older = new Date(base - 10_000).toISOString();

    const first = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.51,
        recorded_at: newer,
      }),
    );
    assert.equal(first.ack.status, 'accepted');
    assert.equal(first.ack.stale, false);

    const second = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.5,
        recorded_at: older,
      }),
    );
    assert.equal(second.ack.status, 'accepted');
    assert.equal(second.ack.stale, true);

    // Both fixes are persisted (history is append-only)…
    assert.equal(store.createPayloads.length, 2);
    // …but only the newest one was broadcast, and the latest lookup returns it.
    assert.equal(capture.emitted.length, 1);
    const latest = await service.getLatestLocation(DRIVER, TRIP_A);
    assert.equal(latest.latitude, 51.51);
    assert.equal(latest.recorded_at, newer);
  });

  it('resolves duplicate timestamps deterministically (later receipt wins)', async () => {
    const { service, store } = makeService();
    const recorded = new Date().toISOString();

    const first = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.5,
        recorded_at: recorded,
      }),
    );
    assert.equal(first.ack.status, 'accepted');
    assert.equal(first.ack.stale, false);

    // Re-sent with the identical timestamp: accepted, re-confirmed as latest
    // (the server's later receipt makes it the deterministic winner), and the
    // live position does not move backwards.
    const duplicate = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.5,
        recorded_at: recorded,
      }),
    );
    assert.equal(duplicate.ack.status, 'accepted');
    assert.equal(duplicate.ack.stale, false);
    assert.equal(store.createPayloads.length, 2);

    const latest = await service.getLatestLocation(DRIVER, TRIP_A);
    assert.equal(latest.recorded_at, recorded);
  });

  it('fills the cold latest cache from the database after a restart', async () => {
    const now = Date.now();
    const existing = makeLocation({
      recorded_at: new Date(now - 30_000),
      received_at: new Date(now - 29_000),
      latitude: 52.0,
    });
    const { service } = makeService({ seedLocations: [existing] });

    // A fix older than the persisted latest must not move the position back.
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.9,
        recorded_at: new Date(now - 60_000).toISOString(),
      }),
    );
    assert.equal(ack.status, 'accepted');
    assert.equal(ack.stale, true);

    const latest = await service.getLatestLocation(DRIVER, TRIP_A);
    assert.equal(latest.latitude, 52.0);
  });
});

describe('LiveTrackingService.recordLocation — throttling', () => {
  it('throttles updates closer together than the configured interval', async () => {
    const { service, store, capture } = makeService({
      config: { gpsMinIntervalMs: 60_000, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
    });

    const first = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(first.ack.status, 'accepted');

    const second = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.51,
      }),
    );
    assert.equal(second.ack.status, 'rejected');
    assert.equal(second.ack.reason, 'throttled');
    assert.equal(store.createPayloads.length, 1);
    assert.equal(capture.emitted.length, 1);
  });

  it('accepts again once the interval has elapsed', async () => {
    const { service, store } = makeService({
      config: { gpsMinIntervalMs: 100, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
    });

    const first = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(first.ack.status, 'accepted');

    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, {
        latitude: 51.52,
      }),
    );
    assert.equal(second.ack.status, 'accepted');
    assert.equal(store.createPayloads.length, 2);
  });

  it('throttles per crew device, not per trip (a second device has its own budget)', async () => {
    const { service, store } = makeService({
      config: { gpsMinIntervalMs: 60_000, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
    });

    const driverFirst = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(driverFirst.ack.status, 'accepted');

    const conductorFirst = await service.recordLocation(CONDUCTOR, locationPayload(TRIP_A));
    assert.equal(conductorFirst.ack.status, 'accepted');

    const driverSecond = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(driverSecond.ack.status, 'rejected');
    assert.equal(driverSecond.ack.reason, 'throttled');

    assert.equal(store.createPayloads.length, 2);
  });

  it('releases the throttle slot on socket disconnect', async () => {
    const { service } = makeService({
      config: { gpsMinIntervalMs: 60_000, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
    });

    const first = await service.recordLocation(DRIVER, locationPayload(TRIP_A), { socketId: 's1' });
    assert.equal(first.ack.status, 'accepted');

    service.cleanupSocket('s1');

    const retry = await service.recordLocation(DRIVER, locationPayload(TRIP_A), { socketId: 's2' });
    assert.equal(retry.ack.status, 'accepted');
  });
});

describe('LiveTrackingService.getParentObservableRouteIds', () => {
  it("returns the unique route ids of a parent's active linked children", async () => {
    const { service } = makeService();
    const routeIds = await service.getParentObservableRouteIds(PARENT);
    assert.deepEqual(routeIds.sort(), [ROUTE_A].sort());
  });

  it('returns an empty list for inactive links and non-parents', async () => {
    const { service } = makeService();
    assert.deepEqual(await service.getParentObservableRouteIds(UNRELATED_PARENT), [ROUTE_A2]);
    assert.deepEqual(await service.getParentObservableRouteIds(INACTIVE_LINK_PARENT), []);
    assert.deepEqual(await service.getParentObservableRouteIds(ADMIN), []);
    assert.deepEqual(await service.getParentObservableRouteIds(DRIVER), []);
  });
});

describe('LiveTrackingService — latest location (REST)', () => {
  it('returns the latest fix for the school admin', async () => {
    const { service } = makeService({
      seedLocations: [
        makeLocation({
          id: 'loc-old',
          recorded_at: new Date('2026-09-01T06:31:00.000Z'),
          received_at: new Date('2026-09-01T06:31:00.500Z'),
          latitude: 51.5,
        }),
        makeLocation({
          id: 'loc-new',
          recorded_at: new Date('2026-09-01T06:32:00.000Z'),
          received_at: new Date('2026-09-01T06:32:00.500Z'),
          latitude: 51.51,
        }),
      ],
    });

    const latest = await service.getLatestLocation(ADMIN, TRIP_A);
    assert.equal(latest.id, 'loc-new');
    assert.equal(latest.latitude, 51.51);
    assert.equal(latest.trip_status, TripStatus.IN_PROGRESS);
    assert.equal(latest.tracking_state, 'active');
    assert.equal(latest.school_id, SCHOOL_A);
  });

  it('breaks recorded_at ties by the later server receipt (deterministic)', async () => {
    const { service } = makeService({
      seedLocations: [
        makeLocation({
          id: 'loc-a',
          recorded_at: new Date('2026-09-01T06:31:00.000Z'),
          received_at: new Date('2026-09-01T06:31:01.000Z'),
          latitude: 51.5,
        }),
        makeLocation({
          id: 'loc-b',
          recorded_at: new Date('2026-09-01T06:31:00.000Z'),
          received_at: new Date('2026-09-01T06:31:02.000Z'),
          latitude: 51.6,
        }),
      ],
    });

    const latest = await service.getLatestLocation(ADMIN, TRIP_A);
    assert.equal(latest.id, 'loc-b');
  });

  it('allows the assigned crew to read the latest location', async () => {
    const { service } = makeService({ seedLocations: [makeLocation()] });
    assert.equal((await service.getLatestLocation(DRIVER, TRIP_A)).latitude, 51.5);
    assert.equal((await service.getLatestLocation(CONDUCTOR, TRIP_A)).latitude, 51.5);
  });

  it('allows a parent only when their linked child is on the trip', async () => {
    const { service } = makeService({ seedLocations: [makeLocation()] });
    const latest = await service.getLatestLocation(PARENT, TRIP_A);
    assert.equal(latest.latitude, 51.5);

    await expectRejected(
      service.getLatestLocation(UNRELATED_PARENT, TRIP_A),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
    await expectRejected(
      service.getLatestLocation(INACTIVE_LINK_PARENT, TRIP_A),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
  });

  it('hides unrelated and cross-tenant trips behind the generic 404', async () => {
    const { service } = makeService({ seedLocations: [makeLocation()] });
    await expectRejected(
      service.getLatestLocation(UNRELATED_DRIVER, TRIP_A),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
    await expectRejected(
      service.getLatestLocation(OTHER_SCHOOL_PARENT, TRIP_A),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
    await expectRejected(
      service.getLatestLocation(OTHER_SCHOOL_DRIVER, TRIP_A),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
    await expectRejected(
      service.getLatestLocation(SUPER, TRIP_A),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
  });

  it('keeps the latest location readable after the trip is terminal', async () => {
    const { service } = makeService({
      seedLocations: [makeLocation({ trip_id: TRIP_A_COMPLETED })],
    });

    const latest = await service.getLatestLocation(DRIVER, TRIP_A_COMPLETED);
    assert.equal(latest.tracking_state, 'stopped');
    assert.equal(latest.trip_status, TripStatus.COMPLETED);
  });

  it('returns 404 with a specific message while no fix has been recorded', async () => {
    const { service } = makeService();
    await expectRejected(
      service.getLatestLocation(ADMIN, TRIP_A),
      404,
      LIVE_TRACKING_NO_LOCATION_MESSAGE,
    );
  });
});

describe('LiveTrackingService — location history (REST)', () => {
  const FIXES = [
    makeLocation({
      id: 'fix-1',
      latitude: 51.5,
      recorded_at: new Date('2026-09-01T06:31:00.000Z'),
      received_at: new Date('2026-09-01T06:31:00.200Z'),
    }),
    makeLocation({
      id: 'fix-2',
      latitude: 51.51,
      recorded_at: new Date('2026-09-01T06:32:00.000Z'),
      received_at: new Date('2026-09-01T06:32:00.200Z'),
    }),
    makeLocation({
      id: 'fix-3',
      latitude: 51.52,
      recorded_at: new Date('2026-09-01T06:33:00.000Z'),
      received_at: new Date('2026-09-01T06:33:00.200Z'),
    }),
  ];

  it('returns fixes chronologically with pagination metadata', async () => {
    const { service } = makeService({ seedLocations: FIXES });

    const page = await service.getLocationHistory(ADMIN, TRIP_A, { limit: 2 });
    assert.deepEqual(
      page.items.map((fix) => fix.id),
      ['fix-1', 'fix-2'],
    );
    assert.equal(page.has_more, true);
    assert.equal(page.trip_id, TRIP_A);
    assert.equal(page.school_id, SCHOOL_A);

    const rest = await service.getLocationHistory(ADMIN, TRIP_A, { limit: 10 });
    assert.equal(rest.has_more, false);
    assert.equal(rest.items.length, 3);
  });

  it('honors an inclusive from/to window on recorded_at', async () => {
    const { service } = makeService({ seedLocations: FIXES });

    const windowed = await service.getLocationHistory(ADMIN, TRIP_A, {
      from: '2026-09-01T06:32:00.000Z',
      to: '2026-09-01T06:32:59.999Z',
    });
    assert.deepEqual(
      windowed.items.map((fix) => fix.id),
      ['fix-2'],
    );
    assert.equal(windowed.has_more, false);
  });

  it('never returns more than the bounded page, and only for the pinned tenant', async () => {
    const { service } = makeService({ seedLocations: FIXES });
    const page = await service.getLocationHistory(ADMIN, TRIP_A, {});
    assert.ok(page.items.length <= 100);
    for (const fix of page.items) {
      assert.equal(fix.school_id, SCHOOL_A);
      assert.equal(fix.trip_id, TRIP_A);
    }
  });

  it('rejects an inverted window and an out-of-bounds limit', async () => {
    const { service } = makeService({ seedLocations: FIXES });

    await assert.rejects(
      service.getLocationHistory(ADMIN, TRIP_A, {
        from: '2026-09-01T06:33:00.000Z',
        to: '2026-09-01T06:31:00.000Z',
      }),
      (error: unknown) => error instanceof BadRequestException,
    );
    await assert.rejects(
      service.getLocationHistory(ADMIN, TRIP_A, { limit: 0 }),
      (error: unknown) => error instanceof BadRequestException,
    );
    await assert.rejects(
      service.getLocationHistory(ADMIN, TRIP_A, { limit: 501 }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('enforces the same role rules as the latest-location endpoint', async () => {
    const { service } = makeService({ seedLocations: FIXES });
    await expectRejected(
      service.getLocationHistory(UNRELATED_DRIVER, TRIP_A, {}),
      404,
      LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
    );
    const parentHistory = await service.getLocationHistory(PARENT, TRIP_A, {});
    assert.equal(parentHistory.items.length, 3);
  });
});

describe('LiveTrackingService — lifecycle integration', () => {
  it('emits trip:tracking:started when the trip enters the active window', async () => {
    const { service, capture } = makeService();
    const scheduled = makeTrip({ id: TRIP_A, status: TripStatus.SCHEDULED });

    await service.onTripStatusChanged(scheduled);
    assert.equal(capture.emitted.length, 0);

    const boarding = makeTrip({ id: TRIP_A, status: TripStatus.BOARDING });
    const started = await service.onTripStatusChanged(boarding);
    assert.equal(started.event, LIVE_TRACKING_EVENTS.trackingStarted);
    assert.deepEqual(
      capture.emitted.map((entry) => entry.room),
      [liveTrackingRoomName(TRIP_A)],
    );
    assert.equal(capture.emitted[0].event, LIVE_TRACKING_EVENTS.trackingStarted);
    const payload = capture.emitted[0].payload as Record<string, unknown>;
    assert.equal(payload.trip_id, TRIP_A);
    assert.equal(payload.trip_status, TripStatus.BOARDING);
    assert.equal(payload.tracking_state, 'active');
    assert.ok(typeof payload.at === 'string');
  });

  it('does not re-emit started while already active (BOARDING → IN_PROGRESS)', async () => {
    const { service, capture } = makeService();
    await service.onTripStatusChanged(makeTrip({ id: TRIP_A, status: TripStatus.BOARDING }));
    const result = await service.onTripStatusChanged(
      makeTrip({ id: TRIP_A, status: TripStatus.IN_PROGRESS }),
    );
    assert.equal(result.event, null);
    assert.equal(capture.emitted.length, 1);
  });

  it('emits trip:tracking:stopped for completion, cancellation and deletion', async () => {
    const completed = makeService();
    await completed.service.onTripStatusChanged(
      makeTrip({ id: TRIP_A, status: TripStatus.IN_PROGRESS }),
    );
    const done = await completed.service.onTripStatusChanged(
      makeTrip({ id: TRIP_A, status: TripStatus.COMPLETED }),
    );
    assert.equal(done.event, LIVE_TRACKING_EVENTS.trackingStopped);
    const donePayload = done.payload as unknown as Record<string, unknown>;
    assert.equal(donePayload.reason, 'completed');
    assert.equal(donePayload.tracking_state, 'stopped');

    const cancelled = makeService();
    await cancelled.service.onTripStatusChanged(
      makeTrip({ id: TRIP_A, status: TripStatus.SCHEDULED }),
    );
    const cancelledResult = await cancelled.service.onTripStatusChanged(
      makeTrip({ id: TRIP_A, status: TripStatus.CANCELLED }),
    );
    assert.equal(cancelledResult.event, LIVE_TRACKING_EVENTS.trackingStopped);
    assert.equal(
      (cancelledResult.payload as unknown as Record<string, unknown>).reason,
      'cancelled',
    );

    const removed = makeService();
    const removedResult = await removed.service.onTripStatusChanged(
      makeTrip({ id: TRIP_A, status: TripStatus.CANCELLED }),
      { deleted: true },
    );
    assert.equal(removedResult.event, LIVE_TRACKING_EVENTS.trackingStopped);
    assert.equal((removedResult.payload as unknown as Record<string, unknown>).reason, 'deleted');
  });

  it('stops accepting fixes and clears throttle state once the trip is terminal', async () => {
    const trip = makeTrip({ status: TripStatus.IN_PROGRESS });
    const { service, store, capture } = makeServiceForTrips([trip], [makeLocation()], {
      gpsMinIntervalMs: 60_000,
      maxFutureSkewMs: 300_000,
      maxPastSkewMs: 86_400_000,
    });

    const accepted = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(accepted.ack.status, 'accepted');

    trip.status = TripStatus.COMPLETED;
    await service.onTripStatusChanged(trip);

    const afterTerminal = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(afterTerminal.ack.status, 'rejected');
    assert.equal(afterTerminal.ack.reason, 'trip_not_open');
    assert.equal(store.createPayloads.length, 1);

    // The broadcast for the stop event went out to the trip room…
    const stopEvent = capture.emitted.find(
      (entry) => entry.event === LIVE_TRACKING_EVENTS.trackingStopped,
    );
    assert.ok(stopEvent !== undefined);
    assert.equal(stopEvent?.room, liveTrackingRoomName(TRIP_A));
  });

  it('stays readable: the last fix survives the terminal transition', async () => {
    // The repository row reflects the transition, exactly as TripsService
    // updates it before notifying the tracking pipeline.
    const trip = makeTrip({ status: TripStatus.IN_PROGRESS });
    const { service } = makeServiceForTrips([trip], [makeLocation()]);
    await service.onTripStatusChanged(trip);

    trip.status = TripStatus.CANCELLED;
    await service.onTripStatusChanged(trip);

    const latest = await service.getLatestLocation(DRIVER, TRIP_A);
    assert.equal(latest.tracking_state, 'stopped');
    assert.equal(latest.trip_status, TripStatus.CANCELLED);
  });

  it('works without an attached broadcaster (no crash, no emit)', async () => {
    const { service, capture } = makeService({ attachBroadcaster: false });
    const { ack } = await service.recordLocation(DRIVER, locationPayload(TRIP_A));
    assert.equal(ack.status, 'accepted');
    assert.equal(capture.emitted.length, 0);
  });
});

// Helper so a few tests can run against a bespoke (mutable) trip fixture set.
function makeServiceForTrips(
  trips: StubTrip[],
  seedLocations: Parameters<typeof makeLocationStore>[0] = [],
  config: import('./live-tracking.service').LiveTrackingConfig = {
    gpsMinIntervalMs: 0,
    maxFutureSkewMs: 300_000,
    maxPastSkewMs: 86_400_000,
  },
) {
  const store = makeLocationStore(seedLocations);
  const capture = makeBroadcastCapture();
  const service = new LiveTrackingService(
    store.repo as unknown as typeof TripLocation,
    {
      findOne: async (query: { where: Record<string, unknown> }) =>
        (trips.find((trip) =>
          matchesWhere(trip as unknown as Record<string, unknown>, query.where),
        ) ?? null) as unknown as Trip,
    } as unknown as typeof Trip,
    assignmentRepo(),
    studentRepo(),
    stopRepo(),
    guardianRepo(),
    config,
    makeNoopArrivalsStub(),
  );
  service.attachBroadcaster(capture.fn);
  return { service, store, capture };
}

describe('LiveTrackingService — Task 22 stop-arrival evaluation hook', () => {
  function makeArrivalSpy() {
    const calls: Array<{ tripId: string; latitude: number; longitude: number }> = [];
    const stub = {
      onAcceptedFix: async (
        trip: StubTrip,
        fix: { latitude: number; longitude: number },
      ): Promise<null> => {
        calls.push({ tripId: trip.id, latitude: fix.latitude, longitude: fix.longitude });
        return null;
      },
      resetForTrip: () => undefined,
    } as unknown as import('../eta/stop-arrivals.service').StopArrivalsService;
    return { calls, stub };
  }

  it('evaluates every accepted latest fix for stop arrivals', async () => {
    const spy = makeArrivalSpy();
    const { service } = makeService({ arrivals: spy.stub });

    const { ack } = await service.recordLocation(DRIVER, locationPayload(TRIP_A));

    assert.equal(ack.status, 'accepted');
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].tripId, TRIP_A);
  });

  it('never evaluates rejected fixes', async () => {
    const spy = makeArrivalSpy();
    const { service } = makeService({ arrivals: spy.stub });

    // Non-crew writer → rejected before anything is persisted.
    const { ack } = await service.recordLocation(UNRELATED_DRIVER, locationPayload(TRIP_A));

    assert.equal(ack.status, 'rejected');
    assert.equal(spy.calls.length, 0);
  });

  it('never evaluates stale (out-of-order) fixes', async () => {
    const spy = makeArrivalSpy();
    const { service } = makeService({
      arrivals: spy.stub,
      seedLocations: [makeLocation({ recorded_at: new Date(Date.now() - 60_000) })],
    });

    // A fix older than the seeded latest is accepted but marked stale.
    const { ack } = await service.recordLocation(
      DRIVER,
      locationPayload(TRIP_A, { recorded_at: new Date(Date.now() - 120_000).toISOString() }),
    );

    assert.equal(ack.status, 'accepted');
    assert.equal(ack.stale, true);
    assert.equal(spy.calls.length, 0);
  });

  it('never evaluates fixes of terminal trips (completed/cancelled)', async () => {
    for (const tripId of [TRIP_A_COMPLETED, TRIP_A_CANCELLED]) {
      const spy = makeArrivalSpy();
      const { service } = makeService({ arrivals: spy.stub });

      const { ack } = await service.recordLocation(DRIVER, locationPayload(tripId));

      assert.equal(ack.status, 'rejected', `trip ${tripId}`);
      assert.equal(ack.reason, 'trip_not_open');
      assert.equal(spy.calls.length, 0);
    }
  });

  it('resets the arrival memory when a trip becomes terminal', async () => {
    const resets: string[] = [];
    const stub = {
      onAcceptedFix: async () => null,
      resetForTrip: (tripId: string) => {
        resets.push(tripId);
      },
    } as unknown as import('../eta/stop-arrivals.service').StopArrivalsService;
    const { service } = makeService({ arrivals: stub });

    await service.onTripStatusChanged(makeTrip({ status: TripStatus.COMPLETED }));

    assert.deepEqual(resets, [TRIP_A]);
  });
});
