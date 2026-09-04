import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import { Route, Stop } from '../../database/models';
import { PlanLimitsService } from '../../common/plan-limits';
import { StopsService } from './stops.service';
import {
  STOP_DELETED_MESSAGE,
  STOP_NOT_FOUND_MESSAGE,
  STOP_ROUTE_INVALID_MESSAGE,
  STOP_SEQUENCE_TAKEN_MESSAGE,
} from './stops.constants';
import { CreateStopDto } from './dto/create-stop.dto';
import { ListStopsQueryDto } from './dto/list-stops-query.dto';
import { UpdateStopDto } from './dto/update-stop.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '22222222-2222-4222-8222-222222222222';
const STOP_A = '33333333-3333-4333-8333-333333333333';

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
  update: (values: Partial<StubStopRecord>) => Promise<StubStopRecord>;
  destroy: () => Promise<void>;
}

let nextId = 1;

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

function makeStopsRepository(
  records: StubStopRecord[] = [],
  capture: {
    createPayload?: Partial<StubStopRecord>;
    findOneWhere?: Record<PropertyKey, unknown>;
    findAndCountWhere?: Record<PropertyKey, unknown>;
    maxArgs?: { field: string; where: Record<PropertyKey, unknown> };
  } = {},
) {
  const all = [...records];
  return {
    all,
    repo: {
      findOne: async (options: { where: Record<PropertyKey, unknown> }) => {
        capture.findOneWhere = options.where;
        const match = all.find(
          (record) =>
            record.id === options.where.id &&
            record.school_id === options.where.school_id &&
            record.deleted_at === null,
        );
        return (match ?? null) as unknown as Stop;
      },
      create: async (payload: Partial<StubStopRecord>) => {
        capture.createPayload = payload;
        const record = makeStopRecord({
          ...payload,
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          updated_at: new Date('2026-04-01T00:00:00.000Z'),
        });
        all.push(record);
        return record as unknown as Stop;
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
        if (options.where?.['route_id'] !== undefined) {
          rows = rows.filter((record) => record.route_id === options.where?.['route_id']);
        }

        const or = options.where?.[Op.or] as
          Array<Record<string, Record<PropertyKey, string>>> | undefined;
        if (or) {
          const pattern = String(or[0]?.['name']?.[Op.iLike] ?? '');
          const needle = pattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
          rows = rows.filter(
            (record) =>
              record.name.toLowerCase().includes(needle) ||
              (record.address ?? '').toLowerCase().includes(needle),
          );
        }

        const offset = options.offset ?? 0;
        const limit = options.limit ?? rows.length;
        return {
          rows: rows.slice(offset, offset + limit).map((record) => record as unknown as Stop),
          count: rows.length,
        };
      },
      max: async (field: string, options: { where: Record<PropertyKey, unknown> }) => {
        capture.maxArgs = { field, where: options.where };
        const max = all
          .filter(
            (record) =>
              record.deleted_at === null &&
              record.school_id === options.where.school_id &&
              record.route_id === options.where.route_id,
          )
          .reduce((highest, record) => Math.max(highest, record.sequence_number), 0);
        return max === 0 ? null : max;
      },
    } as unknown as typeof Stop,
  };
}

function makeRoutesRepository(records: Array<{ id: string; school_id: string }> = []) {
  return {
    repo: {
      findOne: async (options: { where: Record<string, unknown> }) =>
        records.find(
          (record) =>
            record.id === options.where.id && record.school_id === options.where.school_id,
        ) ?? null,
    } as unknown as typeof Route,
  };
}


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

function makeCreateDto(overrides: Partial<CreateStopDto> = {}): CreateStopDto {
  const dto = new CreateStopDto();
  dto.route_id = ROUTE_A;
  dto.name = 'Maple St & 5th Ave';
  dto.sequence_number = 3;
  return Object.assign(dto, overrides);
}

function makeUpdateDto(overrides: Partial<UpdateStopDto> = {}): UpdateStopDto {
  const dto = new UpdateStopDto();
  return Object.assign(dto, overrides);
}

function makeQuery(overrides: Partial<ListStopsQueryDto> = {}): ListStopsQueryDto {
  const dto = new ListStopsQueryDto();
  return Object.assign(dto, overrides);
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException, 'expected a NotFoundException');
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, STOP_NOT_FOUND_MESSAGE);
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

describe('StopsService.create', () => {
  it('creates a stop scoped to the authenticated school and route', async () => {
    const capture: { createPayload?: Partial<StubStopRecord> } = {};
    const { repo: stops } = makeStopsRepository([], capture);
    const service = new StopsService(
      stops,
      makeRoutesRepository([{ id: ROUTE_A, school_id: SCHOOL_A }]).repo,
      allowAllPlanLimits(),
    );

    const response = await service.create(SCHOOL_A, makeCreateDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.route_id, ROUTE_A);
    assert.equal(capture.createPayload?.name, 'Maple St & 5th Ave');
    assert.equal(capture.createPayload?.sequence_number, 3);
    assert.equal(capture.createPayload?.geofence_radius_meters, 100);
    assert.equal(capture.createPayload?.is_active, true);
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.route_id, ROUTE_A);
    assert.equal(typeof response.created_at, 'string');

    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes('deleted_at'), 'internal fields are not serialized');
  });

  it('appends the stop at the end of the route when sequence_number is omitted', async () => {
    const capture: { createPayload?: Partial<StubStopRecord> } = {};
    const { repo: stops } = makeStopsRepository(
      [
        makeStopRecord({ id: 'stop-1', route_id: ROUTE_A, sequence_number: 1 }),
        makeStopRecord({ id: 'stop-2', route_id: ROUTE_A, sequence_number: 2 }),
      ],
      capture,
    );
    const service = new StopsService(
      stops,
      makeRoutesRepository([{ id: ROUTE_A, school_id: SCHOOL_A }]).repo,
      allowAllPlanLimits(),
    );

    await service.create(SCHOOL_A, makeCreateDto({ sequence_number: undefined }));

    assert.equal(capture.createPayload?.sequence_number, 3);
  });

  it('rejects a route that does not exist', async () => {
    const { repo: stops } = makeStopsRepository();
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    await expectBadRequest(service.create(SCHOOL_A, makeCreateDto()), STOP_ROUTE_INVALID_MESSAGE);
  });

  it('rejects a route that belongs to another school', async () => {
    const { repo: stops } = makeStopsRepository();
    const service = new StopsService(
      stops,
      makeRoutesRepository([{ id: ROUTE_B, school_id: SCHOOL_B }]).repo,
      allowAllPlanLimits(),
    );

    await expectBadRequest(
      service.create(SCHOOL_A, makeCreateDto({ route_id: ROUTE_B })),
      STOP_ROUTE_INVALID_MESSAGE,
    );
  });

  it('maps a sequence collision to a conflict', async () => {
    const { repo: base } = makeStopsRepository();
    const stops = {
      ...base,
      create: async () => {
        throw new UniqueConstraintError({ errors: [{ path: 'sequence_number' } as never] });
      },
    } as unknown as typeof Stop;
    const service = new StopsService(
      stops,
      makeRoutesRepository([{ id: ROUTE_A, school_id: SCHOOL_A }]).repo,
      allowAllPlanLimits(),
    );

    await expectConflict(service.create(SCHOOL_A, makeCreateDto()), STOP_SEQUENCE_TAKEN_MESSAGE);
  });
});

describe('StopsService.findAll', () => {
  it('lists only stops of the authenticated school with pagination meta', async () => {
    const { repo: stops } = makeStopsRepository([
      makeStopRecord({ school_id: SCHOOL_A, route_id: ROUTE_A }),
      makeStopRecord({ school_id: SCHOOL_A, route_id: ROUTE_A }),
      makeStopRecord({ school_id: SCHOOL_A, route_id: ROUTE_B }),
      makeStopRecord({ school_id: SCHOOL_B, route_id: ROUTE_B }),
      makeStopRecord({ school_id: SCHOOL_A, route_id: ROUTE_A, deleted_at: new Date() }),
    ]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.findAll(SCHOOL_A, makeQuery({ page: 1, limit: 2 }));

    assert.equal(response.items.length, 2);
    assert.equal(response.meta.total, 3);
    assert.equal(response.meta.totalPages, 2);
    assert.equal(response.meta.hasNextPage, true);
    assert.ok(response.items.every((stop) => stop.school_id === SCHOOL_A));
  });

  it('filters by route_id', async () => {
    const { repo: stops } = makeStopsRepository([
      makeStopRecord({ route_id: ROUTE_A }),
      makeStopRecord({ route_id: ROUTE_B }),
    ]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.findAll(SCHOOL_A, makeQuery({ route_id: ROUTE_A }));

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].route_id, ROUTE_A);
  });

  it('filters by search over name and address', async () => {
    const { repo: stops } = makeStopsRepository([
      makeStopRecord({ name: 'Main Gate', address: null }),
      makeStopRecord({ name: 'Library', address: 'Maple Street 10' }),
    ]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.findAll(SCHOOL_A, makeQuery({ search: 'maple' }));

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].name, 'Library');
  });
});

describe('StopsService.findOne', () => {
  it('returns a stop only when id and school match', async () => {
    const stop = makeStopRecord({ id: STOP_A, school_id: SCHOOL_A });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.findOne(SCHOOL_A, STOP_A);

    assert.equal(response.id, STOP_A);
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('returns the generic 404 for a missing id', async () => {
    const { repo: stops } = makeStopsRepository([]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    await expectNotFound(service.findOne(SCHOOL_A, STOP_A));
  });

  it('returns the generic 404 for another school id', async () => {
    const stop = makeStopRecord({ id: STOP_A, school_id: SCHOOL_B });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    await expectNotFound(service.findOne(SCHOOL_A, STOP_A));
  });
});

describe('StopsService.update', () => {
  it('partially updates a stop of the authenticated school', async () => {
    const stop = makeStopRecord({ id: STOP_A, name: 'Old name', geofence_radius_meters: 100 });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.update(
      SCHOOL_A,
      STOP_A,
      makeUpdateDto({ name: 'New name', geofence_radius_meters: 250, is_active: false }),
    );

    assert.equal(response.name, 'New name');
    assert.equal(response.geofence_radius_meters, 250);
    assert.equal(response.is_active, false);
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('clears nullable fields when null is sent', async () => {
    const stop = makeStopRecord({
      id: STOP_A,
      address: 'Somewhere',
      estimated_arrival_time: '08:15',
    });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.update(
      SCHOOL_A,
      STOP_A,
      makeUpdateDto({ address: null, estimated_arrival_time: null }),
    );

    assert.equal(response.address, null);
    assert.equal(response.estimated_arrival_time, null);
  });

  it('moves a stop to another route of the same school', async () => {
    const stop = makeStopRecord({ id: STOP_A, route_id: ROUTE_A });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(
      stops,
      makeRoutesRepository([
        { id: ROUTE_A, school_id: SCHOOL_A },
        { id: ROUTE_B, school_id: SCHOOL_A },
      ]).repo,
      allowAllPlanLimits(),
    );

    const response = await service.update(SCHOOL_A, STOP_A, makeUpdateDto({ route_id: ROUTE_B }));

    assert.equal(response.route_id, ROUTE_B);
  });

  it('rejects moving a stop to a route of another school', async () => {
    const stop = makeStopRecord({ id: STOP_A, route_id: ROUTE_A });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(
      stops,
      makeRoutesRepository([{ id: ROUTE_B, school_id: SCHOOL_B }]).repo,
      allowAllPlanLimits(),
    );

    await expectBadRequest(
      service.update(SCHOOL_A, STOP_A, makeUpdateDto({ route_id: ROUTE_B })),
      STOP_ROUTE_INVALID_MESSAGE,
    );
  });

  it('maps a sequence collision to a conflict', async () => {
    const stop = makeStopRecord({ id: STOP_A });
    const { repo: stops } = makeStopsRepository([stop]);
    stop.update = async () => {
      throw new UniqueConstraintError({ errors: [{ path: 'sequence_number' } as never] });
    };
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    await expectConflict(
      service.update(SCHOOL_A, STOP_A, makeUpdateDto({ sequence_number: 1 })),
      STOP_SEQUENCE_TAKEN_MESSAGE,
    );
  });

  it('returns the generic 404 when updating another school stop', async () => {
    const stop = makeStopRecord({ id: STOP_A, school_id: SCHOOL_B });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    await expectNotFound(service.update(SCHOOL_A, STOP_A, makeUpdateDto({ name: 'X' })));
  });
});

describe('StopsService.remove', () => {
  it('soft deletes a stop of the authenticated school', async () => {
    const stop = makeStopRecord({ id: STOP_A });
    const { repo: stops, all } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    const response = await service.remove(SCHOOL_A, STOP_A);

    assert.equal(response.id, STOP_A);
    assert.equal(response.message, STOP_DELETED_MESSAGE);
    assert.notEqual(all[0].deleted_at, null);
  });

  it('returns the generic 404 when deleting another school stop', async () => {
    const stop = makeStopRecord({ id: STOP_A, school_id: SCHOOL_B });
    const { repo: stops } = makeStopsRepository([stop]);
    const service = new StopsService(stops, makeRoutesRepository().repo, allowAllPlanLimits());

    await expectNotFound(service.remove(SCHOOL_A, STOP_A));
  });
});
