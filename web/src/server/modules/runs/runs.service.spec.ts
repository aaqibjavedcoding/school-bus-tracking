import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import { PlanLimitResource, RouteAssignmentRole } from '@school-bus-tracking/shared-types';
import { Bus, Route, Run, RunCrew, Shift, Student, User } from '../../database/models';
import { PlanLimitsService } from '../../common/plan-limits';
import { RunsService } from './runs.service';
import {
  RUN_BUS_INVALID_MESSAGE,
  RUN_CODE_TAKEN_MESSAGE,
  RUN_CODE_UNAVAILABLE_MESSAGE,
  RUN_DEFAULT_UNDELETABLE_MESSAGE,
  RUN_DELETED_MESSAGE,
  RUN_INACTIVE_RESOURCE_MESSAGE,
  RUN_NOT_FOUND_MESSAGE,
  RUN_ROUTE_INVALID_MESSAGE,
  RUN_SHIFT_INVALID_MESSAGE,
} from './runs.constants';
import { ROUTE_NOT_FOUND_MESSAGE } from '../routes/routes.constants';
import { BUS_NOT_FOUND_MESSAGE } from '../buses/buses.constants';
import { CreateRouteRunDto, CreateRunDto } from './dto/create-run.dto';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { UpdateRunDto } from './dto/update-run.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '22222222-2222-4222-8222-222222222222';
const SHIFT_AM = '33333333-3333-4333-8333-333333333333';
const BUS_1 = '44444444-4444-4444-8444-444444444444';
const RUN_DEFAULT = '55555555-5555-4555-8555-555555555555';
const RUN_TIER = '66666666-6666-4666-8666-666666666666';
const DRIVER_1 = '77777777-7777-4777-8777-777777777777';

interface StubRunRecord {
  id: string;
  school_id: string;
  route_id: string;
  shift_id: string | null;
  bus_id: string | null;
  code: string;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Partial<StubRunRecord>) => Promise<StubRunRecord>;
  destroy: () => Promise<void>;
}

interface SimpleRecord {
  id: string;
  school_id: string;
  is_active: boolean;
  deleted_at?: Date | null;
  [key: string]: unknown;
}

type WhereClause = Record<string | symbol, unknown>;

function makeRunRecord(overrides: Partial<StubRunRecord> = {}): StubRunRecord {
  const record: StubRunRecord = {
    id: RUN_DEFAULT,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    shift_id: null,
    bus_id: null,
    code: 'R-01',
    is_default: true,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(record, values, { updated_at: new Date('2026-02-01T00:00:00.000Z') });
      return record;
    },
    destroy: async () => {
      record.deleted_at = new Date();
    },
    ...overrides,
  };
  return record;
}

/** Minimal evaluator for the where shapes the service produces. */
function matchesWhere(candidate: object, where: WhereClause): boolean {
  const record = candidate as Record<string, unknown>;
  if (record.deleted_at) return false;
  for (const key of Object.keys(where)) {
    const expected = where[key];
    const actual = record[key];
    if (expected !== null && typeof expected === 'object') {
      const op = expected as Record<symbol, unknown>;
      if (Op.ne in op && actual === op[Op.ne]) return false;
      if (Op.in in op && !(op[Op.in] as unknown[]).includes(actual)) return false;
      if (Op.iLike in op) {
        const raw = String(op[Op.iLike]).replace(/\\([\\%_])/g, '$1');
        const anchoredEnd = raw.endsWith('%');
        const anchoredStart = raw.startsWith('%');
        const needle = raw.replace(/^%|%$/g, '').toLowerCase();
        const haystack = String(actual ?? '').toLowerCase();
        if (anchoredStart && anchoredEnd && !haystack.includes(needle)) return false;
        if (!anchoredStart && anchoredEnd && !haystack.startsWith(needle)) return false;
        if (!anchoredStart && !anchoredEnd && haystack !== needle) return false;
      }
      continue;
    }
    if (actual !== expected) return false;
  }
  const or = (where as Record<symbol, unknown>)[Op.or] as WhereClause[] | undefined;
  if (or && !or.some((clause) => matchesWhere(record, clause))) return false;
  return true;
}

interface RunRepoHarness {
  repo: typeof Run;
  records: StubRunRecord[];
  createCalls: Array<{ values: Record<string, unknown>; options: Record<string, unknown> }>;
  destroyCalls: WhereClause[];
}

function makeRunRepo(records: StubRunRecord[]): RunRepoHarness {
  const createCalls: RunRepoHarness['createCalls'] = [];
  const destroyCalls: WhereClause[] = [];
  let counter = 0;
  const repo = {
    findOne: async ({ where }: { where: WhereClause }) =>
      records.find((record) => matchesWhere(record, where)) ?? null,
    findAll: async ({ where }: { where: WhereClause }) =>
      records.filter((record) => matchesWhere(record, where)),
    findAndCountAll: async ({
      where,
      limit,
      offset,
    }: {
      where: WhereClause;
      limit: number;
      offset: number;
    }) => {
      const filtered = records.filter((record) => matchesWhere(record, where));
      return { rows: filtered.slice(offset, offset + limit), count: filtered.length };
    },
    create: async (values: Record<string, unknown>, options: Record<string, unknown> = {}) => {
      createCalls.push({ values, options });
      counter += 1;
      const record = makeRunRecord({
        id: `99999999-9999-4999-8999-${String(counter).padStart(12, '0')}`,
        ...(values as Partial<StubRunRecord>),
      });
      records.push(record);
      return record;
    },
    destroy: async ({ where }: { where: WhereClause }) => {
      destroyCalls.push(where);
      let removed = 0;
      for (const record of records) {
        if (matchesWhere(record, where)) {
          record.deleted_at = new Date();
          removed += 1;
        }
      }
      return removed;
    },
  } as unknown as typeof Run;
  return { repo, records, createCalls, destroyCalls };
}

function simpleRepo<T>(records: SimpleRecord[]): T {
  return {
    findOne: async ({ where }: { where: WhereClause }) =>
      records.find((record) => matchesWhere(record, where)) ?? null,
    findAll: async ({ where }: { where: WhereClause }) =>
      records.filter((record) => matchesWhere(record, where)),
  } as unknown as T;
}

interface PlanLimitsHarness {
  service: PlanLimitsService;
  calls: Array<{ schoolId: string; resource: unknown }>;
}

function recordingPlanLimits(reject = false): PlanLimitsHarness {
  const calls: PlanLimitsHarness['calls'] = [];
  const service = {
    runWithinLimit: async <T>(schoolId: string, resource: unknown, work: () => Promise<T>) => {
      calls.push({ schoolId, resource });
      if (reject) {
        throw new Error('plan limit reached');
      }
      return work();
    },
  } as unknown as PlanLimitsService;
  return { service, calls };
}

interface Fixture {
  runs: RunRepoHarness;
  planLimits: PlanLimitsHarness;
  service: RunsService;
}

function buildFixture(
  options: {
    runs?: StubRunRecord[];
    routes?: SimpleRecord[];
    shifts?: SimpleRecord[];
    buses?: SimpleRecord[];
    crew?: Array<Record<string, unknown>>;
    users?: SimpleRecord[];
    students?: Array<Record<string, unknown>>;
    rejectPlanLimit?: boolean;
  } = {},
): Fixture {
  const runs = makeRunRepo(options.runs ?? []);
  const planLimits = recordingPlanLimits(options.rejectPlanLimit);
  const routes = options.routes ?? [
    { id: ROUTE_A, school_id: SCHOOL_A, name: 'North Loop', code: 'R-01', is_active: true },
    { id: ROUTE_B, school_id: SCHOOL_B, name: 'Other School', code: 'X-01', is_active: true },
  ];
  const shifts = options.shifts ?? [
    {
      id: SHIFT_AM,
      school_id: SCHOOL_A,
      name: 'Morning',
      start_time: '06:30:00',
      end_time: '09:00:00',
      is_active: true,
    },
  ];
  const buses = options.buses ?? [
    {
      id: BUS_1,
      school_id: SCHOOL_A,
      bus_number: 'B-7',
      registration_number: 'KA01AB1234',
      is_active: true,
    },
  ];
  const service = new RunsService(
    runs.repo,
    simpleRepo<typeof Route>(routes),
    simpleRepo<typeof Shift>(shifts),
    simpleRepo<typeof Bus>(buses),
    simpleRepo<typeof RunCrew>((options.crew ?? []) as SimpleRecord[]),
    simpleRepo<typeof User>(options.users ?? []),
    simpleRepo<typeof Student>((options.students ?? []) as SimpleRecord[]),
    planLimits.service,
  );
  return { runs, planLimits, service };
}

function createDto(overrides: Partial<CreateRunDto> = {}): CreateRunDto {
  const dto = new CreateRunDto();
  dto.route_id = ROUTE_A;
  Object.assign(dto, overrides);
  return dto;
}

function listQuery(overrides: Partial<ListRunsQueryDto> = {}): ListRunsQueryDto {
  const query = new ListRunsQueryDto();
  Object.assign(query, overrides);
  return query;
}

async function expectRejects(
  promise: Promise<unknown>,
  type: new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof type, `expected ${type.name}, got ${String(error)}`);
    assert.equal((error as Error).message, message);
    return true;
  });
}

describe('RunsService.create', () => {
  it('creates a non-default run inside the runs plan reservation', async () => {
    const fixture = buildFixture({ runs: [makeRunRecord()] });

    const response = await fixture.service.create(
      SCHOOL_A,
      createDto({ shift_id: SHIFT_AM, bus_id: BUS_1, code: ' R-01-AM ' }),
    );

    assert.deepEqual(fixture.planLimits.calls, [
      { schoolId: SCHOOL_A, resource: PlanLimitResource.RUNS },
    ]);
    assert.equal(fixture.runs.createCalls.length, 1);
    assert.deepEqual(fixture.runs.createCalls[0].values, {
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      shift_id: SHIFT_AM,
      bus_id: BUS_1,
      code: 'R-01-AM',
      is_default: false,
      is_active: true,
    });
    assert.equal(response.is_default, false);
    assert.equal(response.route_name, 'North Loop');
    assert.equal(response.shift_name, 'Morning');
    assert.equal(response.shift_start_time, '06:30:00');
    assert.equal(response.bus_number, 'B-7');
    assert.equal(response.student_count, 0);
  });

  it('never lets a client mark a run as default', async () => {
    const fixture = buildFixture();
    const dto = createDto();
    (dto as unknown as Record<string, unknown>).is_default = true;

    await fixture.service.create(SCHOOL_A, dto);

    assert.equal(fixture.runs.createCalls[0].values.is_default, false);
  });

  it('propagates a plan-limit rejection and writes nothing', async () => {
    const fixture = buildFixture({ rejectPlanLimit: true });

    await assert.rejects(fixture.service.create(SCHOOL_A, createDto()), /plan limit reached/);
    assert.equal(fixture.runs.createCalls.length, 0);
  });

  it('derives the code from the route when the client sends none', async () => {
    const fixture = buildFixture({
      runs: [
        makeRunRecord({ id: RUN_DEFAULT, code: 'R-01' }),
        makeRunRecord({ id: RUN_TIER, code: 'r-01-2', is_default: false }),
      ],
    });

    const response = await fixture.service.create(SCHOOL_A, createDto());

    assert.equal(response.code, 'R-01-3');
  });

  it('uses the bare route code when it is free (e.g. deleted default run)', async () => {
    const fixture = buildFixture({
      runs: [makeRunRecord({ id: RUN_DEFAULT, code: 'R-01', deleted_at: new Date() })],
    });

    const response = await fixture.service.create(SCHOOL_A, createDto());

    assert.equal(response.code, 'R-01');
  });

  it('gives up deriving after the suffix cap', async () => {
    const records = [makeRunRecord({ id: RUN_DEFAULT, code: 'R-01' })];
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      records.push(
        makeRunRecord({ id: `run-${suffix}`, code: `R-01-${suffix}`, is_default: false }),
      );
    }
    const fixture = buildFixture({ runs: records });

    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto()),
      ConflictException,
      RUN_CODE_UNAVAILABLE_MESSAGE,
    );
  });

  it('rejects an explicit code already used by a live run of the school', async () => {
    const fixture = buildFixture({ runs: [makeRunRecord({ code: 'R-01' })] });

    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto({ code: 'R-01' })),
      ConflictException,
      RUN_CODE_TAKEN_MESSAGE,
    );
    assert.equal(fixture.runs.createCalls.length, 0);
  });

  it('allows the same code in another school', async () => {
    const fixture = buildFixture({
      runs: [makeRunRecord({ school_id: SCHOOL_B, route_id: ROUTE_B, code: 'R-01' })],
    });

    const response = await fixture.service.create(SCHOOL_A, createDto({ code: 'R-01' }));

    assert.equal(response.code, 'R-01');
  });

  it('maps a database unique violation to 409', async () => {
    const fixture = buildFixture();
    (fixture.runs.repo as unknown as { create: () => Promise<never> }).create = async () => {
      throw new UniqueConstraintError({ errors: [{ path: 'code' } as never] });
    };

    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto({ code: 'R-01-X' })),
      ConflictException,
      RUN_CODE_TAKEN_MESSAGE,
    );
  });

  it('rejects related resources that are missing or belong to another school', async () => {
    const fixture = buildFixture({
      shifts: [{ id: SHIFT_AM, school_id: SCHOOL_B, is_active: true }],
      buses: [{ id: BUS_1, school_id: SCHOOL_B, is_active: true }],
    });

    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto({ route_id: ROUTE_B })),
      BadRequestException,
      RUN_ROUTE_INVALID_MESSAGE,
    );
    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto({ shift_id: SHIFT_AM })),
      BadRequestException,
      RUN_SHIFT_INVALID_MESSAGE,
    );
    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto({ bus_id: BUS_1 })),
      BadRequestException,
      RUN_BUS_INVALID_MESSAGE,
    );
    assert.equal(fixture.runs.createCalls.length, 0);
  });

  it('refuses an active run on inactive route/shift/bus but allows an inactive one', async () => {
    const fixture = buildFixture({
      buses: [{ id: BUS_1, school_id: SCHOOL_A, bus_number: 'B-7', is_active: false }],
    });

    await expectRejects(
      fixture.service.create(SCHOOL_A, createDto({ bus_id: BUS_1 })),
      BadRequestException,
      RUN_INACTIVE_RESOURCE_MESSAGE,
    );

    const inactive = await fixture.service.create(
      SCHOOL_A,
      createDto({ bus_id: BUS_1, is_active: false }),
    );
    assert.equal(inactive.is_active, false);
  });
});

describe('RunsService.createForRoute', () => {
  it('pins the route from the path and ignores any body route', async () => {
    const fixture = buildFixture();
    const dto = new CreateRouteRunDto();
    dto.code = 'R-01-PM';

    const response = await fixture.service.createForRoute(SCHOOL_A, ROUTE_A, dto);

    assert.equal(response.route_id, ROUTE_A);
    assert.equal(fixture.planLimits.calls.length, 1);
  });

  it('rejects a route of another school with a generic 400', async () => {
    const fixture = buildFixture();

    await expectRejects(
      fixture.service.createForRoute(SCHOOL_A, ROUTE_B, new CreateRouteRunDto()),
      BadRequestException,
      RUN_ROUTE_INVALID_MESSAGE,
    );
  });
});

describe('RunsService.provisionDefaultRun', () => {
  it('creates the back-compat twin without metering the runs quota', async () => {
    const fixture = buildFixture();
    const transaction = { id: 'tx' } as never;

    const run = await fixture.service.provisionDefaultRun(
      SCHOOL_A,
      { id: ROUTE_A, code: 'R-01', is_active: false },
      transaction,
    );

    assert.equal(fixture.planLimits.calls.length, 0);
    assert.deepEqual(fixture.runs.createCalls[0].values, {
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      shift_id: null,
      bus_id: null,
      code: 'R-01',
      is_default: true,
      is_active: false,
    });
    assert.equal(fixture.runs.createCalls[0].options.transaction, transaction);
    assert.equal(run.is_default, true);
  });

  it('refuses when a live run of the school already holds the route code', async () => {
    const fixture = buildFixture({
      runs: [makeRunRecord({ id: RUN_TIER, route_id: ROUTE_B, code: 'R-01', is_default: false })],
    });

    await expectRejects(
      fixture.service.provisionDefaultRun(SCHOOL_A, { id: ROUTE_A, code: 'R-01', is_active: true }),
      ConflictException,
      RUN_CODE_TAKEN_MESSAGE,
    );
    assert.equal(fixture.runs.createCalls.length, 0);
  });
});

describe('RunsService.removeForRoute', () => {
  it('soft deletes every live run of the route within the school', async () => {
    const fixture = buildFixture({
      runs: [
        makeRunRecord({ id: RUN_DEFAULT }),
        makeRunRecord({ id: RUN_TIER, code: 'R-01-2', is_default: false }),
        makeRunRecord({ id: 'other', school_id: SCHOOL_B, route_id: ROUTE_A, code: 'R-01' }),
      ],
    });

    const removed = await fixture.service.removeForRoute(SCHOOL_A, ROUTE_A);

    assert.equal(removed, 2);
    assert.deepEqual(fixture.runs.destroyCalls, [{ school_id: SCHOOL_A, route_id: ROUTE_A }]);
    assert.equal(fixture.runs.records.find((run) => run.id === 'other')?.deleted_at, null);
  });
});

describe('RunsService.findAll', () => {
  const records = () => [
    makeRunRecord({ id: RUN_DEFAULT, code: 'R-01' }),
    makeRunRecord({
      id: RUN_TIER,
      code: 'R-01-2',
      is_default: false,
      shift_id: SHIFT_AM,
      bus_id: BUS_1,
      is_active: false,
    }),
    makeRunRecord({ id: 'deleted', code: 'R-01-3', deleted_at: new Date() }),
    makeRunRecord({ id: 'foreign', school_id: SCHOOL_B, route_id: ROUTE_B, code: 'X-01' }),
  ];

  it('lists only the caller school with enrichment and pagination meta', async () => {
    const fixture = buildFixture({
      runs: records(),
      crew: [
        {
          id: 'crew-1',
          school_id: SCHOOL_A,
          run_id: RUN_TIER,
          user_id: DRIVER_1,
          role: RouteAssignmentRole.DRIVER,
          is_active: true,
          effective_from: '2026-01-01',
        },
      ],
      users: [
        {
          id: DRIVER_1,
          school_id: SCHOOL_A,
          first_name: 'Dana',
          last_name: 'Driver',
          is_active: true,
        },
      ],
      students: [
        { id: 's1', school_id: SCHOOL_A, run_id: RUN_TIER, is_active: true },
        { id: 's2', school_id: SCHOOL_A, run_id: RUN_TIER, is_active: true },
      ],
    });

    const result = await fixture.service.findAll(SCHOOL_A, listQuery({ page: 1, limit: 10 }));

    assert.deepEqual(
      result.items.map((item) => item.id),
      [RUN_DEFAULT, RUN_TIER],
    );
    const tier = result.items[1];
    assert.equal(tier.driver_name, 'Dana Driver');
    assert.equal(tier.conductor_name, null);
    assert.equal(tier.student_count, 2);
    assert.equal(tier.bus_registration_number, 'KA01AB1234');
    assert.deepEqual(result.meta, {
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('applies the route/shift/bus/is_active filters', async () => {
    const fixture = buildFixture({ runs: records() });

    const byShift = await fixture.service.findAll(SCHOOL_A, listQuery({ shift_id: SHIFT_AM }));
    assert.deepEqual(
      byShift.items.map((item) => item.id),
      [RUN_TIER],
    );

    const active = await fixture.service.findAll(SCHOOL_A, listQuery({ is_active: true }));
    assert.deepEqual(
      active.items.map((item) => item.id),
      [RUN_DEFAULT],
    );

    const byRoute = await fixture.service.findAll(SCHOOL_A, listQuery({ route_id: ROUTE_B }));
    assert.equal(byRoute.items.length, 0);
  });

  it('searches run code and route name/code case-insensitively', async () => {
    const fixture = buildFixture({ runs: records() });

    const byRunCode = await fixture.service.findAll(SCHOOL_A, listQuery({ search: '01-2' }));
    assert.deepEqual(
      byRunCode.items.map((item) => item.id),
      [RUN_TIER],
    );

    const byRouteName = await fixture.service.findAll(SCHOOL_A, listQuery({ search: 'north' }));
    assert.deepEqual(
      byRouteName.items.map((item) => item.id),
      [RUN_DEFAULT, RUN_TIER],
    );
  });
});

describe('RunsService nested lists', () => {
  it('findAllForRoute 404s for a route outside the school', async () => {
    const fixture = buildFixture({ runs: [makeRunRecord()] });

    const result = await fixture.service.findAllForRoute(SCHOOL_A, ROUTE_A, listQuery());
    assert.equal(result.items.length, 1);

    await expectRejects(
      fixture.service.findAllForRoute(SCHOOL_A, ROUTE_B, listQuery()),
      NotFoundException,
      ROUTE_NOT_FOUND_MESSAGE,
    );
  });

  it('findAllForBus 404s for a bus outside the school', async () => {
    const fixture = buildFixture({ runs: [makeRunRecord({ bus_id: BUS_1 })] });

    const result = await fixture.service.findAllForBus(SCHOOL_A, BUS_1, listQuery());
    assert.equal(result.items.length, 1);

    await expectRejects(
      fixture.service.findAllForBus(SCHOOL_B, BUS_1, listQuery()),
      NotFoundException,
      BUS_NOT_FOUND_MESSAGE,
    );
  });
});

describe('RunsService.findOne', () => {
  it('returns the run for the owning school and 404 otherwise', async () => {
    const fixture = buildFixture({ runs: [makeRunRecord()] });

    const response = await fixture.service.findOne(SCHOOL_A, RUN_DEFAULT);
    assert.equal(response.code, 'R-01');
    assert.equal(response.route_code, 'R-01');

    await expectRejects(
      fixture.service.findOne(SCHOOL_B, RUN_DEFAULT),
      NotFoundException,
      RUN_NOT_FOUND_MESSAGE,
    );
  });
});

describe('RunsService.update', () => {
  it('applies partial updates and re-validates against merged values', async () => {
    const record = makeRunRecord({ id: RUN_TIER, code: 'R-01-2', is_default: false });
    const fixture = buildFixture({ runs: [record] });

    const dto = new UpdateRunDto();
    dto.shift_id = SHIFT_AM;
    dto.code = ' R-01-AM ';
    const response = await fixture.service.update(SCHOOL_A, RUN_TIER, dto);

    assert.equal(response.shift_id, SHIFT_AM);
    assert.equal(response.code, 'R-01-AM');
    assert.equal(record.bus_id, null);
    assert.equal(response.updated_at, '2026-02-01T00:00:00.000Z');
  });

  it('can clear shift and bus with null', async () => {
    const record = makeRunRecord({
      id: RUN_TIER,
      shift_id: SHIFT_AM,
      bus_id: BUS_1,
      is_default: false,
    });
    const fixture = buildFixture({ runs: [record] });

    const dto = new UpdateRunDto();
    dto.shift_id = null;
    dto.bus_id = null;
    const response = await fixture.service.update(SCHOOL_A, RUN_TIER, dto);

    assert.equal(response.shift_id, null);
    assert.equal(response.bus_id, null);
  });

  it('rejects a code held by another live run but not its own', async () => {
    const fixture = buildFixture({
      runs: [
        makeRunRecord({ id: RUN_DEFAULT, code: 'R-01' }),
        makeRunRecord({ id: RUN_TIER, code: 'R-01-2', is_default: false }),
      ],
    });

    const clash = new UpdateRunDto();
    clash.code = 'R-01';
    await expectRejects(
      fixture.service.update(SCHOOL_A, RUN_TIER, clash),
      ConflictException,
      RUN_CODE_TAKEN_MESSAGE,
    );

    const same = new UpdateRunDto();
    same.code = 'R-01-2';
    const response = await fixture.service.update(SCHOOL_A, RUN_TIER, same);
    assert.equal(response.code, 'R-01-2');
  });

  it('refuses re-activating a run whose bus is inactive', async () => {
    const fixture = buildFixture({
      runs: [makeRunRecord({ id: RUN_TIER, bus_id: BUS_1, is_active: false, is_default: false })],
      buses: [{ id: BUS_1, school_id: SCHOOL_A, is_active: false }],
    });

    const dto = new UpdateRunDto();
    dto.is_active = true;
    await expectRejects(
      fixture.service.update(SCHOOL_A, RUN_TIER, dto),
      BadRequestException,
      RUN_INACTIVE_RESOURCE_MESSAGE,
    );
  });

  it('cannot update a run of another school', async () => {
    const fixture = buildFixture({ runs: [makeRunRecord()] });
    const dto = new UpdateRunDto();
    dto.code = 'HIJACK';

    await expectRejects(
      fixture.service.update(SCHOOL_B, RUN_DEFAULT, dto),
      NotFoundException,
      RUN_NOT_FOUND_MESSAGE,
    );
  });
});

describe('RunsService.remove', () => {
  it('soft deletes a hand-made run', async () => {
    const record = makeRunRecord({ id: RUN_TIER, code: 'R-01-2', is_default: false });
    const fixture = buildFixture({ runs: [record] });

    const response = await fixture.service.remove(SCHOOL_A, RUN_TIER);

    assert.deepEqual(response, { id: RUN_TIER, message: RUN_DELETED_MESSAGE });
    assert.ok(record.deleted_at instanceof Date);
  });

  it('refuses to delete the default run of a route', async () => {
    const record = makeRunRecord();
    const fixture = buildFixture({ runs: [record] });

    await expectRejects(
      fixture.service.remove(SCHOOL_A, RUN_DEFAULT),
      ConflictException,
      RUN_DEFAULT_UNDELETABLE_MESSAGE,
    );
    assert.equal(record.deleted_at, null);
  });

  it('returns 404 for another school', async () => {
    const record = makeRunRecord({ id: RUN_TIER, is_default: false });
    const fixture = buildFixture({ runs: [record] });

    await expectRejects(
      fixture.service.remove(SCHOOL_B, RUN_TIER),
      NotFoundException,
      RUN_NOT_FOUND_MESSAGE,
    );
    assert.equal(record.deleted_at, null);
  });
});
