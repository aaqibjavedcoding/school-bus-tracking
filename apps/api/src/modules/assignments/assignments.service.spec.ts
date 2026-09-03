import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import { RouteAssignmentRole, UserRole } from '@school-bus-tracking/shared-types';
import { Bus, Route, RouteAssignment, User } from '../../database/models';
import { CreateRouteAssignmentDto } from './dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from './dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from './dto/update-route-assignment.dto';
import { RouteAssignmentsService } from './assignments.service';
import {
  ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_BUS_INVALID_MESSAGE,
  ROUTE_ASSIGNMENT_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_DATE_RANGE_MESSAGE,
  ROUTE_ASSIGNMENT_DELETED_MESSAGE,
  ROUTE_ASSIGNMENT_NOT_FOUND_MESSAGE,
  ROUTE_ASSIGNMENT_ROLE_MISMATCH_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_INVALID_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_USER_INVALID_MESSAGE,
} from './assignments.constants';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '22222222-2222-4222-8222-222222222222';
const BUS_A = '33333333-3333-4333-8333-333333333333';
const BUS_B = '44444444-4444-4444-8444-444444444444';
const DRIVER_A = '55555555-5555-4555-8555-555555555555';
const CONDUCTOR_A = '66666666-6666-4666-8666-666666666666';
const DRIVER_B = '77777777-7777-4777-8777-777777777777';
const ASSIGNMENT_A = '88888888-8888-4888-8888-888888888888';

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
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Record<string, unknown>) => Promise<StubAssignment>;
  destroy: () => Promise<void>;
}

interface StubResource {
  id: string;
  school_id: string;
  is_active: boolean;
  role?: UserRole;
  name?: string;
  code?: string;
  registration_number?: string;
  bus_number?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

function makeAssignment(overrides: Partial<StubAssignment> = {}): StubAssignment {
  const assignment: StubAssignment = {
    id: ASSIGNMENT_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: BUS_A,
    user_id: DRIVER_A,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-08-27',
    effective_to: null,
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(assignment, values, {
        updated_at: new Date('2026-08-02T00:00:00.000Z'),
      });
      return assignment;
    },
    destroy: async () => {
      assignment.deleted_at = new Date('2026-08-03T00:00:00.000Z');
      assignment.updated_at = assignment.deleted_at;
    },
  };
  Object.assign(assignment, overrides);
  return assignment;
}

function makeResource(
  id: string,
  schoolId = SCHOOL_A,
  overrides: Partial<StubResource> = {},
): StubResource {
  return { id, school_id: schoolId, is_active: true, ...overrides };
}

function makeRepositories(
  initialAssignments: StubAssignment[] = [],
  resources: {
    routes?: StubResource[];
    buses?: StubResource[];
    users?: StubResource[];
  } = {},
  capture: {
    createPayload?: Record<string, unknown>;
    assignmentFindOneWhere?: Record<string, unknown>;
    routeFindOneWhere?: Record<string, unknown>;
    busFindOneWhere?: Record<string, unknown>;
    userFindOneWhere?: Record<string, unknown>;
    findAllWhere?: Record<string, unknown>;
    findAndCountWhere?: Record<PropertyKey, unknown>;
  } = {},
) {
  const assignments = [...initialAssignments];
  const routes = resources.routes ?? [{ ...makeResource(ROUTE_A), name: 'North Loop', code: 'N1' }];
  const buses = resources.buses ?? [
    { ...makeResource(BUS_A), registration_number: 'REG-A', bus_number: 'B-01' },
    { ...makeResource(BUS_B), registration_number: 'REG-B', bus_number: 'B-02' },
  ];
  const users = resources.users ?? [
    {
      ...makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER }),
      first_name: 'Ada',
      last_name: 'Driver',
      email: 'ada@school.org',
    },
    {
      ...makeResource(CONDUCTOR_A, SCHOOL_A, { role: UserRole.CONDUCTOR }),
      first_name: 'Con',
      last_name: 'Ductor',
      email: 'con@school.org',
    },
    {
      ...makeResource(DRIVER_B, SCHOOL_B, { role: UserRole.DRIVER }),
      first_name: 'Bob',
      last_name: 'Driver',
      email: 'bob@school.org',
    },
  ];

  const matches = (record: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => record[key] === value);

  const assignmentRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.assignmentFindOneWhere = options.where;
      return (assignments.find(
        (assignment) =>
          assignment.deleted_at === null &&
          matches(assignment as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as RouteAssignment;
    },
    findAll: async (options: { where: Record<string, unknown> }) => {
      capture.findAllWhere = options.where;
      return assignments.filter(
        (assignment) =>
          assignment.deleted_at === null &&
          assignment.school_id === options.where.school_id &&
          (options.where.is_active === undefined ||
            assignment.is_active === options.where.is_active),
      ) as unknown as RouteAssignment[];
    },
    findAndCountAll: async (options: {
      where: Record<PropertyKey, unknown>;
      limit?: number;
      offset?: number;
    }) => {
      capture.findAndCountWhere = options.where;
      const rows = assignments.filter(
        (assignment) =>
          assignment.deleted_at === null &&
          Object.entries(options.where).every(
            ([key, value]) => assignment[key as keyof StubAssignment] === value,
          ),
      );
      const offset = options.offset ?? 0;
      const limit = options.limit ?? rows.length;
      return {
        rows: rows.slice(offset, offset + limit) as unknown as RouteAssignment[],
        count: rows.length,
      };
    },
    create: async (payload: Record<string, unknown>) => {
      capture.createPayload = payload;
      const assignment = makeAssignment({
        id: `created-${assignments.length + 1}`,
        school_id: payload.school_id as string,
        route_id: payload.route_id as string,
        bus_id: payload.bus_id as string | null,
        user_id: payload.user_id as string,
        role: payload.role as RouteAssignmentRole,
        effective_from: payload.effective_from as string,
        effective_to: payload.effective_to as string | null,
        is_active: payload.is_active as boolean,
      });
      assignments.push(assignment);
      return assignment as unknown as RouteAssignment;
    },
  } as unknown as typeof RouteAssignment;

  const routeRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.routeFindOneWhere = options.where;
      return (routes.find((route) =>
        matches(route as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as Route;
    },
    findAll: async (options: { where: Record<string, unknown> }) => {
      return routes.filter(
        (route) => route.school_id === options.where.school_id,
      ) as unknown as Route[];
    },
  } as unknown as typeof Route;

  const busRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.busFindOneWhere = options.where;
      return (buses.find((bus) =>
        matches(bus as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as Bus;
    },
    findAll: async (options: { where: Record<string, unknown> }) => {
      return buses.filter((bus) => bus.school_id === options.where.school_id) as unknown as Bus[];
    },
  } as unknown as typeof Bus;

  const userRepo = {
    findOne: async (options: { where: Record<string, unknown> }) => {
      capture.userFindOneWhere = options.where;
      return (users.find((user) =>
        matches(user as unknown as Record<string, unknown>, options.where),
      ) ?? null) as unknown as User;
    },
    findAll: async (options: { where: Record<string, unknown> }) => {
      return users.filter(
        (user) => user.school_id === options.where.school_id,
      ) as unknown as User[];
    },
  } as unknown as typeof User;

  return { assignments, assignmentRepo, routeRepo, busRepo, userRepo };
}

function createDto(overrides: Partial<CreateRouteAssignmentDto> = {}): CreateRouteAssignmentDto {
  const dto = new CreateRouteAssignmentDto();
  dto.route_id = ROUTE_A;
  dto.bus_id = BUS_A;
  dto.user_id = DRIVER_A;
  dto.role = RouteAssignmentRole.DRIVER;
  dto.effective_from = '2026-08-27';
  return Object.assign(dto, overrides);
}

function updateDto(overrides: Partial<UpdateRouteAssignmentDto> = {}): UpdateRouteAssignmentDto {
  return Object.assign(new UpdateRouteAssignmentDto(), overrides);
}

async function expectNotFound(
  promise: Promise<unknown>,
  message = ROUTE_ASSIGNMENT_NOT_FOUND_MESSAGE,
) {
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

describe('RouteAssignmentsService.create', () => {
  it('creates a DRIVER in the JWT tenant and validates all related records', async () => {
    const capture: { createPayload?: Record<string, unknown> } = {};
    const repos = makeRepositories([], {}, capture);
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    const response = await service.create(SCHOOL_A, createDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.route_id, ROUTE_A);
    assert.equal(capture.createPayload?.bus_id, BUS_A);
    assert.equal(capture.createPayload?.user_id, DRIVER_A);
    assert.equal(capture.createPayload?.role, RouteAssignmentRole.DRIVER);
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.effective_from, '2026-08-27');
    assert.equal(response.effective_to, null);
  });

  it('allows the conductor row for the same route and bus', async () => {
    const driver = makeAssignment();
    const repos = makeRepositories([driver], {
      users: [
        makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER }),
        makeResource(CONDUCTOR_A, SCHOOL_A, { role: UserRole.CONDUCTOR }),
      ],
    });
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    const response = await service.create(
      SCHOOL_A,
      createDto({ user_id: CONDUCTOR_A, role: RouteAssignmentRole.CONDUCTOR }),
    );

    assert.equal(response.role, RouteAssignmentRole.CONDUCTOR);
    assert.equal(response.route_id, ROUTE_A);
  });

  it('pins every related lookup to the JWT school', async () => {
    const capture: {
      routeFindOneWhere?: Record<string, unknown>;
      busFindOneWhere?: Record<string, unknown>;
      userFindOneWhere?: Record<string, unknown>;
    } = {};
    const repos = makeRepositories([], {}, capture);
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    await service.create(SCHOOL_A, createDto());

    assert.deepEqual(capture.routeFindOneWhere, { id: ROUTE_A, school_id: SCHOOL_A });
    assert.deepEqual(capture.busFindOneWhere, { id: BUS_A, school_id: SCHOOL_A });
    assert.deepEqual(capture.userFindOneWhere, { id: DRIVER_A, school_id: SCHOOL_A });
  });

  it('rejects a route, bus or user from another school', async () => {
    const cases: Array<
      [string, Partial<CreateRouteAssignmentDto>, string, keyof ReturnType<typeof makeRepositories>]
    > = [
      [ROUTE_B, { route_id: ROUTE_B }, ROUTE_ASSIGNMENT_ROUTE_INVALID_MESSAGE, 'routeRepo'],
      [BUS_B, { bus_id: BUS_B }, ROUTE_ASSIGNMENT_BUS_INVALID_MESSAGE, 'busRepo'],
      [DRIVER_B, { user_id: DRIVER_B }, ROUTE_ASSIGNMENT_USER_INVALID_MESSAGE, 'userRepo'],
    ];

    for (const [, overrides, message] of cases) {
      const repos = makeRepositories([], {
        routes: [makeResource(ROUTE_A)],
        buses: [makeResource(BUS_A)],
        users: [
          makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER }),
          makeResource(DRIVER_B, SCHOOL_B, { role: UserRole.DRIVER }),
        ],
      });
      const service = new RouteAssignmentsService(
        repos.assignmentRepo,
        repos.routeRepo,
        repos.busRepo,
        repos.userRepo,
      );
      await expectBadRequest(service.create(SCHOOL_A, createDto(overrides)), message);
    }
  });

  it('rejects a user whose stored role does not match the assignment role', async () => {
    const repos = makeRepositories([], {
      users: [makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER })],
    });
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    await expectBadRequest(
      service.create(
        SCHOOL_A,
        createDto({ user_id: DRIVER_A, role: RouteAssignmentRole.CONDUCTOR }),
      ),
      ROUTE_ASSIGNMENT_ROLE_MISMATCH_MESSAGE,
    );
  });

  it('rejects an invalid date range before writing', async () => {
    const repos = makeRepositories();
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    await expectBadRequest(
      service.create(
        SCHOOL_A,
        createDto({ effective_from: '2026-08-27', effective_to: '2026-08-26' }),
      ),
      ROUTE_ASSIGNMENT_DATE_RANGE_MESSAGE,
    );
  });

  it('maps a database uniqueness race to 409', async () => {
    const repos = makeRepositories();
    repos.assignmentRepo.create = async () => {
      throw new UniqueConstraintError({ errors: [{ path: 'effective_from' } as never] });
    };
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    await expectConflict(service.create(SCHOOL_A, createDto()), ROUTE_ASSIGNMENT_CONFLICT_MESSAGE);
  });
});

describe('RouteAssignmentsService.findAll/findOne', () => {
  it('lists only the authenticated school and supports role filters', async () => {
    const capture: { findAndCountWhere?: Record<PropertyKey, unknown> } = {};
    const repos = makeRepositories(
      [
        makeAssignment({ id: ASSIGNMENT_A, school_id: SCHOOL_A }),
        makeAssignment({ id: 'other-school', school_id: SCHOOL_B }),
        makeAssignment({
          id: 'conductor',
          role: RouteAssignmentRole.CONDUCTOR,
          user_id: CONDUCTOR_A,
        }),
      ],
      {},
      capture,
    );
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );
    const query = new ListRouteAssignmentsQueryDto();
    query.role = RouteAssignmentRole.DRIVER;
    query.page = 1;
    query.limit = 10;

    const result = await service.findAll(SCHOOL_A, query);

    assert.deepEqual(
      result.items.map((item) => item.id),
      [ASSIGNMENT_A],
    );
    assert.equal(result.meta.total, 1);
    assert.equal(capture.findAndCountWhere?.['school_id'], SCHOOL_A);
    assert.equal(capture.findAndCountWhere?.['role'], RouteAssignmentRole.DRIVER);
  });

  it('returns route, bus and crew display names', async () => {
    const repos = makeRepositories([makeAssignment({ id: ASSIGNMENT_A, school_id: SCHOOL_A })]);
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    const result = await service.findAll(SCHOOL_A, new ListRouteAssignmentsQueryDto());

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].route_name, 'North Loop');
    assert.equal(result.items[0].route_code, 'N1');
    assert.equal(result.items[0].bus_number, 'B-01');
    assert.equal(result.items[0].bus_registration_number, 'REG-A');
    assert.equal(result.items[0].user_name, 'Ada Driver');
    assert.equal(result.items[0].user_email, 'ada@school.org');
  });

  it('applies free-text search as an Op.or over route, bus and crew ids', async () => {
    const capture: { findAndCountWhere?: Record<PropertyKey, unknown> } = {};
    const repos = makeRepositories([makeAssignment()], {}, capture);
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );

    const query = new ListRouteAssignmentsQueryDto();
    query.search = 'North';
    await service.findAll(SCHOOL_A, query);

    const or = capture.findAndCountWhere?.[Op.or] as Array<Record<PropertyKey, unknown>>;
    assert.ok(or, 'search must be applied via Op.or');
    assert.deepEqual(or[0].route_id, { [Op.in]: [ROUTE_A] });
  });

  it('returns a generic 404 for another tenant', async () => {
    const repos = makeRepositories([makeAssignment({ school_id: SCHOOL_B })]);
    const service = new RouteAssignmentsService(
      repos.assignmentRepo,
      repos.routeRepo,
      repos.busRepo,
      repos.userRepo,
    );
    await expectNotFound(service.findOne(SCHOOL_A, ASSIGNMENT_A));
  });
});

describe('RouteAssignmentsService conflicts and CRUD', () => {
  function serviceWith(existing: StubAssignment[]) {
    const repos = makeRepositories(existing, {
      routes: [makeResource(ROUTE_A), makeResource(ROUTE_B)],
      buses: [makeResource(BUS_A), makeResource(BUS_B)],
      users: [
        makeResource(DRIVER_A, SCHOOL_A, { role: UserRole.DRIVER }),
        makeResource(CONDUCTOR_A, SCHOOL_A, { role: UserRole.CONDUCTOR }),
        makeResource(DRIVER_B, SCHOOL_B, { role: UserRole.DRIVER }),
      ],
    });
    return {
      service: new RouteAssignmentsService(
        repos.assignmentRepo,
        repos.routeRepo,
        repos.busRepo,
        repos.userRepo,
      ),
      repos,
    };
  }

  it('rejects an overlapping second active assignment for the same route role', async () => {
    const { service } = serviceWith([makeAssignment()]);
    await expectConflict(
      service.create(SCHOOL_A, createDto()),
      ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE,
    );
  });

  it('rejects changing buses on one route during an overlap', async () => {
    const { service } = serviceWith([makeAssignment()]);
    await expectConflict(
      service.create(
        SCHOOL_A,
        createDto({ bus_id: BUS_B, user_id: CONDUCTOR_A, role: RouteAssignmentRole.CONDUCTOR }),
      ),
      ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE,
    );
  });

  it('rejects using one bus on two routes during an overlap', async () => {
    const { service } = serviceWith([makeAssignment()]);
    await expectConflict(
      service.create(SCHOOL_A, createDto({ route_id: ROUTE_B })),
      ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE,
    );
  });

  it('rejects double-booking the same driver on two routes during an overlap', async () => {
    const { service } = serviceWith([makeAssignment()]);
    await expectConflict(
      service.create(SCHOOL_A, createDto({ route_id: ROUTE_B, bus_id: BUS_B })),
      ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE,
    );
  });

  it('rejects double-booking the same conductor on two routes during an overlap', async () => {
    const conductor = makeAssignment({
      user_id: CONDUCTOR_A,
      role: RouteAssignmentRole.CONDUCTOR,
    });
    const { service } = serviceWith([conductor]);
    await expectConflict(
      service.create(
        SCHOOL_A,
        createDto({
          route_id: ROUTE_B,
          bus_id: BUS_B,
          user_id: CONDUCTOR_A,
          role: RouteAssignmentRole.CONDUCTOR,
        }),
      ),
      ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE,
    );
  });

  it('rejects an update that makes the same crew member overlap on two routes', async () => {
    const first = makeAssignment({
      id: 'a1',
      route_id: ROUTE_A,
      bus_id: BUS_A,
      user_id: DRIVER_A,
      role: RouteAssignmentRole.DRIVER,
      effective_from: '2026-01-01',
      effective_to: '2026-06-30',
    });
    const second = makeAssignment({
      id: 'a2',
      route_id: ROUTE_B,
      bus_id: BUS_B,
      user_id: DRIVER_A,
      role: RouteAssignmentRole.DRIVER,
      effective_from: '2026-07-01',
      effective_to: null,
    });
    const { service } = serviceWith([first, second]);

    await expectConflict(
      service.update(SCHOOL_A, 'a2', updateDto({ effective_from: '2026-06-15' })),
      ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE,
    );
  });

  it('allows the same crew member to serve two routes in non-overlapping periods', async () => {
    const first = makeAssignment({
      id: 'a1',
      route_id: ROUTE_A,
      bus_id: BUS_A,
      user_id: DRIVER_A,
      role: RouteAssignmentRole.DRIVER,
      effective_from: '2026-01-01',
      effective_to: '2026-06-30',
    });
    const { service } = serviceWith([first]);
    const response = await service.create(
      SCHOOL_A,
      createDto({
        route_id: ROUTE_B,
        bus_id: BUS_B,
        user_id: DRIVER_A,
        role: RouteAssignmentRole.DRIVER,
        effective_from: '2026-07-01',
        effective_to: '2026-12-31',
      }),
    );
    assert.equal(response.route_id, ROUTE_B);
    assert.equal(response.user_id, DRIVER_A);
  });

  it('ignores conflicting assignments that belong to another school', async () => {
    const { service } = serviceWith([makeAssignment({ school_id: SCHOOL_B })]);
    const response = await service.create(SCHOOL_A, createDto());
    assert.equal(response.route_id, ROUTE_A);
  });

  it('allows non-overlapping history and ignores inactive conflicts', async () => {
    const { service } = serviceWith([
      makeAssignment({ effective_from: '2026-01-01', effective_to: '2026-08-26' }),
      makeAssignment({ id: 'inactive', is_active: false, effective_from: '2026-08-27' }),
    ]);
    const response = await service.create(
      SCHOOL_A,
      createDto({ effective_from: '2026-08-27', effective_to: '2026-12-31' }),
    );
    assert.equal(response.role, RouteAssignmentRole.DRIVER);
  });

  it('updates an assignment with tenant-safe references and soft-deletes it', async () => {
    const assignment = makeAssignment();
    const { service } = serviceWith([assignment]);

    const updated = await service.update(
      SCHOOL_A,
      ASSIGNMENT_A,
      updateDto({ effective_to: '2026-12-31', is_active: false }),
    );
    assert.equal(updated.effective_to, '2026-12-31');
    assert.equal(updated.is_active, false);
    assert.equal(assignment.school_id, SCHOOL_A);

    const deleted = await service.remove(SCHOOL_A, ASSIGNMENT_A);
    assert.equal(deleted.id, ASSIGNMENT_A);
    assert.equal(deleted.message, ROUTE_ASSIGNMENT_DELETED_MESSAGE);
    assert.notEqual(assignment.deleted_at, null);
  });

  it('returns 404 when updating another tenant assignment', async () => {
    const { service } = serviceWith([makeAssignment({ school_id: SCHOOL_B })]);
    await expectNotFound(service.update(SCHOOL_A, ASSIGNMENT_A, updateDto({ is_active: false })));
  });
});
