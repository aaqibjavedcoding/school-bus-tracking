import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import { RunCrewRole, UserRole } from '@school-bus-tracking/shared-types';
import { Route, Run, RunCrew, User } from '../../database/models';
import { RunCrewService } from './run-crew.service';
import {
  RUN_CREW_DATE_INVALID_MESSAGE,
  RUN_CREW_DATE_RANGE_MESSAGE,
  RUN_CREW_DELETED_MESSAGE,
  RUN_CREW_DUPLICATE_MESSAGE,
  RUN_CREW_INACTIVE_RESOURCE_MESSAGE,
  RUN_CREW_NOT_FOUND_MESSAGE,
  RUN_CREW_ROLE_CONFLICT_MESSAGE,
  RUN_CREW_ROLE_INVALID_MESSAGE,
  RUN_CREW_ROLE_MISMATCH_MESSAGE,
  RUN_CREW_USER_INVALID_MESSAGE,
} from './run-crew.constants';
import { RUN_NOT_FOUND_MESSAGE } from '../runs/runs.constants';
import { CreateRunCrewDto } from './dto/create-run-crew.dto';
import { ListRunCrewQueryDto } from './dto/list-run-crew-query.dto';
import { UpdateRunCrewDto } from './dto/update-run-crew.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const RUN_A = '22222222-2222-4222-8222-222222222222';
const RUN_B = '33333333-3333-4333-8333-333333333333';
const DRIVER_1 = '44444444-4444-4444-8444-444444444444';
const DRIVER_2 = '55555555-5555-4555-8555-555555555555';
const CONDUCTOR_1 = '66666666-6666-4666-8666-666666666666';
const PARENT_1 = '77777777-7777-4777-8777-777777777777';
const CREW_1 = '88888888-8888-4888-8888-888888888888';
const CREW_2 = '99999999-9999-4999-8999-999999999999';

type WhereClause = Record<string | symbol, unknown>;

interface StubCrewRecord {
  id: string;
  school_id: string;
  run_id: string;
  user_id: string;
  role: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Partial<StubCrewRecord>) => Promise<StubCrewRecord>;
  destroy: () => Promise<void>;
}

interface SimpleRecord {
  id: string;
  school_id: string;
  is_active: boolean;
  deleted_at?: Date | null;
  [key: string]: unknown;
}

function makeCrewRecord(overrides: Partial<StubCrewRecord> = {}): StubCrewRecord {
  const record: StubCrewRecord = {
    id: CREW_1,
    school_id: SCHOOL_A,
    run_id: RUN_A,
    user_id: DRIVER_1,
    role: RunCrewRole.DRIVER,
    effective_from: '2026-01-01',
    effective_to: null,
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

function matchesWhere(candidate: object, where: WhereClause): boolean {
  const record = candidate as Record<string, unknown>;
  if (record.deleted_at) return false;
  for (const key of Object.keys(where)) {
    const expected = where[key];
    const actual = record[key];
    if (expected !== null && typeof expected === 'object') {
      const op = expected as Record<symbol, unknown>;
      if (Op.in in op && !(op[Op.in] as unknown[]).includes(actual)) return false;
      if (Op.ne in op && actual === op[Op.ne]) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

interface CrewRepoHarness {
  repo: typeof RunCrew;
  records: StubCrewRecord[];
  createCalls: Array<Record<string, unknown>>;
}

function makeCrewRepo(records: StubCrewRecord[]): CrewRepoHarness {
  const createCalls: Array<Record<string, unknown>> = [];
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
    create: async (values: Record<string, unknown>) => {
      createCalls.push(values);
      counter += 1;
      const record = makeCrewRecord({
        id: `cccccccc-cccc-4ccc-8ccc-${String(counter).padStart(12, '0')}`,
        ...(values as Partial<StubCrewRecord>),
      });
      records.push(record);
      return record;
    },
  } as unknown as typeof RunCrew;
  return { repo, records, createCalls };
}

function simpleRepo<T>(records: SimpleRecord[]): T {
  return {
    findOne: async ({ where }: { where: WhereClause }) =>
      records.find((record) => matchesWhere(record, where)) ?? null,
    findAll: async ({ where }: { where: WhereClause }) =>
      records.filter((record) => matchesWhere(record, where)),
  } as unknown as T;
}

interface Fixture {
  crew: CrewRepoHarness;
  service: RunCrewService;
}

function buildFixture(
  options: {
    crew?: StubCrewRecord[];
    runs?: SimpleRecord[];
    users?: SimpleRecord[];
  } = {},
): Fixture {
  const crew = makeCrewRepo(options.crew ?? []);
  const runs = options.runs ?? [
    { id: RUN_A, school_id: SCHOOL_A, route_id: ROUTE_A, code: 'R-01', is_active: true },
    { id: RUN_B, school_id: SCHOOL_B, route_id: ROUTE_A, code: 'X-01', is_active: true },
  ];
  const users = options.users ?? [
    {
      id: DRIVER_1,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
      first_name: 'Dana',
      last_name: 'Driver',
      email: 'dana@example.com',
      is_active: true,
    },
    {
      id: DRIVER_2,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
      first_name: 'Drew',
      last_name: 'Second',
      email: null,
      is_active: true,
    },
    {
      id: CONDUCTOR_1,
      school_id: SCHOOL_A,
      role: UserRole.CONDUCTOR,
      first_name: 'Cory',
      last_name: 'Conductor',
      email: null,
      is_active: true,
    },
    {
      id: PARENT_1,
      school_id: SCHOOL_A,
      role: UserRole.PARENT,
      first_name: 'Pat',
      last_name: 'Parent',
      email: null,
      is_active: true,
    },
  ];
  const routes: SimpleRecord[] = [
    { id: ROUTE_A, school_id: SCHOOL_A, name: 'North Loop', code: 'R-01', is_active: true },
  ];
  const service = new RunCrewService(
    crew.repo,
    simpleRepo<typeof Run>(runs),
    simpleRepo<typeof Route>(routes),
    simpleRepo<typeof User>(users),
  );
  return { crew, service };
}

function createDto(overrides: Partial<CreateRunCrewDto> = {}): CreateRunCrewDto {
  const dto = new CreateRunCrewDto();
  dto.user_id = DRIVER_1;
  dto.role = RunCrewRole.DRIVER;
  dto.effective_from = '2026-03-01';
  Object.assign(dto, overrides);
  return dto;
}

function listQuery(overrides: Partial<ListRunCrewQueryDto> = {}): ListRunCrewQueryDto {
  const query = new ListRunCrewQueryDto();
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

describe('RunCrewService.create', () => {
  it('rosters a driver onto a run of the caller school', async () => {
    const fixture = buildFixture();

    const response = await fixture.service.create(
      SCHOOL_A,
      RUN_A,
      createDto({ effective_to: '2026-06-30' }),
    );

    assert.deepEqual(fixture.crew.createCalls[0], {
      school_id: SCHOOL_A,
      run_id: RUN_A,
      user_id: DRIVER_1,
      role: RunCrewRole.DRIVER,
      effective_from: '2026-03-01',
      effective_to: '2026-06-30',
      is_active: true,
    });
    assert.equal(response.run_code, 'R-01');
    assert.equal(response.route_name, 'North Loop');
    assert.equal(response.user_name, 'Dana Driver');
    assert.equal(response.user_email, 'dana@example.com');
    assert.equal(response.effective_to, '2026-06-30');
  });

  it('404s when the run belongs to another school', async () => {
    const fixture = buildFixture();

    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_B, createDto()),
      NotFoundException,
      RUN_NOT_FOUND_MESSAGE,
    );
    assert.equal(fixture.crew.createCalls.length, 0);
  });

  it('rejects a user from another school or an unknown user with a generic 400', async () => {
    const fixture = buildFixture({
      users: [{ id: DRIVER_1, school_id: SCHOOL_B, role: UserRole.DRIVER, is_active: true }],
    });

    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_A, createDto()),
      BadRequestException,
      RUN_CREW_USER_INVALID_MESSAGE,
    );
  });

  it('rejects a user whose staff role does not match the requested role', async () => {
    const fixture = buildFixture();

    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_A, createDto({ user_id: CONDUCTOR_1 })),
      BadRequestException,
      RUN_CREW_ROLE_MISMATCH_MESSAGE,
    );
    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_A, createDto({ user_id: PARENT_1 })),
      BadRequestException,
      RUN_CREW_ROLE_MISMATCH_MESSAGE,
    );
  });

  it('rejects a role outside DRIVER/CONDUCTOR before touching the database', async () => {
    const fixture = buildFixture();

    await expectRejects(
      fixture.service.create(
        SCHOOL_A,
        RUN_A,
        createDto({ role: UserRole.SCHOOL_ADMIN as unknown as RunCrewRole }),
      ),
      BadRequestException,
      RUN_CREW_ROLE_INVALID_MESSAGE,
    );
  });

  it('validates the calendar dates and the range', async () => {
    const fixture = buildFixture();

    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_A, createDto({ effective_from: '2026-02-30' })),
      BadRequestException,
      RUN_CREW_DATE_INVALID_MESSAGE,
    );
    await expectRejects(
      fixture.service.create(
        SCHOOL_A,
        RUN_A,
        createDto({ effective_from: '2026-03-01', effective_to: '2026-02-28' }),
      ),
      BadRequestException,
      RUN_CREW_DATE_RANGE_MESSAGE,
    );
  });

  it('refuses an active roster row on an inactive run or user', async () => {
    const fixture = buildFixture({
      runs: [{ id: RUN_A, school_id: SCHOOL_A, route_id: ROUTE_A, code: 'R-01', is_active: false }],
    });

    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_A, createDto()),
      BadRequestException,
      RUN_CREW_INACTIVE_RESOURCE_MESSAGE,
    );

    const inactive = await fixture.service.create(SCHOOL_A, RUN_A, createDto({ is_active: false }));
    assert.equal(inactive.is_active, false);
  });

  it('enforces one active person per role per run for overlapping periods', async () => {
    const fixture = buildFixture({
      crew: [
        makeCrewRecord({
          id: CREW_1,
          user_id: DRIVER_1,
          effective_from: '2026-01-01',
          effective_to: '2026-06-30',
        }),
      ],
    });

    await expectRejects(
      fixture.service.create(
        SCHOOL_A,
        RUN_A,
        createDto({ user_id: DRIVER_2, effective_from: '2026-03-01' }),
      ),
      ConflictException,
      RUN_CREW_ROLE_CONFLICT_MESSAGE,
    );

    // A conductor on the same run and a driver taking over afterwards are fine.
    const conductor = await fixture.service.create(
      SCHOOL_A,
      RUN_A,
      createDto({ user_id: CONDUCTOR_1, role: RunCrewRole.CONDUCTOR }),
    );
    assert.equal(conductor.role, RunCrewRole.CONDUCTOR);

    const successor = await fixture.service.create(
      SCHOOL_A,
      RUN_A,
      createDto({ user_id: DRIVER_2, effective_from: '2026-07-01' }),
    );
    assert.equal(successor.user_id, DRIVER_2);
  });

  it('ignores inactive rows when checking the role rule', async () => {
    const fixture = buildFixture({
      crew: [makeCrewRecord({ id: CREW_1, user_id: DRIVER_1, is_active: false })],
    });

    const response = await fixture.service.create(
      SCHOOL_A,
      RUN_A,
      createDto({ user_id: DRIVER_2 }),
    );

    assert.equal(response.user_id, DRIVER_2);
  });

  it('maps a database unique violation to 409', async () => {
    const fixture = buildFixture();
    (fixture.crew.repo as unknown as { create: () => Promise<never> }).create = async () => {
      throw new UniqueConstraintError({ errors: [{ path: 'run_id' } as never] });
    };

    await expectRejects(
      fixture.service.create(SCHOOL_A, RUN_A, createDto()),
      ConflictException,
      RUN_CREW_DUPLICATE_MESSAGE,
    );
  });
});

describe('RunCrewService lists', () => {
  const records = () => [
    makeCrewRecord({ id: CREW_1, user_id: DRIVER_1, role: RunCrewRole.DRIVER }),
    makeCrewRecord({
      id: CREW_2,
      user_id: CONDUCTOR_1,
      role: RunCrewRole.CONDUCTOR,
      is_active: false,
    }),
    makeCrewRecord({ id: 'deleted', user_id: DRIVER_2, deleted_at: new Date() }),
    makeCrewRecord({ id: 'foreign', school_id: SCHOOL_B, run_id: RUN_B }),
  ];

  it('findAllForRun returns the tenant roster with filters and meta', async () => {
    const fixture = buildFixture({ crew: records() });

    const all = await fixture.service.findAllForRun(SCHOOL_A, RUN_A, listQuery());
    assert.deepEqual(
      all.items.map((item) => item.id),
      [CREW_1, CREW_2],
    );
    assert.equal(all.items[1].user_name, 'Cory Conductor');
    assert.deepEqual(all.meta, {
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });

    const drivers = await fixture.service.findAllForRun(
      SCHOOL_A,
      RUN_A,
      listQuery({ role: RunCrewRole.DRIVER }),
    );
    assert.deepEqual(
      drivers.items.map((item) => item.id),
      [CREW_1],
    );

    const active = await fixture.service.findAllForRun(
      SCHOOL_A,
      RUN_A,
      listQuery({ is_active: true }),
    );
    assert.deepEqual(
      active.items.map((item) => item.id),
      [CREW_1],
    );
  });

  it('findAllForRun 404s for a run outside the school', async () => {
    const fixture = buildFixture({ crew: records() });

    await expectRejects(
      fixture.service.findAllForRun(SCHOOL_A, RUN_B, listQuery()),
      NotFoundException,
      RUN_NOT_FOUND_MESSAGE,
    );
  });

  it('findAllForUser returns the staff roster and 404s for non-staff or foreign users', async () => {
    const fixture = buildFixture({ crew: records() });

    const result = await fixture.service.findAllForUser(SCHOOL_A, DRIVER_1, listQuery());
    assert.deepEqual(
      result.items.map((item) => item.id),
      [CREW_1],
    );

    await expectRejects(
      fixture.service.findAllForUser(SCHOOL_A, PARENT_1, listQuery()),
      NotFoundException,
      RUN_CREW_USER_INVALID_MESSAGE,
    );
    await expectRejects(
      fixture.service.findAllForUser(SCHOOL_B, DRIVER_1, listQuery()),
      NotFoundException,
      RUN_CREW_USER_INVALID_MESSAGE,
    );
  });
});

describe('RunCrewService.findOne', () => {
  it('returns the row for the owning school and 404 otherwise', async () => {
    const fixture = buildFixture({ crew: [makeCrewRecord()] });

    const response = await fixture.service.findOne(SCHOOL_A, CREW_1);
    assert.equal(response.role, RunCrewRole.DRIVER);
    assert.equal(response.effective_from, '2026-01-01');
    assert.equal(response.effective_to, null);

    await expectRejects(
      fixture.service.findOne(SCHOOL_B, CREW_1),
      NotFoundException,
      RUN_CREW_NOT_FOUND_MESSAGE,
    );
  });
});

describe('RunCrewService.update', () => {
  it('applies partial updates and re-validates the merged user/role pair', async () => {
    const record = makeCrewRecord();
    const fixture = buildFixture({ crew: [record] });

    const dto = new UpdateRunCrewDto();
    dto.effective_to = '2026-12-31';
    const response = await fixture.service.update(SCHOOL_A, CREW_1, dto);
    assert.equal(response.effective_to, '2026-12-31');
    assert.equal(response.updated_at, '2026-02-01T00:00:00.000Z');

    const swap = new UpdateRunCrewDto();
    swap.user_id = CONDUCTOR_1;
    await expectRejects(
      fixture.service.update(SCHOOL_A, CREW_1, swap),
      BadRequestException,
      RUN_CREW_ROLE_MISMATCH_MESSAGE,
    );

    swap.role = RunCrewRole.CONDUCTOR;
    const swapped = await fixture.service.update(SCHOOL_A, CREW_1, swap);
    assert.equal(swapped.role, RunCrewRole.CONDUCTOR);
    assert.equal(swapped.user_name, 'Cory Conductor');
  });

  it('checks the role rule against other rows but not itself', async () => {
    const fixture = buildFixture({
      crew: [
        makeCrewRecord({
          id: CREW_1,
          user_id: DRIVER_1,
          effective_from: '2026-01-01',
          effective_to: '2026-06-30',
        }),
        makeCrewRecord({
          id: CREW_2,
          user_id: DRIVER_2,
          effective_from: '2026-07-01',
          effective_to: null,
        }),
      ],
    });

    const extend = new UpdateRunCrewDto();
    extend.effective_to = '2026-07-15';
    await expectRejects(
      fixture.service.update(SCHOOL_A, CREW_1, extend),
      ConflictException,
      RUN_CREW_ROLE_CONFLICT_MESSAGE,
    );

    const shorten = new UpdateRunCrewDto();
    shorten.effective_to = '2026-05-31';
    const response = await fixture.service.update(SCHOOL_A, CREW_1, shorten);
    assert.equal(response.effective_to, '2026-05-31');
  });

  it('rejects an inverted range and cannot touch another school', async () => {
    const fixture = buildFixture({ crew: [makeCrewRecord({ effective_from: '2026-03-01' })] });

    const inverted = new UpdateRunCrewDto();
    inverted.effective_to = '2026-02-01';
    await expectRejects(
      fixture.service.update(SCHOOL_A, CREW_1, inverted),
      BadRequestException,
      RUN_CREW_DATE_RANGE_MESSAGE,
    );

    const dto = new UpdateRunCrewDto();
    dto.is_active = false;
    await expectRejects(
      fixture.service.update(SCHOOL_B, CREW_1, dto),
      NotFoundException,
      RUN_CREW_NOT_FOUND_MESSAGE,
    );
  });
});

describe('RunCrewService.remove', () => {
  it('soft deletes a roster row of the caller school', async () => {
    const record = makeCrewRecord();
    const fixture = buildFixture({ crew: [record] });

    const response = await fixture.service.remove(SCHOOL_A, CREW_1);

    assert.deepEqual(response, { id: CREW_1, message: RUN_CREW_DELETED_MESSAGE });
    assert.ok(record.deleted_at instanceof Date);
  });

  it('returns 404 for another school', async () => {
    const record = makeCrewRecord();
    const fixture = buildFixture({ crew: [record] });

    await expectRejects(
      fixture.service.remove(SCHOOL_B, CREW_1),
      NotFoundException,
      RUN_CREW_NOT_FOUND_MESSAGE,
    );
    assert.equal(record.deleted_at, null);
  });
});
