import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConflictException, JwtService, NotFoundException, Reflector } from '../../framework';
import {
  JwtAccessTokenPayload,
  RouteAssignmentRole,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  STOP_SKIP_REASON_MAX_LENGTH,
  STOP_SKIP_REASON_MIN_LENGTH,
  isValidStopSkipReason,
} from '@school-bus-tracking/validation';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { IDEMPOTENCY_ENDPOINTS } from '../../common/idempotency/idempotency.constants';
import {
  postTripsByTripIdStopsByStopIdArrive,
  postTripsByTripIdStopsByStopIdSkip,
} from '../../api/crew-stops';
import { StopArrivalsService } from '../eta/stop-arrivals.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { EtaService } from '../eta/eta.service';
import type { RouteAssignment, Stop, Student, Trip, TripStopArrival } from '../../database/models';
import { CrewStopMarkingService } from './crew-stop-marking.service';
import { SkipStopDto } from './dto';
import {
  CREW_STOPS_STOP_NOT_ON_TRIP_MESSAGE,
  CREW_STOPS_TRIP_CLOSED_MESSAGE,
  CREW_STOPS_TRIP_NOT_FOUND_MESSAGE,
} from './crew-stops.constants';

/**
 * Crew stop marking — `POST /trips/:tripId/stops/:stopId/arrive` and
 * `.../skip`.
 *
 * Three properties are load-bearing enough to be pinned here, because each
 * one fails silently and expensively in the field:
 *
 * 1. **authorization** — only the crew of *that* trip. A stop arrival is
 *    testimony about where a bus physically was; an admin at a desk, a
 *    parent, or a driver rostered on another route must not be able to write
 *    it, and must not be able to tell from the answer whether the trip even
 *    exists.
 * 2. **idempotency** — the mobile button goes through the offline queue, so
 *    the same tap is replayed until the server confirms it. A replay must
 *    never produce a second arrival row, a second parent notification or a
 *    second broadcast, and must not look like a failure to the crew.
 * 3. **the skip reason** — the one crew action with no physical evidence
 *    behind it. An empty, blank or one-character reason is worthless to the
 *    school that reads it later, so the bar is enforced on the DTO (after
 *    trimming) and mirrored in the shared validation package the phone uses.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ROUTE_A = '11111111-1111-4111-8111-11111111aaaa';
const ROUTE_OTHER = '11111111-1111-4111-8111-11111111bbbb';

const STOP_1 = '22222222-2222-4222-8222-222222220001';
const STOP_2 = '22222222-2222-4222-8222-222222220002';
const STOP_OTHER_ROUTE = '22222222-2222-4222-8222-222222220003';

const DRIVER_DISPATCHED = '44444444-4444-4444-8444-444444440001';
const CONDUCTOR_DISPATCHED = '44444444-4444-4444-8444-444444440002';
const DRIVER_ROSTERED = '44444444-4444-4444-8444-444444440003';
const DRIVER_UNRELATED = '44444444-4444-4444-8444-444444440004';
const DRIVER_EXPIRED = '44444444-4444-4444-8444-444444440005';

const TRIP_A = '55555555-5555-4555-8555-555555550001';
const TRIP_COMPLETED = '55555555-5555-4555-8555-555555550002';
const TRIP_OTHER_SCHOOL = '55555555-5555-4555-8555-555555550003';

const SCHEDULED_START = new Date('2026-09-01T06:30:00.000Z');
const SECRET = 'unit-test-jwt-secret';

// ── Stub data ──────────────────────────────────────────────────────────────

interface StubStop {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  sequence_number: number;
}

interface StubTrip {
  id: string;
  school_id: string;
  route_id: string;
  driver_id: string | null;
  conductor_id: string | null;
  status: TripStatus;
  scheduled_start_at: Date;
}

interface StubArrival {
  id: string;
  school_id: string;
  trip_id: string;
  stop_id: string;
  arrived_at: Date;
  latitude: number | null;
  longitude: number | null;
  distance_meters: number | null;
  source: 'geofence' | 'crew';
  skip_reason: string | null;
  recorded_by: string | null;
  created_at: Date;
}

const STOPS: StubStop[] = [
  { id: STOP_1, school_id: SCHOOL_A, route_id: ROUTE_A, name: 'Maple St', sequence_number: 1 },
  { id: STOP_2, school_id: SCHOOL_A, route_id: ROUTE_A, name: 'Oak Ave', sequence_number: 2 },
  {
    id: STOP_OTHER_ROUTE,
    school_id: SCHOOL_A,
    route_id: ROUTE_OTHER,
    name: 'Elm Rd',
    sequence_number: 1,
  },
];

const TRIPS: StubTrip[] = [
  {
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    driver_id: DRIVER_DISPATCHED,
    conductor_id: CONDUCTOR_DISPATCHED,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: SCHEDULED_START,
  },
  {
    id: TRIP_COMPLETED,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    driver_id: DRIVER_DISPATCHED,
    conductor_id: null,
    status: TripStatus.COMPLETED,
    scheduled_start_at: SCHEDULED_START,
  },
  {
    id: TRIP_OTHER_SCHOOL,
    school_id: SCHOOL_B,
    route_id: ROUTE_A,
    driver_id: DRIVER_DISPATCHED,
    conductor_id: null,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: SCHEDULED_START,
  },
];

const ASSIGNMENTS = [
  {
    id: 'assignment-rostered',
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    user_id: DRIVER_ROSTERED,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-08-01',
    effective_to: null as string | null,
    is_active: true,
  },
  {
    id: 'assignment-expired',
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    user_id: DRIVER_EXPIRED,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-07-01',
    effective_to: '2026-07-31',
    is_active: true,
  },
];

// ── Stub models ────────────────────────────────────────────────────────────

/** Matches a `where` clause against a plain row (equality only). */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

/** In-memory `trip_stop_arrivals` with the real unique-index behaviour. */
class ArrivalStore {
  readonly rows: StubArrival[] = [];
  createCalls = 0;

  /** `undefined` is what a model without a connection exposes. */
  readonly sequelize = undefined;

  async findOne({ where }: { where: Record<string, unknown> }): Promise<StubArrival | null> {
    return this.rows.find((row) => matches(row as never, where)) ?? null;
  }

  async findAll({ where }: { where: Record<string, unknown> }): Promise<StubArrival[]> {
    return this.rows.filter((row) => matches(row as never, where));
  }

  async create(values: Partial<StubArrival>): Promise<StubArrival> {
    this.createCalls += 1;
    const duplicate = this.rows.some(
      (row) =>
        row.school_id === values.school_id &&
        row.trip_id === values.trip_id &&
        row.stop_id === values.stop_id,
    );
    if (duplicate) {
      // What PostgreSQL's `uq_trip_stop_arrivals_trip_stop` raises.
      const error = new Error('duplicate key value violates unique constraint');
      error.name = 'SequelizeUniqueConstraintError';
      throw error;
    }
    const row: StubArrival = {
      id: `arrival-${this.rows.length + 1}`,
      school_id: values.school_id!,
      trip_id: values.trip_id!,
      stop_id: values.stop_id!,
      arrived_at: values.arrived_at ?? new Date(),
      latitude: values.latitude ?? null,
      longitude: values.longitude ?? null,
      distance_meters: values.distance_meters ?? null,
      source: values.source ?? 'geofence',
      skip_reason: values.skip_reason ?? null,
      recorded_by: values.recorded_by ?? null,
      created_at: new Date(),
    };
    this.rows.push(row);
    return row;
  }
}

interface Harness {
  service: CrewStopMarkingService;
  arrivals: ArrivalStore;
  notifications: string[];
  broadcasts: string[];
}

function makeHarness(): Harness {
  const arrivals = new ArrivalStore();
  const notifications: string[] = [];
  const broadcasts: string[] = [];

  const notificationsService = {
    async notifyStopArrival(input: { stop: { id: string } }): Promise<void> {
      notifications.push(input.stop.id);
    },
  } as unknown as NotificationsService;

  const stopArrivals = new StopArrivalsService(
    { findAll: async () => [] } as unknown as typeof Stop,
    arrivals as unknown as typeof TripStopArrival,
    {} as unknown as EtaService,
    notificationsService,
  );
  stopArrivals.attachBroadcaster((_room, event) => {
    broadcasts.push(event);
  });

  const trips = {
    async findOne({ where }: { where: Record<string, unknown> }) {
      return TRIPS.find((trip) => matches(trip as never, where)) ?? null;
    },
  } as unknown as typeof Trip;

  const stops = {
    async findOne({ where }: { where: Record<string, unknown> }) {
      return STOPS.find((stop) => matches(stop as never, where)) ?? null;
    },
  } as unknown as typeof Stop;

  const students = {
    async count({ where }: { where: Record<string, unknown> }) {
      return where['home_stop_id'] === STOP_2 ? 5 : 0;
    },
  } as unknown as typeof Student;

  const assignments = {
    async findAll({ where }: { where: Record<string, unknown> }) {
      return ASSIGNMENTS.filter((assignment) => matches(assignment as never, where));
    },
  } as unknown as typeof RouteAssignment;

  return {
    service: new CrewStopMarkingService(trips, stops, students, assignments, stopArrivals),
    arrivals,
    notifications,
    broadcasts,
  };
}

function actor(id: string, role: UserRole, schoolId: string = SCHOOL_A): AuthenticatedRequestUser {
  return { id, role, school_id: schoolId } as AuthenticatedRequestUser;
}

// ── 1. Authorization ───────────────────────────────────────────────────────

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole): Promise<string> {
  const payload: JwtAccessTokenPayload = {
    sub: DRIVER_DISPATCHED,
    school_id: role === UserRole.SUPER_ADMIN ? null : SCHOOL_A,
    role,
  };
  return jwtService.signAsync(payload);
}

const arriveDefinition = postTripsByTripIdStopsByStopIdArrive as EndpointDefinition<never, never>;
const skipDefinition = postTripsByTripIdStopsByStopIdSkip as unknown as EndpointDefinition<
  never,
  never
>;

async function activateGuards(
  role: UserRole,
  definition: EndpointDefinition<never, never>,
): Promise<{ headers: Record<string, unknown>; user?: AuthenticatedRequestUser }> {
  const request = { headers: { authorization: `Bearer ${await signAccessToken(role)}` } };
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
  return request as never;
}

describe('crew stop marking — authorization', () => {
  it('is declared for the trip crew only (no admin, no parent)', () => {
    for (const definition of [arriveDefinition, skipDefinition]) {
      assert.deepEqual(definition.roles, [UserRole.DRIVER, UserRole.CONDUCTOR]);
    }
  });

  it('lets a driver and a conductor through the guard chain', async () => {
    for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR]) {
      for (const definition of [arriveDefinition, skipDefinition]) {
        const request = await activateGuards(role, definition);
        assert.equal(request.user?.role, role);
        assert.equal(request.user?.school_id, SCHOOL_A);
      }
    }
  });

  it('rejects a parent, a school admin and the platform super admin with 403', async () => {
    for (const role of [UserRole.PARENT, UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN]) {
      for (const definition of [arriveDefinition, skipDefinition]) {
        await assert.rejects(
          activateGuards(role, definition),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403);
            return true;
          },
        );
      }
    }
  });

  it('accepts the dispatched crew of the trip', async () => {
    for (const [id, role] of [
      [DRIVER_DISPATCHED, UserRole.DRIVER],
      [CONDUCTOR_DISPATCHED, UserRole.CONDUCTOR],
    ] as const) {
      const harness = makeHarness();
      const result = await harness.service.markArrived(actor(id, role), TRIP_A, STOP_2);
      assert.equal(result.created, true);
      assert.equal(result.arrival.source, 'crew');
      assert.equal(result.arrival.recorded_by, id);
    }
  });

  it('accepts a driver rostered on the route for the trip date', async () => {
    const harness = makeHarness();
    const result = await harness.service.markArrived(
      actor(DRIVER_ROSTERED, UserRole.DRIVER),
      TRIP_A,
      STOP_1,
    );
    assert.equal(result.created, true);
  });

  it('rejects an unrelated driver and an expired roster with the generic 404', async () => {
    for (const id of [DRIVER_UNRELATED, DRIVER_EXPIRED]) {
      const harness = makeHarness();
      await assert.rejects(
        harness.service.markArrived(actor(id, UserRole.DRIVER), TRIP_A, STOP_1),
        (error: NotFoundException) => {
          assert.equal(error.message, CREW_STOPS_TRIP_NOT_FOUND_MESSAGE);
          return true;
        },
      );
      assert.equal(harness.arrivals.rows.length, 0);
    }
  });

  it('never marks across tenants — another school\u2019s trip is a 404', async () => {
    const harness = makeHarness();
    await assert.rejects(
      harness.service.markArrived(
        actor(DRIVER_DISPATCHED, UserRole.DRIVER),
        TRIP_OTHER_SCHOOL,
        STOP_1,
      ),
      NotFoundException,
    );
    assert.equal(harness.arrivals.rows.length, 0);
  });

  it('rejects a stop that is not on the trip\u2019s route', async () => {
    const harness = makeHarness();
    await assert.rejects(
      harness.service.markArrived(
        actor(DRIVER_DISPATCHED, UserRole.DRIVER),
        TRIP_A,
        STOP_OTHER_ROUTE,
      ),
      (error: NotFoundException) => {
        assert.equal(error.message, CREW_STOPS_STOP_NOT_ON_TRIP_MESSAGE);
        return true;
      },
    );
  });

  it('refuses a closed trip with 409 — its stop record is an audit artefact', async () => {
    const harness = makeHarness();
    await assert.rejects(
      harness.service.markArrived(
        actor(DRIVER_DISPATCHED, UserRole.DRIVER),
        TRIP_COMPLETED,
        STOP_1,
      ),
      (error: ConflictException) => {
        assert.equal(error.message, CREW_STOPS_TRIP_CLOSED_MESSAGE);
        return true;
      },
    );
    assert.equal(harness.arrivals.rows.length, 0);
  });
});

// ── 2. Idempotency ─────────────────────────────────────────────────────────

describe('crew stop marking — idempotency', () => {
  it('declares an idempotency scope, and a different one per action', () => {
    assert.equal(arriveDefinition.idempotency, IDEMPOTENCY_ENDPOINTS.STOP_ARRIVE);
    assert.equal(skipDefinition.idempotency, IDEMPOTENCY_ENDPOINTS.STOP_SKIP);
    assert.notEqual(IDEMPOTENCY_ENDPOINTS.STOP_ARRIVE, IDEMPOTENCY_ENDPOINTS.STOP_SKIP);
  });

  it('records one row for a repeated arrive, and notifies parents once', async () => {
    const harness = makeHarness();
    const crew = actor(DRIVER_DISPATCHED, UserRole.DRIVER);

    const first = await harness.service.markArrived(crew, TRIP_A, STOP_2);
    const second = await harness.service.markArrived(crew, TRIP_A, STOP_2);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.arrival.id, first.arrival.id);
    assert.equal(harness.arrivals.rows.length, 1);
    assert.deepEqual(harness.notifications, [STOP_2]);
    assert.equal(harness.broadcasts.length, 1);
  });

  it('records one row for a repeated skip, and never notifies a parent', async () => {
    const harness = makeHarness();
    const crew = actor(CONDUCTOR_DISPATCHED, UserRole.CONDUCTOR);

    const first = await harness.service.markSkipped(crew, TRIP_A, STOP_1, 'road closed');
    const second = await harness.service.markSkipped(crew, TRIP_A, STOP_1, 'road closed');

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(harness.arrivals.rows.length, 1);
    assert.equal(first.arrival.skip_reason, 'road closed');
    assert.equal(first.arrival.source, 'crew');
    // A skipped stop was not served: no parent alert, and no "arrived" push
    // into the trip room either.
    assert.deepEqual(harness.notifications, []);
    assert.deepEqual(harness.broadcasts, []);
  });

  it('treats a stop the geofence already recorded as done, without a second row', async () => {
    const harness = makeHarness();
    await harness.arrivals.create({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      stop_id: STOP_1,
      arrived_at: new Date('2026-09-01T06:40:00.000Z'),
      latitude: 18.5,
      longitude: 73.8,
      distance_meters: 12,
      source: 'geofence',
    });

    const result = await harness.service.markArrived(
      actor(DRIVER_DISPATCHED, UserRole.DRIVER),
      TRIP_A,
      STOP_1,
    );

    assert.equal(result.created, false);
    // The geofence row is returned untouched — the crew tap does not rewrite
    // measured evidence with a claim.
    assert.equal(result.arrival.source, 'geofence');
    assert.equal(result.arrival.distance_meters, 12);
    assert.equal(harness.arrivals.rows.length, 1);
    assert.deepEqual(harness.notifications, []);
  });

  it('survives the unique-index race — a concurrent insert is not a 500', async () => {
    const harness = makeHarness();
    const crew = actor(DRIVER_DISPATCHED, UserRole.DRIVER);

    // Both reads miss, both attempt the insert: the second hits the index.
    const [first, second] = await Promise.all([
      harness.service.markArrived(crew, TRIP_A, STOP_2),
      harness.service.markArrived(crew, TRIP_A, STOP_2),
    ]);

    assert.equal(harness.arrivals.rows.length, 1);
    assert.equal(harness.arrivals.createCalls, 2, 'both requests really did race to insert');
    assert.equal(first.arrival.id, second.arrival.id);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
  });

  it('reports the stop position and the expected head count for the confirmation', async () => {
    const harness = makeHarness();
    const result = await harness.service.markArrived(
      actor(DRIVER_DISPATCHED, UserRole.DRIVER),
      TRIP_A,
      STOP_2,
    );
    // "Stop 2 recorded, 5 children board here" — both numbers server-side.
    assert.equal(result.stop_sequence_number, 2);
    assert.equal(result.students_expected, 5);
  });

  it('stores no coordinates for a crew mark — nothing was measured', async () => {
    const harness = makeHarness();
    const result = await harness.service.markArrived(
      actor(DRIVER_DISPATCHED, UserRole.DRIVER),
      TRIP_A,
      STOP_1,
    );
    assert.equal(result.arrival.latitude, null);
    assert.equal(result.arrival.longitude, null);
    assert.equal(result.arrival.distance_meters, null);
  });
});

// ── 3. The skip reason ─────────────────────────────────────────────────────

async function skipDtoErrors(body: Record<string, unknown>) {
  return validate(plainToInstance(SkipStopDto, body));
}

describe('crew stop marking — the skip reason', () => {
  it('requires at least three characters, measured after trimming', async () => {
    assert.equal(STOP_SKIP_REASON_MIN_LENGTH, 3);
    for (const reason of [undefined, null, '', '  ', 'x', 'ab', '  a  ']) {
      const errors = await skipDtoErrors({ reason });
      assert.ok(errors.length > 0, `expected "${String(reason)}" to be rejected`);
    }
  });

  it('accepts a genuine short answer, and trims it before storing', async () => {
    for (const reason of ['jam', 'band', '  road closed  ']) {
      assert.deepEqual(await skipDtoErrors({ reason }), []);
    }
    const dto = plainToInstance(SkipStopDto, { reason: '  road closed  ' });
    assert.equal(dto.reason, 'road closed');
  });

  it('rejects a reason past the column bound', async () => {
    const tooLong = 'x'.repeat(STOP_SKIP_REASON_MAX_LENGTH + 1);
    assert.ok((await skipDtoErrors({ reason: tooLong })).length > 0);
    assert.deepEqual(await skipDtoErrors({ reason: 'x'.repeat(STOP_SKIP_REASON_MAX_LENGTH) }), []);
  });

  it('agrees with the shared predicate the mobile button uses', () => {
    // The phone must refuse exactly what the server refuses, or the crew gets
    // a round-trip to learn what a local check could have told them.
    for (const reason of ['', '  ', 'ab', null, 42]) {
      assert.equal(isValidStopSkipReason(reason), false);
    }
    for (const reason of ['jam', '  road closed  ']) {
      assert.equal(isValidStopSkipReason(reason), true);
    }
  });

  it('stores the trimmed reason verbatim on the row', async () => {
    const harness = makeHarness();
    const result = await harness.service.markSkipped(
      actor(DRIVER_DISPATCHED, UserRole.DRIVER),
      TRIP_A,
      STOP_1,
      '  gate band tha  ',
    );
    assert.equal(result.arrival.skip_reason, 'gate band tha');
  });
});
