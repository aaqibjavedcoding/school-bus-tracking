import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import { RouteAssignmentRole, TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { CancelTripDto } from './dto/cancel-trip.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { ListTripsQueryDto } from './dto/list-trips-query.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';
import { TripsService } from './trips.service';
import {
  TRIP_ACTUAL_RANGE_MESSAGE,
  TRIP_ASSIGNMENT_BUS_MISSING_MESSAGE,
  TRIP_ASSIGNMENT_INACTIVE_MESSAGE,
  TRIP_ASSIGNMENT_INVALID_MESSAGE,
  TRIP_ASSIGNMENT_PERIOD_MESSAGE,
  TRIP_BUS_INVALID_MESSAGE,
  TRIP_CONFLICT_MESSAGE,
  TRIP_DATE_INVALID_MESSAGE,
  TRIP_DATE_RANGE_MESSAGE,
  TRIP_DELETED_MESSAGE,
  TRIP_DRIVER_INVALID_MESSAGE,
  TRIP_DRIVER_MISSING_MESSAGE,
  TRIP_INACTIVE_RESOURCE_MESSAGE,
  TRIP_INVALID_TRANSITION_MESSAGE,
  TRIP_NOT_EDITABLE_MESSAGE,
  TRIP_NOT_FOUND_MESSAGE,
  TRIP_QUERY_DATE_RANGE_MESSAGE,
  TRIP_ROUTE_INVALID_MESSAGE,
} from './trips.constants';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '11111111-1111-4111-8111-111111111112';
const BUS_A = '22222222-2222-4222-8222-222222222221';
const BUS_B = '22222222-2222-4222-8222-222222222222';
const DRIVER_A = '33333333-3333-4333-8333-333333333331';
const DRIVER_B = '33333333-3333-4333-8333-333333333332';
const CONDUCTOR_A = '44444444-4444-4444-8444-444444444441';
const ASSIGNMENT_DRIVER = '55555555-5555-4555-8555-555555555551';
const ASSIGNMENT_CONDUCTOR = '55555555-5555-4555-8555-555555555552';
const ASSIGNMENT_OTHER_SCHOOL = '55555555-5555-4555-8555-555555555553';
const ASSIGNMENT_INACTIVE = '55555555-5555-4555-8555-555555555554';
const ASSIGNMENT_NO_BUS = '55555555-5555-4555-8555-555555555555';
const ASSIGNMENT_EXPIRED = '55555555-5555-4555-8555-555555555556';
const TRIP_A = '66666666-6666-4666-8666-666666666661';
const TRIP_B = '66666666-6666-4666-8666-666666666662';

const SCHEDULED_START = '2026-09-01T06:30:00.000Z';
const SCHEDULED_END = '2026-09-01T07:30:00.000Z';

interface StubTrip {
  id: string;
  school_id: string;
  route_id: string;
  bus_id: string | null;
  driver_id: string | null;
  conductor_id: string | null;
  status: TripStatus;
  scheduled_start_at: Date;
  scheduled_end_at: Date | null;
  actual_start_at: Date | null;
  actual_end_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Record<string, unknown>) => Promise<StubTrip>;
  destroy: () => Promise<void>;
}

interface StubAssignment {
  id: string;
  school_id: string;
  route_id: string;
  bus_id: string | null;
  user_id: string;
  role: RouteAssignmentRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

interface StubResource {
  id: string;
  school_id: string;
  is_active: boolean;
  role?: UserRole;
}

function makeTrip(overrides: Partial<StubTrip> = {}): StubTrip {
  const trip: StubTrip = {
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: BUS_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.SCHEDULED,
    scheduled_start_at: new Date(SCHEDULED_START),
    scheduled_end_at: new Date(SCHEDULED_END),
    actual_start_at: null,
    actual_end_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(trip, values, { updated_at: new Date('2026-08-02T00:00:00.000Z') });
      return trip;
    },
    destroy: async () => {
      trip.deleted_at = new Date('2026-08-03T00:00:00.000Z');
    },
  };
  Object.assign(trip, overrides);
  return trip;
}

function makeAssignment(overrides: Partial<StubAssignment> = {}): StubAssignment {
  return {
    id: ASSIGNMENT_DRIVER,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: BUS_A,
    user_id: DRIVER_A,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-08-01',
    effective_to: null,
    is_active: true,
    ...overrides,
  };
}

function makeResource(
  id: string,
  schoolId = SCHOOL_A,
  overrides: Partial<StubResource> = {},
): StubResource {
  return { id, school_id: schoolId, is_active: true, ...overrides };
}

function defaultAssignments(): StubAssignment[] {
  return [
    makeAssignment(),
    makeAssignment({
      id: ASSIGNMENT_CONDUCTOR,
      user_id: CONDUCTOR_A,
      role: RouteAssignmentRole.CONDUCTOR,
    }),
    makeAssignment({ id: ASSIGNMENT_OTHER_SCHOOL, school_id: SCHOOL_B, route_id: ROUTE_B }),
    makeAssignment({ id: ASSIGNMENT_INACTIVE, is_active: false }),
    makeAssignment({ id: ASSIGNMENT_NO_BUS, bus_id: null }),
    makeAssignment({ id: ASSIGNMENT_EXPIRED, effective_to: '2026-08-10' }),
  ];
}

function defaultResources() {
  return {
    routes: [makeResource(ROUTE_A), makeResource(ROUTE_B, SCHOOL_B)],
    buses: [makeResource(BUS_A), makeResource(BUS_B, SCHOOL_B)],
    users: [
      makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER }),
      makeResource(CONDUCTOR_A, SCHOOL_A, { role: UserRole.CONDUCTOR }),
      makeResource(DRIVER_B, SCHOOL_B, { role: UserRole.DRIVER }),
    ],
  };
}

/** Matches plain equality plus the `Op.gte` / `Op.lt` date-range operators. */
function matchesWhere(record: Record<string, unknown>, where: Record<PropertyKey, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }
    if (expected !== null && typeof expected === 'object') {
      const operators = expected as Record<symbol, Date>;
      const value = actual instanceof Date ? actual.getTime() : Number.NaN;
      if (operators[Op.gte] !== undefined && value < operators[Op.gte].getTime()) return false;
      if (operators[Op.lt] !== undefined && value >= operators[Op.lt].getTime()) return false;
      return true;
    }
    return actual === expected;
  });
}

interface Capture {
  createPayload?: Record<string, unknown>;
  tripFindOneWhere?: Record<PropertyKey, unknown>;
  findAndCountWhere?: Record<PropertyKey, unknown>;
  assignmentFindOneWhere?: Record<string, unknown>;
  assignmentFindAllWhere?: Record<string, unknown>;
  routeFindOneWhere?: Record<string, unknown>;
  busFindOneWhere?: Record<string, unknown>;
  userFindOneWheres?: Array<Record<string, unknown>>;
}

function makeRepositories(
  initialTrips: StubTrip[] = [],
  assignmentRows: StubAssignment[] = defaultAssignments(),
  resources = defaultResources(),
  capture: Capture = {},
) {
  const trips = [...initialTrips];
  capture.userFindOneWheres = [];

  const tripRepo = {
    findOne: async (options: { where: Record<PropertyKey, unknown> }) => {
      capture.tripFindOneWhere = options.where;
      return (trips.find(
        (trip) =>
          trip.deleted_at === null &&
          matchesWhere(trip as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as Trip;
    },
    findAndCountAll: async (options: {
      where: Record<PropertyKey, unknown>;
      limit?: number;
      offset?: number;
    }) => {
      capture.findAndCountWhere = options.where;
      const rows = trips.filter(
        (trip) =>
          trip.deleted_at === null &&
          matchesWhere(trip as unknown as Record<string, unknown>, options.where),
      );
      const offset = options.offset ?? 0;
      const limit = options.limit ?? rows.length;
      return {
        rows: rows.slice(offset, offset + limit) as unknown as Trip[],
        count: rows.length,
      };
    },
    create: async (payload: Record<string, unknown>) => {
      capture.createPayload = payload;
      const trip = makeTrip({
        id: `created-${trips.length + 1}`,
        school_id: payload.school_id as string,
        route_id: payload.route_id as string,
        bus_id: payload.bus_id as string | null,
        driver_id: payload.driver_id as string | null,
        conductor_id: payload.conductor_id as string | null,
        status: payload.status as TripStatus,
        scheduled_start_at: payload.scheduled_start_at as Date,
        scheduled_end_at: payload.scheduled_end_at as Date | null,
      });
      trips.push(trip);
      return trip as unknown as Trip;
    },
  } as unknown as typeof Trip;

  const assignmentRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.assignmentFindOneWhere = options.where;
      return (assignmentRows.find((assignment) =>
        matchesWhere(assignment as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as RouteAssignment;
    },
    findAll: async (options: { where: Record<string, unknown> }) => {
      capture.assignmentFindAllWhere = options.where;
      return assignmentRows.filter((assignment) =>
        matchesWhere(assignment as unknown as Record<string, unknown>, options.where),
      ) as unknown as RouteAssignment[];
    },
  } as unknown as typeof RouteAssignment;

  const routeRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.routeFindOneWhere = options.where;
      return (resources.routes.find((route) =>
        matchesWhere(route as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as Route;
    },
  } as unknown as typeof Route;

  const busRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.busFindOneWhere = options.where;
      return (resources.buses.find((bus) =>
        matchesWhere(bus as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as Bus;
    },
  } as unknown as typeof Bus;

  const userRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.userFindOneWheres?.push(options.where);
      return (resources.users.find((user) =>
        matchesWhere(user as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as User;
    },
  } as unknown as typeof User;

  return { trips, tripRepo, assignmentRepo, routeRepo, busRepo, userRepo };
}

function makeService(repos: ReturnType<typeof makeRepositories>): TripsService {
  return new TripsService(
    repos.tripRepo,
    repos.assignmentRepo,
    repos.routeRepo,
    repos.busRepo,
    repos.userRepo,
  );
}

function createDto(overrides: Partial<CreateTripDto> = {}): CreateTripDto {
  const dto = new CreateTripDto();
  dto.route_assignment_id = ASSIGNMENT_DRIVER;
  dto.scheduled_start_at = SCHEDULED_START;
  dto.scheduled_end_at = SCHEDULED_END;
  return Object.assign(dto, overrides);
}

function updateDto(overrides: Partial<UpdateTripDto> = {}): UpdateTripDto {
  return Object.assign(new UpdateTripDto(), overrides);
}

function statusDto(
  status: TripStatus,
  overrides: Partial<UpdateTripStatusDto> = {},
): UpdateTripStatusDto {
  const dto = new UpdateTripStatusDto();
  dto.status = status;
  return Object.assign(dto, overrides);
}

async function expectNotFound(promise: Promise<unknown>, message = TRIP_NOT_FOUND_MESSAGE) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException);
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, message);
    return true;
  });
}

async function expectBadRequest(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    assert.equal(error.message, message);
    return true;
  });
}

async function expectConflict(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.getStatus(), 409);
    assert.equal(error.message, message);
    return true;
  });
}

describe('TripsService.create', () => {
  it('derives school, route, bus, driver and conductor from the assignment', async () => {
    const capture: Capture = {};
    const service = makeService(
      makeRepositories([], defaultAssignments(), defaultResources(), capture),
    );

    const response = await service.create(SCHOOL_A, createDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.route_id, ROUTE_A);
    assert.equal(capture.createPayload?.bus_id, BUS_A);
    assert.equal(capture.createPayload?.driver_id, DRIVER_A);
    assert.equal(capture.createPayload?.conductor_id, CONDUCTOR_A);
    assert.equal(capture.createPayload?.status, TripStatus.SCHEDULED);
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.status, TripStatus.SCHEDULED);
    assert.equal(response.scheduled_start_at, SCHEDULED_START);
    assert.equal(response.scheduled_end_at, SCHEDULED_END);
    assert.equal(response.actual_start_at, null);
    assert.equal(response.cancelled_at, null);
  });

  it('pins every derivation lookup to the JWT school', async () => {
    const capture: Capture = {};
    const service = makeService(
      makeRepositories([], defaultAssignments(), defaultResources(), capture),
    );

    await service.create(SCHOOL_A, createDto());

    assert.deepEqual(capture.assignmentFindOneWhere, {
      id: ASSIGNMENT_DRIVER,
      school_id: SCHOOL_A,
    });
    assert.deepEqual(capture.routeFindOneWhere, { id: ROUTE_A, school_id: SCHOOL_A });
    assert.deepEqual(capture.busFindOneWhere, { id: BUS_A, school_id: SCHOOL_A });
    assert.equal(capture.assignmentFindAllWhere?.school_id, SCHOOL_A);
    assert.ok(
      capture.userFindOneWheres?.every((where) => where.school_id === SCHOOL_A),
      'crew lookups must be tenant pinned',
    );
  });

  it('derives the driver when dispatching from the conductor roster row', async () => {
    const capture: Capture = {};
    const service = makeService(
      makeRepositories([], defaultAssignments(), defaultResources(), capture),
    );

    const response = await service.create(
      SCHOOL_A,
      createDto({ route_assignment_id: ASSIGNMENT_CONDUCTOR }),
    );

    assert.equal(response.driver_id, DRIVER_A);
    assert.equal(response.conductor_id, CONDUCTOR_A);
  });

  it('allows a trip without a conductor when none is rostered', async () => {
    const service = makeService(makeRepositories([], [makeAssignment()]));

    const response = await service.create(SCHOOL_A, createDto());

    assert.equal(response.driver_id, DRIVER_A);
    assert.equal(response.conductor_id, null);
  });

  it('rejects an assignment belonging to another school', async () => {
    const service = makeService(makeRepositories());

    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ route_assignment_id: ASSIGNMENT_OTHER_SCHOOL })),
      TRIP_ASSIGNMENT_INVALID_MESSAGE,
    );
    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ route_assignment_id: TRIP_B })),
      TRIP_ASSIGNMENT_INVALID_MESSAGE,
    );
  });

  it('rejects an inactive assignment, a bus-less assignment and an expired period', async () => {
    const service = makeService(makeRepositories());

    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ route_assignment_id: ASSIGNMENT_INACTIVE })),
      TRIP_ASSIGNMENT_INACTIVE_MESSAGE,
    );
    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ route_assignment_id: ASSIGNMENT_NO_BUS })),
      TRIP_ASSIGNMENT_BUS_MISSING_MESSAGE,
    );
    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ route_assignment_id: ASSIGNMENT_EXPIRED })),
      TRIP_ASSIGNMENT_PERIOD_MESSAGE,
    );
  });

  it('rejects a trip scheduled before the assignment becomes effective', async () => {
    const service = makeService(makeRepositories());

    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ scheduled_start_at: '2026-07-31T06:00:00.000Z' })),
      TRIP_ASSIGNMENT_PERIOD_MESSAGE,
    );
  });

  it('rejects a route or bus that no longer resolves inside the tenant', async () => {
    const missingRoute = makeRepositories([], defaultAssignments(), {
      ...defaultResources(),
      routes: [makeResource(ROUTE_B, SCHOOL_B)],
    });
    await expectBadRequest(
      makeService(missingRoute).create(SCHOOL_A, createDto()),
      TRIP_ROUTE_INVALID_MESSAGE,
    );

    const missingBus = makeRepositories([], defaultAssignments(), {
      ...defaultResources(),
      buses: [makeResource(BUS_B, SCHOOL_B)],
    });
    await expectBadRequest(
      makeService(missingBus).create(SCHOOL_A, createDto()),
      TRIP_BUS_INVALID_MESSAGE,
    );
  });

  it('rejects inactive routes, buses and crew members', async () => {
    const inactiveRoute = makeRepositories([], defaultAssignments(), {
      ...defaultResources(),
      routes: [makeResource(ROUTE_A, SCHOOL_A, { is_active: false })],
    });
    await expectBadRequest(
      makeService(inactiveRoute).create(SCHOOL_A, createDto()),
      TRIP_INACTIVE_RESOURCE_MESSAGE,
    );

    const inactiveBus = makeRepositories([], defaultAssignments(), {
      ...defaultResources(),
      buses: [makeResource(BUS_A, SCHOOL_A, { is_active: false })],
    });
    await expectBadRequest(
      makeService(inactiveBus).create(SCHOOL_A, createDto()),
      TRIP_INACTIVE_RESOURCE_MESSAGE,
    );

    const inactiveDriver = makeRepositories([], defaultAssignments(), {
      ...defaultResources(),
      users: [
        makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER, is_active: false }),
        makeResource(CONDUCTOR_A, SCHOOL_A, { role: UserRole.CONDUCTOR }),
      ],
    });
    await expectBadRequest(
      makeService(inactiveDriver).create(SCHOOL_A, createDto()),
      TRIP_INACTIVE_RESOURCE_MESSAGE,
    );
  });

  it('rejects a crew member whose stored role no longer matches the seat', async () => {
    const repos = makeRepositories([], defaultAssignments(), {
      ...defaultResources(),
      users: [
        makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.PARENT }),
        makeResource(CONDUCTOR_A, SCHOOL_A, { role: UserRole.CONDUCTOR }),
      ],
    });

    await expectBadRequest(
      makeService(repos).create(SCHOOL_A, createDto()),
      TRIP_DRIVER_INVALID_MESSAGE,
    );
  });

  it('requires an active driver when dispatching from a conductor row', async () => {
    const assignments = [
      makeAssignment({
        id: ASSIGNMENT_CONDUCTOR,
        user_id: CONDUCTOR_A,
        role: RouteAssignmentRole.CONDUCTOR,
      }),
      makeAssignment({ id: ASSIGNMENT_INACTIVE, is_active: false }),
    ];
    const service = makeService(makeRepositories([], assignments));

    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ route_assignment_id: ASSIGNMENT_CONDUCTOR })),
      TRIP_DRIVER_MISSING_MESSAGE,
    );
  });

  it('rejects an inverted or unparsable schedule before writing', async () => {
    const service = makeService(makeRepositories());

    await expectBadRequest(
      service.create(
        SCHOOL_A,
        createDto({
          scheduled_start_at: SCHEDULED_END,
          scheduled_end_at: SCHEDULED_START,
        }),
      ),
      TRIP_DATE_RANGE_MESSAGE,
    );
    await expectBadRequest(
      service.create(SCHOOL_A, createDto({ scheduled_start_at: 'not-a-date' })),
      TRIP_DATE_INVALID_MESSAGE,
    );
  });

  it('rejects a second trip on the same route at the same departure', async () => {
    const service = makeService(makeRepositories([makeTrip()]));

    await expectConflict(service.create(SCHOOL_A, createDto()), TRIP_CONFLICT_MESSAGE);
  });

  it('maps a database uniqueness race to 409', async () => {
    const repos = makeRepositories();
    repos.tripRepo.create = async () => {
      throw new UniqueConstraintError({ errors: [{ path: 'scheduled_start_at' } as never] });
    };

    await expectConflict(makeService(repos).create(SCHOOL_A, createDto()), TRIP_CONFLICT_MESSAGE);
  });
});

describe('TripsService.findAll', () => {
  it('scopes the query to the JWT school and paginates', async () => {
    const capture: Capture = {};
    const trips = [
      makeTrip(),
      makeTrip({ id: TRIP_B, scheduled_start_at: new Date('2026-09-02T06:30:00.000Z') }),
      makeTrip({ id: 'other', school_id: SCHOOL_B }),
    ];
    const service = makeService(
      makeRepositories(trips, defaultAssignments(), defaultResources(), capture),
    );

    const query = new ListTripsQueryDto();
    query.page = 1;
    query.limit = 1;
    const result = await service.findAll(SCHOOL_A, query);

    assert.equal(capture.findAndCountWhere?.school_id, SCHOOL_A);
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.meta, {
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('filters by status, route, bus, driver and conductor', async () => {
    const capture: Capture = {};
    const trips = [
      makeTrip(),
      makeTrip({ id: TRIP_B, status: TripStatus.COMPLETED, route_id: ROUTE_B, bus_id: BUS_B }),
    ];
    const service = makeService(
      makeRepositories(trips, defaultAssignments(), defaultResources(), capture),
    );

    const query = new ListTripsQueryDto();
    query.status = TripStatus.COMPLETED;
    query.route_id = ROUTE_B;
    query.bus_id = BUS_B;
    query.driver_id = DRIVER_A;
    query.conductor_id = CONDUCTOR_A;
    const result = await service.findAll(SCHOOL_A, query);

    assert.deepEqual(capture.findAndCountWhere, {
      school_id: SCHOOL_A,
      status: TripStatus.COMPLETED,
      route_id: ROUTE_B,
      bus_id: BUS_B,
      driver_id: DRIVER_A,
      conductor_id: CONDUCTOR_A,
    });
    assert.deepEqual(
      result.items.map((trip) => trip.id),
      [TRIP_B],
    );
  });

  it('filters a single UTC day and an inclusive day range', async () => {
    const trips = [
      makeTrip({ id: TRIP_A, scheduled_start_at: new Date('2026-09-01T23:59:59.000Z') }),
      makeTrip({ id: TRIP_B, scheduled_start_at: new Date('2026-09-02T00:00:00.000Z') }),
      makeTrip({ id: 'third', scheduled_start_at: new Date('2026-09-05T06:00:00.000Z') }),
    ];

    const dayQuery = new ListTripsQueryDto();
    dayQuery.date = '2026-09-01';
    const day = await makeService(makeRepositories(trips)).findAll(SCHOOL_A, dayQuery);
    assert.deepEqual(
      day.items.map((trip) => trip.id),
      [TRIP_A],
    );

    const rangeQuery = new ListTripsQueryDto();
    rangeQuery.date_from = '2026-09-02';
    rangeQuery.date_to = '2026-09-05';
    const range = await makeService(makeRepositories(trips)).findAll(SCHOOL_A, rangeQuery);
    assert.deepEqual(range.items.map((trip) => trip.id).sort(), [TRIP_B, 'third'].sort());
  });

  it('rejects an inverted day range', async () => {
    const query = new ListTripsQueryDto();
    query.date_from = '2026-09-05';
    query.date_to = '2026-09-01';

    await expectBadRequest(
      makeService(makeRepositories()).findAll(SCHOOL_A, query),
      TRIP_QUERY_DATE_RANGE_MESSAGE,
    );
  });
});

describe('TripsService.findOne', () => {
  it('returns a trip of the authenticated school', async () => {
    const service = makeService(makeRepositories([makeTrip()]));
    const trip = await service.findOne(SCHOOL_A, TRIP_A);
    assert.equal(trip.id, TRIP_A);
  });

  it('hides trips of another school behind the generic 404', async () => {
    const service = makeService(makeRepositories([makeTrip()]));
    await expectNotFound(service.findOne(SCHOOL_B, TRIP_A));
  });
});

describe('TripsService.update', () => {
  it('reschedules a scheduled trip without touching the crew', async () => {
    const trip = makeTrip();
    const service = makeService(makeRepositories([trip]));

    const response = await service.update(
      SCHOOL_A,
      TRIP_A,
      updateDto({
        scheduled_start_at: '2026-09-01T07:00:00.000Z',
        scheduled_end_at: null,
      }),
    );

    assert.equal(response.scheduled_start_at, '2026-09-01T07:00:00.000Z');
    assert.equal(response.scheduled_end_at, null);
    assert.equal(response.driver_id, DRIVER_A);
    assert.equal(response.conductor_id, CONDUCTOR_A);
  });

  it('re-derives route, bus and crew when a new assignment is supplied', async () => {
    const trip = makeTrip({ driver_id: null, conductor_id: null, bus_id: null });
    const service = makeService(makeRepositories([trip]));

    const response = await service.update(
      SCHOOL_A,
      TRIP_A,
      updateDto({ route_assignment_id: ASSIGNMENT_DRIVER }),
    );

    assert.equal(response.route_id, ROUTE_A);
    assert.equal(response.bus_id, BUS_A);
    assert.equal(response.driver_id, DRIVER_A);
    assert.equal(response.conductor_id, CONDUCTOR_A);
  });

  it('validates the new assignment against the tenant and the new date', async () => {
    const service = makeService(makeRepositories([makeTrip()]));

    await expectBadRequest(
      service.update(SCHOOL_A, TRIP_A, updateDto({ route_assignment_id: ASSIGNMENT_OTHER_SCHOOL })),
      TRIP_ASSIGNMENT_INVALID_MESSAGE,
    );
    await expectBadRequest(
      service.update(
        SCHOOL_A,
        TRIP_A,
        updateDto({
          route_assignment_id: ASSIGNMENT_EXPIRED,
          scheduled_start_at: '2026-09-01T06:30:00.000Z',
        }),
      ),
      TRIP_ASSIGNMENT_PERIOD_MESSAGE,
    );
  });

  it('refuses to reschedule a trip that already left', async () => {
    const service = makeService(makeRepositories([makeTrip({ status: TripStatus.IN_PROGRESS })]));

    await expectConflict(
      service.update(SCHOOL_A, TRIP_A, updateDto({ scheduled_start_at: SCHEDULED_END })),
      TRIP_NOT_EDITABLE_MESSAGE,
    );
  });

  it('rejects an inverted schedule and a clashing departure', async () => {
    const clash = makeTrip({
      id: TRIP_B,
      scheduled_start_at: new Date('2026-09-01T09:00:00.000Z'),
    });
    const service = makeService(makeRepositories([makeTrip(), clash]));

    await expectBadRequest(
      service.update(SCHOOL_A, TRIP_A, updateDto({ scheduled_end_at: '2026-09-01T05:00:00.000Z' })),
      TRIP_DATE_RANGE_MESSAGE,
    );
    await expectConflict(
      service.update(
        SCHOOL_A,
        TRIP_A,
        updateDto({
          scheduled_start_at: '2026-09-01T09:00:00.000Z',
          scheduled_end_at: null,
        }),
      ),
      TRIP_CONFLICT_MESSAGE,
    );
  });

  it('allows an idempotent update that keeps the same departure', async () => {
    const service = makeService(makeRepositories([makeTrip()]));

    const response = await service.update(
      SCHOOL_A,
      TRIP_A,
      updateDto({ scheduled_start_at: SCHEDULED_START }),
    );

    assert.equal(response.scheduled_start_at, SCHEDULED_START);
  });

  it('hides trips of another school behind the generic 404', async () => {
    const service = makeService(makeRepositories([makeTrip()]));
    await expectNotFound(service.update(SCHOOL_B, TRIP_A, updateDto({})));
  });
});

describe('TripsService lifecycle', () => {
  it('walks SCHEDULED → IN_PROGRESS → COMPLETED and stamps the actual times', async () => {
    const trip = makeTrip();
    const service = makeService(makeRepositories([trip]));

    const started = await service.updateStatus(
      SCHOOL_A,
      TRIP_A,
      statusDto(TripStatus.IN_PROGRESS, { actual_start_at: '2026-09-01T06:35:00.000Z' }),
    );
    assert.equal(started.status, TripStatus.IN_PROGRESS);
    assert.equal(started.actual_start_at, '2026-09-01T06:35:00.000Z');

    const completed = await service.updateStatus(
      SCHOOL_A,
      TRIP_A,
      statusDto(TripStatus.COMPLETED, { actual_end_at: '2026-09-01T07:40:00.000Z' }),
    );
    assert.equal(completed.status, TripStatus.COMPLETED);
    assert.equal(completed.actual_start_at, '2026-09-01T06:35:00.000Z');
    assert.equal(completed.actual_end_at, '2026-09-01T07:40:00.000Z');
  });

  it('supports the optional BOARDING step and defaults timestamps to the server clock', async () => {
    const service = makeService(makeRepositories([makeTrip()]));

    const boarding = await service.updateStatus(SCHOOL_A, TRIP_A, statusDto(TripStatus.BOARDING));
    assert.equal(boarding.status, TripStatus.BOARDING);
    assert.equal(boarding.actual_start_at, null);

    const started = await service.updateStatus(SCHOOL_A, TRIP_A, statusDto(TripStatus.IN_PROGRESS));
    assert.equal(started.status, TripStatus.IN_PROGRESS);
    assert.ok(started.actual_start_at !== null);
  });

  it('rejects every invalid transition', async () => {
    const cases: Array<[TripStatus, TripStatus]> = [
      [TripStatus.SCHEDULED, TripStatus.COMPLETED],
      [TripStatus.SCHEDULED, TripStatus.SCHEDULED],
      [TripStatus.BOARDING, TripStatus.SCHEDULED],
      [TripStatus.IN_PROGRESS, TripStatus.BOARDING],
      [TripStatus.COMPLETED, TripStatus.IN_PROGRESS],
      [TripStatus.COMPLETED, TripStatus.CANCELLED],
      [TripStatus.CANCELLED, TripStatus.SCHEDULED],
      [TripStatus.CANCELLED, TripStatus.IN_PROGRESS],
    ];

    for (const [from, to] of cases) {
      const service = makeService(makeRepositories([makeTrip({ status: from })]));
      await expectBadRequest(
        service.updateStatus(SCHOOL_A, TRIP_A, statusDto(to)),
        TRIP_INVALID_TRANSITION_MESSAGE(from, to),
      );
    }
  });

  it('rejects a completion that ends before it started', async () => {
    const trip = makeTrip({
      status: TripStatus.IN_PROGRESS,
      actual_start_at: new Date('2026-09-01T06:35:00.000Z'),
    });
    const service = makeService(makeRepositories([trip]));

    await expectBadRequest(
      service.updateStatus(
        SCHOOL_A,
        TRIP_A,
        statusDto(TripStatus.COMPLETED, { actual_end_at: '2026-09-01T06:00:00.000Z' }),
      ),
      TRIP_ACTUAL_RANGE_MESSAGE,
    );
  });

  it('cancels a scheduled or running trip and records the audit note', async () => {
    const scheduled = makeService(makeRepositories([makeTrip()]));
    const cancelled = await scheduled.cancel(
      SCHOOL_A,
      TRIP_A,
      Object.assign(new CancelTripDto(), { cancellation_reason: '  Heavy snow  ' }),
    );
    assert.equal(cancelled.status, TripStatus.CANCELLED);
    assert.equal(cancelled.cancellation_reason, 'Heavy snow');
    assert.ok(cancelled.cancelled_at !== null);

    const running = makeService(makeRepositories([makeTrip({ status: TripStatus.IN_PROGRESS })]));
    const stopped = await running.cancel(SCHOOL_A, TRIP_A, new CancelTripDto());
    assert.equal(stopped.status, TripStatus.CANCELLED);
    assert.equal(stopped.cancellation_reason, null);
  });

  it('refuses to cancel a terminal trip', async () => {
    const service = makeService(makeRepositories([makeTrip({ status: TripStatus.COMPLETED })]));

    await expectBadRequest(
      service.cancel(SCHOOL_A, TRIP_A, new CancelTripDto()),
      TRIP_INVALID_TRANSITION_MESSAGE(TripStatus.COMPLETED, TripStatus.CANCELLED),
    );
  });

  it('hides trips of another school behind the generic 404', async () => {
    const service = makeService(makeRepositories([makeTrip()]));
    await expectNotFound(service.updateStatus(SCHOOL_B, TRIP_A, statusDto(TripStatus.BOARDING)));
    await expectNotFound(service.cancel(SCHOOL_B, TRIP_A, new CancelTripDto()));
  });
});

describe('TripsService.remove', () => {
  it('cancels an open trip before soft-deleting it', async () => {
    const trip = makeTrip();
    const service = makeService(makeRepositories([trip]));

    const result = await service.remove(SCHOOL_A, TRIP_A);

    assert.deepEqual(result, { id: TRIP_A, message: TRIP_DELETED_MESSAGE });
    assert.equal(trip.status, TripStatus.CANCELLED);
    assert.ok(trip.cancelled_at !== null);
    assert.ok(trip.deleted_at !== null);
  });

  it('keeps a terminal status untouched while soft-deleting', async () => {
    const trip = makeTrip({ status: TripStatus.COMPLETED });
    const service = makeService(makeRepositories([trip]));

    await service.remove(SCHOOL_A, TRIP_A);

    assert.equal(trip.status, TripStatus.COMPLETED);
    assert.equal(trip.cancelled_at, null);
    assert.ok(trip.deleted_at !== null);
  });

  it('hides trips of another school behind the generic 404', async () => {
    const service = makeService(makeRepositories([makeTrip()]));
    await expectNotFound(service.remove(SCHOOL_B, TRIP_A));
  });
});
