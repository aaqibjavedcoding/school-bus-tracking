import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import { RouteAssignmentRole, TripStatus } from '@school-bus-tracking/shared-types';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { PlanLimitsService } from '../../common/plan-limits';
import { BusesService } from './buses.service';
import {
  BUS_DELETED_MESSAGE,
  BUS_NOT_FOUND_MESSAGE,
  BUS_NUMBER_TAKEN_MESSAGE,
  BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE,
} from './buses.constants';
import { CreateBusDto } from './dto/create-bus.dto';
import { ListBusesQueryDto } from './dto/list-buses-query.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface StubBusRecord {
  id: string;
  school_id: string;
  registration_number: string;
  bus_number: string | null;
  capacity: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Partial<StubBusRecord>) => Promise<StubBusRecord>;
  destroy: () => Promise<void>;
}

let nextId = 1;

function makeBusRecord(overrides: Partial<StubBusRecord> = {}): StubBusRecord {
  const record: StubBusRecord = {
    id: `bus-${nextId}`,
    school_id: SCHOOL_A,
    registration_number: `REG-${nextId}`,
    bus_number: null,
    capacity: 48,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(record, values, { updated_at: new Date('2026-02-01T00:00:00.000Z') });
      return record;
    },
    destroy: async () => {
      record.deleted_at = new Date('2026-03-01T00:00:00.000Z');
      record.updated_at = record.deleted_at;
    },
  };
  Object.assign(record, overrides, { id: overrides.id ?? record.id });
  nextId += 1;
  return record;
}

/** Extracts the registration/bus-number equality filter if present. */
function equalityValue(
  where: Record<PropertyKey, unknown> | undefined,
  field: string,
): string | undefined {
  if (!where) {
    return undefined;
  }
  const value = where[field];
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function makeBusesRepository(
  records: StubBusRecord[] = [],
  capture: {
    createPayload?: Partial<StubBusRecord>;
    findOneWhere?: Record<PropertyKey, unknown>;
    findAndCountWhere?: Record<PropertyKey, unknown>;
  } = {},
) {
  const all = [...records];
  return {
    all,
    repo: {
      findOne: async (options: { where: Record<PropertyKey, unknown> }) => {
        capture.findOneWhere = options.where;
        const match = all.find((record) => {
          if (record.deleted_at !== null) {
            return false;
          }
          if (options.where.id !== undefined) {
            const idFilter = options.where.id as string | { [Op.ne]?: string };
            if (typeof idFilter === 'string') {
              if (record.id !== idFilter) {
                return false;
              }
            } else if (idFilter[Op.ne] !== undefined && record.id === idFilter[Op.ne]) {
              return false;
            }
          }
          if (
            options.where.school_id !== undefined &&
            record.school_id !== options.where.school_id
          ) {
            return false;
          }
          const registration = equalityValue(options.where, 'registration_number');
          if (registration !== undefined && record.registration_number !== registration) {
            return false;
          }
          const busNumber = equalityValue(options.where, 'bus_number');
          if (busNumber !== undefined && record.bus_number !== busNumber) {
            return false;
          }
          return true;
        });
        return (match ?? null) as unknown as Bus;
      },
      create: async (payload: Partial<StubBusRecord>) => {
        capture.createPayload = payload;
        const record = makeBusRecord({
          ...payload,
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          updated_at: new Date('2026-04-01T00:00:00.000Z'),
        });
        all.push(record);
        return record as unknown as Bus;
      },
      findAndCountAll: async (options: {
        where?: Record<PropertyKey, unknown>;
        limit?: number;
        offset?: number;
        order?: unknown;
      }) => {
        capture.findAndCountWhere = options.where;
        let rows = all.filter(
          (record) =>
            record.school_id === options.where?.['school_id'] && record.deleted_at === null,
        );

        const or = options.where?.[Op.or] as
          Array<Record<string, Record<PropertyKey, string>>> | undefined;
        if (or) {
          const pattern = String(or[0]?.['registration_number']?.[Op.iLike] ?? '');
          const needle = pattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
          rows = rows.filter(
            (record) =>
              record.registration_number.toLowerCase().includes(needle) ||
              (record.bus_number ?? '').toLowerCase().includes(needle),
          );
        }

        const offset = options.offset ?? 0;
        const limit = options.limit ?? rows.length;
        return {
          rows: rows.slice(offset, offset + limit).map((record) => record as unknown as Bus),
          count: rows.length,
        };
      },
    } as unknown as typeof Bus,
  };
}

function makeCreateDto(overrides: Partial<CreateBusDto> = {}): CreateBusDto {
  const dto = new CreateBusDto();
  dto.registration_number = 'ABC-1234';
  dto.bus_number = 'BUS-01';
  dto.capacity = 48;
  return Object.assign(dto, overrides);
}

function makeUpdateDto(overrides: Partial<UpdateBusDto> = {}): UpdateBusDto {
  const dto = new UpdateBusDto();
  return Object.assign(dto, overrides);
}

function makeQuery(overrides: Partial<ListBusesQueryDto> = {}): ListBusesQueryDto {
  const dto = new ListBusesQueryDto();
  return Object.assign(dto, overrides);
}

/**
 * Builds the service with the bus repository plus empty stubs for the roster /
 * route / crew / trip repositories. Tests that exercise enrichment pass their
 * own stubs via {@link makeServiceWithRelations}.
 */
function allowAllPlanLimits(): PlanLimitsService {
  return {
    assertWithinLimit: async () => undefined,
    assertStaffWithinLimit: async () => undefined,
    // Transactional reservation used by the create paths. Without a database
    // the real service behaves the same way: assert, then run the work with
    // no transaction.
    runWithinLimit: async <T>(_schoolId: string, _resource: unknown, work: () => Promise<T>) =>
      work(),
    runWithinStaffLimit: async <T>(_schoolId: string, _role: unknown, work: () => Promise<T>) =>
      work(),
  } as unknown as PlanLimitsService;
}

function makeService(repo: typeof Bus): BusesService {
  const empty = { findAll: async () => [] } as unknown as typeof Route;
  return new BusesService(
    repo,
    empty as unknown as typeof RouteAssignment,
    empty as unknown as typeof Route,
    empty as unknown as typeof User,
    empty as unknown as typeof Trip,
    allowAllPlanLimits(),
  );
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException, 'expected a NotFoundException');
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, BUS_NOT_FOUND_MESSAGE);
    return true;
  });
}

async function expectConflict(promise: Promise<unknown>, expectedMessage: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ConflictException, 'expected a ConflictException');
    assert.equal(error.getStatus(), 409);
    assert.equal(error.message, expectedMessage);
    return true;
  });
}

describe('BusesService.create', () => {
  it('creates a bus scoped to the authenticated school', async () => {
    const capture: { createPayload?: Partial<StubBusRecord> } = {};
    const { repo } = makeBusesRepository([], capture);
    const service = makeService(repo);

    const response = await service.create(SCHOOL_A, makeCreateDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.registration_number, 'ABC-1234');
    assert.equal(capture.createPayload?.capacity, 48);
    assert.equal(capture.createPayload?.is_active, true);
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.registration_number, 'ABC-1234');
    assert.equal(response.is_active, true);
    assert.equal(typeof response.created_at, 'string');
    assert.equal(typeof response.updated_at, 'string');

    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes('deleted_at'), 'internal fields are not serialized');
  });

  it('defaults is_active to true and normalizes empty bus_number to null', async () => {
    const capture: { createPayload?: Partial<StubBusRecord> } = {};
    const { repo } = makeBusesRepository([], capture);
    const service = makeService(repo);

    await service.create(SCHOOL_A, makeCreateDto({ bus_number: '   ', is_active: undefined }));

    assert.equal(capture.createPayload?.bus_number, null);
    assert.equal(capture.createPayload?.is_active, true);
  });

  it('rejects a registration number used by another bus of the same school', async () => {
    const existing = makeBusRecord({ registration_number: 'ABC-1234' });
    const { repo } = makeBusesRepository([existing]);
    const service = makeService(repo);

    await expectConflict(
      service.create(SCHOOL_A, makeCreateDto()),
      BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE,
    );
  });

  it('rejects a bus number used by another bus of the same school', async () => {
    const existing = makeBusRecord({ bus_number: 'BUS-01' });
    const { repo } = makeBusesRepository([existing]);
    const service = makeService(repo);

    await expectConflict(service.create(SCHOOL_A, makeCreateDto()), BUS_NUMBER_TAKEN_MESSAGE);
  });

  it('allows the same registration number in another school', async () => {
    const existing = makeBusRecord({ school_id: SCHOOL_B, registration_number: 'ABC-1234' });
    const { repo } = makeBusesRepository([existing]);
    const service = makeService(repo);

    const response = await service.create(SCHOOL_A, makeCreateDto());

    assert.equal(response.school_id, SCHOOL_A);
  });

  it('maps a racing unique violation to a conflict', async () => {
    const { repo: base } = makeBusesRepository([]);
    const repo = {
      ...base,
      create: async () => {
        throw new UniqueConstraintError({
          errors: [{ path: 'registration_number' } as never],
        });
      },
    } as unknown as typeof Bus;
    const service = makeService(repo);

    await expectConflict(
      service.create(SCHOOL_A, makeCreateDto()),
      BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE,
    );
  });
});

describe('BusesService.findAll', () => {
  it('lists only buses of the authenticated school with pagination meta', async () => {
    const { repo } = makeBusesRepository([
      makeBusRecord({ school_id: SCHOOL_A, registration_number: 'REG-1' }),
      makeBusRecord({ school_id: SCHOOL_A, registration_number: 'REG-2' }),
      makeBusRecord({ school_id: SCHOOL_A, registration_number: 'REG-3' }),
      makeBusRecord({ school_id: SCHOOL_B, registration_number: 'OTHER-1' }),
      makeBusRecord({ school_id: SCHOOL_A, registration_number: 'REG-4', deleted_at: new Date() }),
    ]);
    const service = makeService(repo);

    const response = await service.findAll(SCHOOL_A, makeQuery({ page: 1, limit: 2 }));

    assert.equal(response.items.length, 2);
    assert.equal(response.meta.total, 3);
    assert.equal(response.meta.totalPages, 2);
    assert.equal(response.meta.hasNextPage, true);
    assert.equal(response.meta.hasPreviousPage, false);
    assert.ok(response.items.every((bus) => bus.school_id === SCHOOL_A));
  });

  it('filters by search over registration and bus number', async () => {
    const { repo } = makeBusesRepository([
      makeBusRecord({ registration_number: 'XYZ-999', bus_number: 'BUS-01' }),
      makeBusRecord({ registration_number: 'ABC-123', bus_number: 'BUS-02' }),
    ]);
    const service = makeService(repo);

    const response = await service.findAll(SCHOOL_A, makeQuery({ search: 'bus-01' }));

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].bus_number, 'BUS-01');
  });

  it('escapes LIKE wildcards in the search term', async () => {
    const capture: { findAndCountWhere?: Record<PropertyKey, unknown> } = {};
    const { repo } = makeBusesRepository([], capture);
    const service = makeService(repo);

    await service.findAll(SCHOOL_A, makeQuery({ search: '100%' }));

    const or = capture.findAndCountWhere?.[Op.or] as Array<Record<string, Record<symbol, unknown>>>;
    assert.equal(or?.[0]?.['registration_number']?.[Op.iLike], '%100\\%%');
  });
  it('returns assigned route, driver and conductor names plus current trip status', async () => {
    const bus = makeBusRecord({ id: 'bus-1' });
    const { repo } = makeBusesRepository([bus]);

    const assignments = {
      findAll: async () =>
        [
          {
            bus_id: 'bus-1',
            route_id: 'route-1',
            user_id: 'driver-1',
            role: RouteAssignmentRole.DRIVER,
            effective_from: '2026-01-01',
          },
          {
            bus_id: 'bus-1',
            route_id: 'route-1',
            user_id: 'conductor-1',
            role: RouteAssignmentRole.CONDUCTOR,
            effective_from: '2026-01-01',
          },
        ] as unknown as RouteAssignment[],
    } as unknown as typeof RouteAssignment;
    const routes = {
      findAll: async () => [{ id: 'route-1', name: 'North Loop', code: 'N1' }] as unknown as Route[],
    } as unknown as typeof Route;
    const users = {
      findAll: async () =>
        [
          { id: 'driver-1', first_name: 'Ada', last_name: 'Driver' },
          { id: 'conductor-1', first_name: 'Con', last_name: 'Ductor' },
        ] as unknown as User[],
    } as unknown as typeof User;
    const trips = {
      findAll: async () =>
        [
          { bus_id: 'bus-1', status: TripStatus.IN_PROGRESS, scheduled_start_at: new Date() },
        ] as unknown as Trip[],
    } as unknown as typeof Trip;

    const service = new BusesService(repo, assignments, routes, users, trips, allowAllPlanLimits());

    const response = await service.findAll(SCHOOL_A, makeQuery());

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].assigned_route_name, 'North Loop');
    assert.equal(response.items[0].assigned_route_code, 'N1');
    assert.equal(response.items[0].assigned_driver_name, 'Ada Driver');
    assert.equal(response.items[0].assigned_conductor_name, 'Con Ductor');
    assert.equal(response.items[0].current_trip_status, TripStatus.IN_PROGRESS);
  });
});

describe('BusesService.findOne', () => {
  it('returns a bus only when id and school match', async () => {
    const bus = makeBusRecord({ id: 'bus-1', school_id: SCHOOL_A });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    const response = await service.findOne(SCHOOL_A, 'bus-1');

    assert.equal(response.id, 'bus-1');
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('returns the generic 404 for a missing id', async () => {
    const { repo } = makeBusesRepository([]);
    const service = makeService(repo);

    await expectNotFound(service.findOne(SCHOOL_A, 'bus-missing'));
  });

  it('returns the generic 404 for another school id', async () => {
    const bus = makeBusRecord({ id: 'bus-1', school_id: SCHOOL_B });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    await expectNotFound(service.findOne(SCHOOL_A, 'bus-1'));
  });
});

describe('BusesService.update', () => {
  it('partially updates a bus of the authenticated school', async () => {
    const bus = makeBusRecord({ id: 'bus-1', capacity: 48 });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    const response = await service.update(
      SCHOOL_A,
      'bus-1',
      makeUpdateDto({ capacity: 60, is_active: false }),
    );

    assert.equal(response.capacity, 60);
    assert.equal(response.is_active, false);
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('clears bus_number when null is sent', async () => {
    const bus = makeBusRecord({ id: 'bus-1', bus_number: 'BUS-01' });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    const response = await service.update(SCHOOL_A, 'bus-1', makeUpdateDto({ bus_number: null }));

    assert.equal(response.bus_number, null);
  });

  it('allows keeping the same registration number (self-excluded check)', async () => {
    const bus = makeBusRecord({ id: 'bus-1', registration_number: 'ABC-1234' });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    const response = await service.update(
      SCHOOL_A,
      'bus-1',
      makeUpdateDto({ registration_number: 'ABC-1234' }),
    );

    assert.equal(response.registration_number, 'ABC-1234');
  });

  it('rejects a registration number used by another bus of the same school', async () => {
    const bus = makeBusRecord({ id: 'bus-1', registration_number: 'ABC-1234' });
    const other = makeBusRecord({ id: 'bus-2', registration_number: 'XYZ-999' });
    const { repo } = makeBusesRepository([bus, other]);
    const service = makeService(repo);

    await expectConflict(
      service.update(SCHOOL_A, 'bus-1', makeUpdateDto({ registration_number: 'XYZ-999' })),
      BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE,
    );
  });

  it('returns the generic 404 when updating another school bus', async () => {
    const bus = makeBusRecord({ id: 'bus-1', school_id: SCHOOL_B });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    await expectNotFound(service.update(SCHOOL_A, 'bus-1', makeUpdateDto({ capacity: 60 })));
  });
});

describe('BusesService.remove', () => {
  it('soft deletes a bus of the authenticated school', async () => {
    const bus = makeBusRecord({ id: 'bus-1' });
    const { repo, all } = makeBusesRepository([bus]);
    const service = makeService(repo);

    const response = await service.remove(SCHOOL_A, 'bus-1');

    assert.equal(response.id, 'bus-1');
    assert.equal(response.message, BUS_DELETED_MESSAGE);
    assert.notEqual(all[0].deleted_at, null);
  });

  it('returns the generic 404 when deleting another school bus', async () => {
    const bus = makeBusRecord({ id: 'bus-1', school_id: SCHOOL_B });
    const { repo } = makeBusesRepository([bus]);
    const service = makeService(repo);

    await expectNotFound(service.remove(SCHOOL_A, 'bus-1'));
  });
});
