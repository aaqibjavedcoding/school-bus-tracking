import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import { Route, Stop } from '../../database/models';
import { RoutesService } from './routes.service';
import {
  ROUTE_CODE_TAKEN_MESSAGE,
  ROUTE_DELETED_MESSAGE,
  ROUTE_NOT_FOUND_MESSAGE,
  ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE,
  ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE,
  ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE,
} from './routes.constants';
import { CreateRouteDto } from './dto/create-route.dto';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '22222222-2222-4222-8222-222222222222';
const STOP_1 = '33333333-3333-4333-8333-333333333333';
const STOP_2 = '44444444-4444-4444-8444-444444444444';
const STOP_3 = '55555555-5555-4555-8555-555555555555';

interface StubRouteRecord {
  id: string;
  school_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Partial<StubRouteRecord>) => Promise<StubRouteRecord>;
  destroy: () => Promise<void>;
}

interface StubStopRecord {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
  sequence_number: number;
  estimated_arrival_time: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (
    values: Partial<StubStopRecord>,
    options?: { transaction?: unknown },
  ) => Promise<StubStopRecord>;
  destroy: () => Promise<void>;
}

let nextId = 1;

function makeRouteRecord(overrides: Partial<StubRouteRecord> = {}): StubRouteRecord {
  const record: StubRouteRecord = {
    id: `route-${nextId}`,
    school_id: SCHOOL_A,
    name: `Route ${nextId}`,
    code: `R-${nextId}`,
    description: null,
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

function makeStopRecord(overrides: Partial<StubStopRecord> = {}): StubStopRecord {
  const record: StubStopRecord = {
    id: `stop-${nextId}`,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    name: `Stop ${nextId}`,
    address: null,
    latitude: null,
    longitude: null,
    geofence_radius_meters: 100,
    sequence_number: nextId,
    estimated_arrival_time: null,
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

function makeRoutesRepository(
  records: StubRouteRecord[] = [],
  capture: {
    createPayload?: Partial<StubRouteRecord>;
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
          if (
            typeof options.where.code === 'string' &&
            options.where.code !== undefined &&
            record.code !== options.where.code
          ) {
            return false;
          }
          return true;
        });
        return (match ?? null) as unknown as Route;
      },
      create: async (payload: Partial<StubRouteRecord>) => {
        capture.createPayload = payload;
        const record = makeRouteRecord({
          ...payload,
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          updated_at: new Date('2026-04-01T00:00:00.000Z'),
        });
        all.push(record);
        return record as unknown as Route;
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
          const pattern = String(or[0]?.['name']?.[Op.iLike] ?? '');
          const needle = pattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
          rows = rows.filter(
            (record) =>
              record.name.toLowerCase().includes(needle) ||
              record.code.toLowerCase().includes(needle),
          );
        }

        const offset = options.offset ?? 0;
        const limit = options.limit ?? rows.length;
        return {
          rows: rows.slice(offset, offset + limit).map((record) => record as unknown as Route),
          count: rows.length,
        };
      },
    } as unknown as typeof Route,
  };
}

function makeStopsRepository(
  records: StubStopRecord[] = [],
  capture: {
    findAllWhere?: Record<PropertyKey, unknown>;
    updates?: Array<{ id: string; sequence_number: number }>;
  } = {},
) {
  const all = [...records];
  return {
    all,
    capture,
    repo: {
      findAll: async (options: { where?: Record<PropertyKey, unknown>; order?: unknown }) => {
        capture.findAllWhere = options.where;
        const rows = all.filter(
          (record) =>
            record.deleted_at === null &&
            record.school_id === options.where?.['school_id'] &&
            record.route_id === options.where?.['route_id'],
        );
        if (options.order) {
          rows.sort((a, b) => a.sequence_number - b.sequence_number);
        }
        return rows.map((record) => record as unknown as Stop);
      },
      sequelize: {
        transaction: async <T>(fn: (transaction: unknown) => Promise<T>): Promise<T> => {
          capture.updates = [];
          const transaction = { id: 'tx-1' };
          const originalUpdate = all.map((record) => ({
            record,
            update: record.update.bind(record),
          }));
          for (const { record } of originalUpdate) {
            record.update = async (values) => {
              if (values.sequence_number !== undefined) {
                capture.updates?.push({ id: record.id, sequence_number: values.sequence_number });
              }
              Object.assign(record, values);
              return record;
            };
          }
          try {
            return await fn(transaction);
          } finally {
            for (const { record, update } of originalUpdate) {
              record.update = update;
            }
          }
        },
      },
    } as unknown as typeof Stop,
  };
}

function makeCreateDto(overrides: Partial<CreateRouteDto> = {}): CreateRouteDto {
  const dto = new CreateRouteDto();
  dto.name = 'North Loop — Morning';
  dto.code = 'NORTH-AM';
  return Object.assign(dto, overrides);
}

function makeUpdateDto(overrides: Partial<UpdateRouteDto> = {}): UpdateRouteDto {
  const dto = new UpdateRouteDto();
  return Object.assign(dto, overrides);
}

function makeQuery(overrides: Partial<ListRoutesQueryDto> = {}): ListRoutesQueryDto {
  const dto = new ListRoutesQueryDto();
  return Object.assign(dto, overrides);
}

function makeReorderDto(stopIds: string[]): ReorderRouteStopsDto {
  const dto = new ReorderRouteStopsDto();
  dto.stop_ids = stopIds;
  return dto;
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException, 'expected a NotFoundException');
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, ROUTE_NOT_FOUND_MESSAGE);
    return true;
  });
}

async function expectBadRequest(promise: Promise<unknown>, expectedMessage: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof BadRequestException, 'expected a BadRequestException');
    assert.equal(error.getStatus(), 400);
    assert.equal(error.message, expectedMessage);
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

describe('RoutesService.create', () => {
  it('creates a route scoped to the authenticated school', async () => {
    const capture: { createPayload?: Partial<StubRouteRecord> } = {};
    const { repo } = makeRoutesRepository([], capture);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.create(SCHOOL_A, makeCreateDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.name, 'North Loop — Morning');
    assert.equal(capture.createPayload?.code, 'NORTH-AM');
    assert.equal(capture.createPayload?.is_active, true);
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.code, 'NORTH-AM');
    assert.equal(typeof response.created_at, 'string');

    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes('deleted_at'), 'internal fields are not serialized');
  });

  it('normalizes an empty description to null', async () => {
    const capture: { createPayload?: Partial<StubRouteRecord> } = {};
    const { repo } = makeRoutesRepository([], capture);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await service.create(SCHOOL_A, makeCreateDto({ description: '   ' }));

    assert.equal(capture.createPayload?.description, null);
  });

  it('rejects a code used by another route of the same school', async () => {
    const existing = makeRouteRecord({ code: 'NORTH-AM' });
    const { repo } = makeRoutesRepository([existing]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectConflict(service.create(SCHOOL_A, makeCreateDto()), ROUTE_CODE_TAKEN_MESSAGE);
  });

  it('allows the same code in another school', async () => {
    const existing = makeRouteRecord({ school_id: SCHOOL_B, code: 'NORTH-AM' });
    const { repo } = makeRoutesRepository([existing]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.create(SCHOOL_A, makeCreateDto());

    assert.equal(response.school_id, SCHOOL_A);
  });

  it('maps a racing unique violation to a conflict', async () => {
    const { repo: base } = makeRoutesRepository([]);
    const repo = {
      ...base,
      create: async () => {
        throw new UniqueConstraintError({ errors: [{ path: 'code' } as never] });
      },
    } as unknown as typeof Route;
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectConflict(service.create(SCHOOL_A, makeCreateDto()), ROUTE_CODE_TAKEN_MESSAGE);
  });
});

describe('RoutesService.findAll', () => {
  it('lists only routes of the authenticated school with pagination meta', async () => {
    const { repo } = makeRoutesRepository([
      makeRouteRecord({ school_id: SCHOOL_A, code: 'R-1' }),
      makeRouteRecord({ school_id: SCHOOL_A, code: 'R-2' }),
      makeRouteRecord({ school_id: SCHOOL_A, code: 'R-3' }),
      makeRouteRecord({ school_id: SCHOOL_B, code: 'OTHER-1' }),
      makeRouteRecord({ school_id: SCHOOL_A, code: 'R-4', deleted_at: new Date() }),
    ]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.findAll(SCHOOL_A, makeQuery({ page: 1, limit: 2 }));

    assert.equal(response.items.length, 2);
    assert.equal(response.meta.total, 3);
    assert.equal(response.meta.totalPages, 2);
    assert.equal(response.meta.hasNextPage, true);
    assert.equal(response.meta.hasPreviousPage, false);
    assert.ok(response.items.every((route) => route.school_id === SCHOOL_A));
  });

  it('filters by search over name and code', async () => {
    const { repo } = makeRoutesRepository([
      makeRouteRecord({ name: 'North Loop', code: 'NORTH-AM' }),
      makeRouteRecord({ name: 'South Loop', code: 'SOUTH-AM' }),
    ]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.findAll(SCHOOL_A, makeQuery({ search: 'north' }));

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].code, 'NORTH-AM');
  });
});

describe('RoutesService.findOne', () => {
  it('returns a route only when id and school match', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, school_id: SCHOOL_A });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.findOne(SCHOOL_A, ROUTE_A);

    assert.equal(response.id, ROUTE_A);
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('returns the generic 404 for a missing id', async () => {
    const { repo } = makeRoutesRepository([]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectNotFound(service.findOne(SCHOOL_A, ROUTE_A));
  });

  it('returns the generic 404 for another school id', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, school_id: SCHOOL_B });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectNotFound(service.findOne(SCHOOL_A, ROUTE_A));
  });
});

describe('RoutesService.update', () => {
  it('partially updates a route of the authenticated school', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, name: 'Old name' });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.update(
      SCHOOL_A,
      ROUTE_A,
      makeUpdateDto({ name: 'New name', is_active: false }),
    );

    assert.equal(response.name, 'New name');
    assert.equal(response.is_active, false);
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('allows keeping the same code (self-excluded check)', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, code: 'NORTH-AM' });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.update(SCHOOL_A, ROUTE_A, makeUpdateDto({ code: 'NORTH-AM' }));

    assert.equal(response.code, 'NORTH-AM');
  });

  it('rejects a code used by another route of the same school', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, code: 'NORTH-AM' });
    const other = makeRouteRecord({ id: ROUTE_B, code: 'SOUTH-AM' });
    const { repo } = makeRoutesRepository([route, other]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectConflict(
      service.update(SCHOOL_A, ROUTE_A, makeUpdateDto({ code: 'SOUTH-AM' })),
      ROUTE_CODE_TAKEN_MESSAGE,
    );
  });

  it('returns the generic 404 when updating another school route', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, school_id: SCHOOL_B });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectNotFound(service.update(SCHOOL_A, ROUTE_A, makeUpdateDto({ name: 'X' })));
  });
});

describe('RoutesService.remove', () => {
  it('soft deletes a route of the authenticated school', async () => {
    const route = makeRouteRecord({ id: ROUTE_A });
    const { repo, all } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    const response = await service.remove(SCHOOL_A, ROUTE_A);

    assert.equal(response.id, ROUTE_A);
    assert.equal(response.message, ROUTE_DELETED_MESSAGE);
    assert.notEqual(all[0].deleted_at, null);
  });

  it('returns the generic 404 when deleting another school route', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, school_id: SCHOOL_B });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectNotFound(service.remove(SCHOOL_A, ROUTE_A));
  });
});

describe('RoutesService.findRouteStops', () => {
  it('returns the route stops ordered by sequence_number', async () => {
    const route = makeRouteRecord({ id: ROUTE_A });
    const { repo } = makeRoutesRepository([route]);
    const stopsRepo = makeStopsRepository([
      makeStopRecord({ id: STOP_1, route_id: ROUTE_A, sequence_number: 2 }),
      makeStopRecord({ id: STOP_2, route_id: ROUTE_A, sequence_number: 1 }),
      makeStopRecord({ id: STOP_3, route_id: ROUTE_B, sequence_number: 1 }),
    ]);
    const service = new RoutesService(repo, stopsRepo.repo);

    const response = await service.findRouteStops(SCHOOL_A, ROUTE_A);

    assert.deepEqual(
      response.items.map((stop) => stop.id),
      [STOP_2, STOP_1],
    );
    assert.ok(response.items.every((stop) => stop.school_id === SCHOOL_A));
    assert.ok(response.items.every((stop) => stop.route_id === ROUTE_A));
  });

  it('returns the generic 404 for another school route', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, school_id: SCHOOL_B });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectNotFound(service.findRouteStops(SCHOOL_A, ROUTE_A));
  });
});

describe('RoutesService.reorderRouteStops', () => {
  function makeServiceWithStops() {
    const route = makeRouteRecord({ id: ROUTE_A });
    const { repo } = makeRoutesRepository([route]);
    const stop1 = makeStopRecord({ id: STOP_1, route_id: ROUTE_A, sequence_number: 1 });
    const stop2 = makeStopRecord({ id: STOP_2, route_id: ROUTE_A, sequence_number: 2 });
    const stop3 = makeStopRecord({ id: STOP_3, route_id: ROUTE_A, sequence_number: 3 });
    const stopsRepo = makeStopsRepository([stop1, stop2, stop3]);
    const service = new RoutesService(repo, stopsRepo.repo);
    return { service, stop1, stop2, stop3, capture: stopsRepo.capture };
  }

  it('renumbers the route stops from the supplied permutation', async () => {
    const { service, stop1, stop2, stop3, capture } = makeServiceWithStops();

    const response = await service.reorderRouteStops(
      SCHOOL_A,
      ROUTE_A,
      makeReorderDto([STOP_3, STOP_1, STOP_2]),
    );

    assert.deepEqual(
      response.items.map((stop) => stop.id),
      [STOP_3, STOP_1, STOP_2],
    );
    assert.equal(response.items[0].sequence_number, 1);
    assert.equal(response.items[1].sequence_number, 2);
    assert.equal(response.items[2].sequence_number, 3);
    assert.equal(stop3.sequence_number, 1);
    assert.equal(stop1.sequence_number, 2);
    assert.equal(stop2.sequence_number, 3);

    // Two-phase writes: every stop first moved to a negative temporary
    // position, then to its final 1..N position.
    assert.equal(capture.updates?.length, 6);
    assert.deepEqual(
      capture.updates?.slice(0, 3).map((update) => update.sequence_number),
      [-1, -2, -3],
    );
    assert.deepEqual(
      capture.updates?.slice(3).map((update) => update.sequence_number),
      [1, 2, 3],
    );
  });

  it('rejects a duplicate stop id', async () => {
    const { service } = makeServiceWithStops();

    await expectBadRequest(
      service.reorderRouteStops(SCHOOL_A, ROUTE_A, makeReorderDto([STOP_1, STOP_1, STOP_2])),
      ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE,
    );
  });

  it('rejects an incomplete list', async () => {
    const { service } = makeServiceWithStops();

    await expectBadRequest(
      service.reorderRouteStops(SCHOOL_A, ROUTE_A, makeReorderDto([STOP_1, STOP_2])),
      ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE,
    );
  });

  it('rejects a stop id that does not belong to the route', async () => {
    const { service } = makeServiceWithStops();

    await expectBadRequest(
      service.reorderRouteStops(
        SCHOOL_A,
        ROUTE_A,
        makeReorderDto([STOP_1, STOP_2, '99999999-9999-4999-8999-999999999999']),
      ),
      ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE,
    );
  });

  it('returns the generic 404 for another school route', async () => {
    const route = makeRouteRecord({ id: ROUTE_A, school_id: SCHOOL_B });
    const { repo } = makeRoutesRepository([route]);
    const service = new RoutesService(repo, makeStopsRepository().repo);

    await expectNotFound(service.reorderRouteStops(SCHOOL_A, ROUTE_A, makeReorderDto([STOP_1])));
  });
});
