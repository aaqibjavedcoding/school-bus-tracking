import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import { Run, Shift } from '../../database/models';
import { normalizeTime, ShiftsService } from './shifts.service';
import {
  SHIFT_DELETED_MESSAGE,
  SHIFT_HAS_RUNS_MESSAGE,
  SHIFT_NAME_TAKEN_MESSAGE,
  SHIFT_NOT_FOUND_MESSAGE,
  SHIFT_WINDOW_INVALID_MESSAGE,
} from './shifts.constants';
import { CreateShiftDto } from './dto/create-shift.dto';
import { ListShiftsQueryDto } from './dto/list-shifts-query.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHIFT_A = '11111111-1111-4111-8111-111111111111';
const SHIFT_B = '22222222-2222-4222-8222-222222222222';

interface StubShiftRecord {
  id: string;
  school_id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Partial<StubShiftRecord>) => Promise<StubShiftRecord>;
  destroy: () => Promise<void>;
}

interface StubRunRecord {
  id: string;
  school_id: string;
  shift_id: string | null;
  deleted_at: Date | null;
}

interface WhereClause {
  id?: string | { [Op.ne]: string } | { [Op.in]: string[] };
  school_id?: string;
  shift_id?: string | { [Op.in]: string[] };
  name?: string | { [Op.iLike]: string };
  is_active?: boolean;
}

interface StubShiftRepo {
  repo: typeof Shift;
  records: StubShiftRecord[];
  createCalls: Array<Record<string, unknown>>;
}

function makeShiftRecord(overrides: Partial<StubShiftRecord> = {}): StubShiftRecord {
  const record: StubShiftRecord = {
    id: SHIFT_A,
    school_id: SCHOOL_A,
    name: 'Morning',
    start_time: '06:30:00',
    end_time: '09:00:00',
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

function matches(record: StubShiftRecord, where: WhereClause): boolean {
  if (record.deleted_at) return false;
  if (where.school_id !== undefined && record.school_id !== where.school_id) return false;
  if (where.is_active !== undefined && record.is_active !== where.is_active) return false;
  if (typeof where.id === 'string' && record.id !== where.id) return false;
  if (where.id && typeof where.id === 'object' && Op.ne in where.id) {
    if (record.id === (where.id as { [Op.ne]: string })[Op.ne]) return false;
  }
  if (typeof where.name === 'string' && record.name !== where.name) return false;
  if (where.name && typeof where.name === 'object') {
    const pattern = (where.name as { [Op.iLike]: string })[Op.iLike]
      .replace(/^%|%$/g, '')
      .toLowerCase();
    if (!record.name.toLowerCase().includes(pattern)) return false;
  }
  return true;
}

function makeShiftRepo(records: StubShiftRecord[]): StubShiftRepo {
  const createCalls: Array<Record<string, unknown>> = [];
  let counter = 0;
  const repo = {
    findOne: async ({ where }: { where: WhereClause }) =>
      records.find((record) => matches(record, where)) ?? null,
    findAndCountAll: async ({
      where,
      limit,
      offset,
    }: {
      where: WhereClause;
      limit: number;
      offset: number;
    }) => {
      const filtered = records.filter((record) => matches(record, where));
      return { rows: filtered.slice(offset, offset + limit), count: filtered.length };
    },
    create: async (values: Record<string, unknown>) => {
      createCalls.push(values);
      counter += 1;
      const record = makeShiftRecord({
        id: `99999999-9999-4999-8999-${String(counter).padStart(12, '0')}`,
        ...(values as Partial<StubShiftRecord>),
      });
      records.push(record);
      return record;
    },
  } as unknown as typeof Shift;
  return { repo, records, createCalls };
}

function makeRunRepo(runs: StubRunRecord[]): typeof Run {
  const live = (where: WhereClause) =>
    runs.filter((run) => {
      if (run.deleted_at) return false;
      if (where.school_id !== undefined && run.school_id !== where.school_id) return false;
      if (typeof where.shift_id === 'string' && run.shift_id !== where.shift_id) return false;
      if (where.shift_id && typeof where.shift_id === 'object') {
        const ids = (where.shift_id as { [Op.in]: string[] })[Op.in];
        if (!run.shift_id || !ids.includes(run.shift_id)) return false;
      }
      return true;
    });
  return {
    count: async ({ where }: { where: WhereClause }) => live(where).length,
    findAll: async ({ where }: { where: WhereClause }) => live(where),
  } as unknown as typeof Run;
}

function makeService(shifts: StubShiftRepo, runs: StubRunRecord[] = []): ShiftsService {
  return new ShiftsService(shifts.repo, makeRunRepo(runs));
}

function createDto(overrides: Partial<CreateShiftDto> = {}): CreateShiftDto {
  const dto = new CreateShiftDto();
  dto.name = 'Afternoon';
  dto.start_time = '13:00';
  dto.end_time = '16:30';
  Object.assign(dto, overrides);
  return dto;
}

function listQuery(overrides: Partial<ListShiftsQueryDto> = {}): ListShiftsQueryDto {
  const query = new ListShiftsQueryDto();
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

describe('normalizeTime', () => {
  it('appends seconds to HH:MM and leaves HH:MM:SS alone', () => {
    assert.equal(normalizeTime('07:05'), '07:05:00');
    assert.equal(normalizeTime('07:05:30'), '07:05:30');
    assert.equal(normalizeTime(' 07:05 '), '07:05:00');
  });
});

describe('ShiftsService.create', () => {
  it('creates a shift pinned to the caller school with normalised times', async () => {
    const shifts = makeShiftRepo([]);
    const service = makeService(shifts);

    const response = await service.create(SCHOOL_A, createDto({ name: '  Afternoon  ' }));

    assert.equal(shifts.createCalls.length, 1);
    assert.deepEqual(shifts.createCalls[0], {
      school_id: SCHOOL_A,
      name: 'Afternoon',
      start_time: '13:00:00',
      end_time: '16:30:00',
      is_active: true,
    });
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.start_time, '13:00:00');
    assert.equal(response.end_time, '16:30:00');
    assert.equal(response.run_count, 0);
    assert.equal(response.created_at, '2026-01-01T00:00:00.000Z');
  });

  it('rejects a window that does not end after it starts', async () => {
    const service = makeService(makeShiftRepo([]));

    await expectRejects(
      service.create(SCHOOL_A, createDto({ start_time: '13:00', end_time: '13:00' })),
      BadRequestException,
      SHIFT_WINDOW_INVALID_MESSAGE,
    );
    await expectRejects(
      service.create(SCHOOL_A, createDto({ start_time: '13:00', end_time: '12:59:59' })),
      BadRequestException,
      SHIFT_WINDOW_INVALID_MESSAGE,
    );
  });

  it('rejects a name already used by a live shift of the same school', async () => {
    const shifts = makeShiftRepo([makeShiftRecord({ name: 'Afternoon' })]);
    const service = makeService(shifts);

    await expectRejects(
      service.create(SCHOOL_A, createDto()),
      ConflictException,
      SHIFT_NAME_TAKEN_MESSAGE,
    );
    assert.equal(shifts.createCalls.length, 0);
  });

  it('allows the same name in another school and after a soft delete', async () => {
    const shifts = makeShiftRepo([
      makeShiftRecord({ id: SHIFT_A, school_id: SCHOOL_B, name: 'Afternoon' }),
      makeShiftRecord({ id: SHIFT_B, name: 'Afternoon', deleted_at: new Date() }),
    ]);
    const service = makeService(shifts);

    const response = await service.create(SCHOOL_A, createDto());

    assert.equal(response.name, 'Afternoon');
    assert.equal(shifts.createCalls.length, 1);
  });

  it('maps a database unique violation to 409', async () => {
    const shifts = makeShiftRepo([]);
    (shifts.repo as unknown as { create: () => Promise<never> }).create = async () => {
      throw new UniqueConstraintError({ errors: [{ path: 'name' } as never] });
    };
    const service = makeService(shifts);

    await expectRejects(
      service.create(SCHOOL_A, createDto()),
      ConflictException,
      SHIFT_NAME_TAKEN_MESSAGE,
    );
  });
});

describe('ShiftsService.findAll', () => {
  it('lists only the caller school, ordered with pagination meta and run counts', async () => {
    const shifts = makeShiftRepo([
      makeShiftRecord({ id: SHIFT_A, name: 'Morning' }),
      makeShiftRecord({
        id: SHIFT_B,
        name: 'Afternoon',
        start_time: '13:00:00',
        end_time: '16:00:00',
      }),
      makeShiftRecord({ id: '33333333-3333-4333-8333-333333333333', school_id: SCHOOL_B }),
    ]);
    const runs: StubRunRecord[] = [
      { id: 'r1', school_id: SCHOOL_A, shift_id: SHIFT_A, deleted_at: null },
      { id: 'r2', school_id: SCHOOL_A, shift_id: SHIFT_A, deleted_at: null },
      { id: 'r3', school_id: SCHOOL_A, shift_id: SHIFT_A, deleted_at: new Date() },
      { id: 'r4', school_id: SCHOOL_B, shift_id: SHIFT_A, deleted_at: null },
    ];
    const service = makeService(shifts, runs);

    const result = await service.findAll(SCHOOL_A, listQuery({ page: 1, limit: 10 }));

    assert.equal(result.items.length, 2);
    assert.ok(result.items.every((item) => item.school_id === SCHOOL_A));
    assert.equal(result.items.find((item) => item.id === SHIFT_A)?.run_count, 2);
    assert.equal(result.items.find((item) => item.id === SHIFT_B)?.run_count, 0);
    assert.deepEqual(result.meta, {
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('applies the is_active filter and case-insensitive search', async () => {
    const shifts = makeShiftRepo([
      makeShiftRecord({ id: SHIFT_A, name: 'Morning' }),
      makeShiftRecord({ id: SHIFT_B, name: 'Afternoon', is_active: false }),
    ]);
    const service = makeService(shifts);

    const active = await service.findAll(SCHOOL_A, listQuery({ is_active: true }));
    assert.deepEqual(
      active.items.map((item) => item.id),
      [SHIFT_A],
    );

    const searched = await service.findAll(SCHOOL_A, listQuery({ search: 'AFTER' }));
    assert.deepEqual(
      searched.items.map((item) => item.id),
      [SHIFT_B],
    );
  });
});

describe('ShiftsService.findOne', () => {
  it('returns the shift when id and school match', async () => {
    const service = makeService(makeShiftRepo([makeShiftRecord()]));

    const response = await service.findOne(SCHOOL_A, SHIFT_A);

    assert.equal(response.id, SHIFT_A);
    assert.equal(response.name, 'Morning');
  });

  it('returns the generic 404 for another school or a deleted shift', async () => {
    const service = makeService(
      makeShiftRepo([
        makeShiftRecord({ id: SHIFT_A }),
        makeShiftRecord({ id: SHIFT_B, deleted_at: new Date() }),
      ]),
    );

    await expectRejects(
      service.findOne(SCHOOL_B, SHIFT_A),
      NotFoundException,
      SHIFT_NOT_FOUND_MESSAGE,
    );
    await expectRejects(
      service.findOne(SCHOOL_A, SHIFT_B),
      NotFoundException,
      SHIFT_NOT_FOUND_MESSAGE,
    );
  });
});

describe('ShiftsService.update', () => {
  it('applies partial updates and re-validates the window against stored values', async () => {
    const record = makeShiftRecord();
    const service = makeService(makeShiftRepo([record]));

    const dto = new UpdateShiftDto();
    dto.end_time = '10:15';
    const response = await service.update(SCHOOL_A, SHIFT_A, dto);

    assert.equal(response.start_time, '06:30:00');
    assert.equal(response.end_time, '10:15:00');
    assert.equal(record.end_time, '10:15:00');
    assert.equal(response.updated_at, '2026-02-01T00:00:00.000Z');

    const bad = new UpdateShiftDto();
    bad.start_time = '11:00';
    await expectRejects(
      service.update(SCHOOL_A, SHIFT_A, bad),
      BadRequestException,
      SHIFT_WINDOW_INVALID_MESSAGE,
    );
  });

  it('rejects renaming onto another live shift of the school but not onto itself', async () => {
    const service = makeService(
      makeShiftRepo([
        makeShiftRecord({ id: SHIFT_A, name: 'Morning' }),
        makeShiftRecord({ id: SHIFT_B, name: 'Afternoon' }),
      ]),
    );

    const clash = new UpdateShiftDto();
    clash.name = 'Afternoon';
    await expectRejects(
      service.update(SCHOOL_A, SHIFT_A, clash),
      ConflictException,
      SHIFT_NAME_TAKEN_MESSAGE,
    );

    const same = new UpdateShiftDto();
    same.name = 'Morning';
    same.is_active = false;
    const response = await service.update(SCHOOL_A, SHIFT_A, same);
    assert.equal(response.is_active, false);
  });

  it('cannot update a shift of another school', async () => {
    const service = makeService(makeShiftRepo([makeShiftRecord()]));
    const dto = new UpdateShiftDto();
    dto.name = 'Hijacked';

    await expectRejects(
      service.update(SCHOOL_B, SHIFT_A, dto),
      NotFoundException,
      SHIFT_NOT_FOUND_MESSAGE,
    );
  });
});

describe('ShiftsService.remove', () => {
  it('soft deletes a shift with no live runs', async () => {
    const record = makeShiftRecord();
    const runs: StubRunRecord[] = [
      { id: 'r1', school_id: SCHOOL_A, shift_id: SHIFT_A, deleted_at: new Date() },
    ];
    const service = makeService(makeShiftRepo([record]), runs);

    const response = await service.remove(SCHOOL_A, SHIFT_A);

    assert.deepEqual(response, { id: SHIFT_A, message: SHIFT_DELETED_MESSAGE });
    assert.ok(record.deleted_at instanceof Date);
  });

  it('refuses with 409 while a live run references the shift', async () => {
    const record = makeShiftRecord();
    const runs: StubRunRecord[] = [
      { id: 'r1', school_id: SCHOOL_A, shift_id: SHIFT_A, deleted_at: null },
    ];
    const service = makeService(makeShiftRepo([record]), runs);

    await expectRejects(
      service.remove(SCHOOL_A, SHIFT_A),
      ConflictException,
      SHIFT_HAS_RUNS_MESSAGE,
    );
    assert.equal(record.deleted_at, null);
  });

  it('returns 404 for a shift of another school', async () => {
    const record = makeShiftRecord();
    const service = makeService(makeShiftRepo([record]));

    await expectRejects(
      service.remove(SCHOOL_B, SHIFT_A),
      NotFoundException,
      SHIFT_NOT_FOUND_MESSAGE,
    );
    assert.equal(record.deleted_at, null);
  });
});
