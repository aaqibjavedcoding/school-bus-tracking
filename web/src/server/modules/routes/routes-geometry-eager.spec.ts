import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { RouteGeometryResponse } from '@school-bus-tracking/shared-types';
import { Route, Stop } from '../../database/models';
import { PlanLimitsService } from '../../common/plan-limits';
import type { RouteGeometryService } from '../routing/route-geometry.service';
import { RoutesService } from './routes.service';
import { StopsService } from '../stops/stops.service';
import { CreateStopDto } from '../stops/dto/create-stop.dto';
import { UpdateStopDto } from '../stops/dto/update-stop.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';

/**
 * The EAGER compute: when an admin saves or reorders a route's stops, the
 * stop-list change invalidates the geometry cache key, so the mutation
 * schedules a fire-and-forget recompute through RouteGeometryService.
 *
 * The pinned contract:
 *  - the compute is scheduled for exactly the affected route(s) — a stop
 *    that changes route warms BOTH routes;
 *  - the mutation response NEVER waits on the engine (the call is
 *    fire-and-forget) and NEVER fails because of it (a throwing geometry
 *    service is swallowed);
 *  - on a deployment with routing disabled (`enabled === false`) or with
 *    no geometry service wired, nothing is scheduled at all — there is no
 *    engine to ask.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '22222222-2222-4222-8222-222222222222';
const STOP_1 = '33333333-3333-4333-8333-333333333333';
const STOP_2 = '44444444-4444-4444-8444-444444444444';
const STOP_3 = '55555555-5555-4555-8555-555555555555';

interface GeometryCall {
  schoolId: string;
  routeId: string;
}

/** A recording RouteGeometryService double. */
function recordingGeometry(options: { enabled?: boolean } = {}): {
  service: RouteGeometryService;
  calls: GeometryCall[];
  failWith: (error: unknown) => void;
} {
  const calls: GeometryCall[] = [];
  let failure: unknown = null;
  const service = {
    get enabled() {
      return options.enabled ?? true;
    },
    getGeometry: async (schoolId: string, routeId: string): Promise<RouteGeometryResponse> => {
      calls.push({ schoolId, routeId });
      if (failure !== null) {
        throw failure;
      }
      return { status: 'unavailable' };
    },
  } as unknown as RouteGeometryService;
  return {
    service,
    calls,
    failWith: (error: unknown) => {
      failure = error;
    },
  };
}

/** Flush the microtask queue so fire-and-forget chains settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
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
  update: (values: Partial<StubStopRecord>) => Promise<StubStopRecord>;
  destroy: () => Promise<void>;
}

function makeStopRecord(overrides: Partial<StubStopRecord> = {}): StubStopRecord {
  const record: StubStopRecord = {
    id: STOP_1,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    name: 'Morning Gate',
    address: null,
    latitude: 33.6844,
    longitude: 73.0479,
    geofence_radius_meters: 100,
    sequence_number: 1,
    estimated_arrival_time: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(record, values);
      return record;
    },
    destroy: async () => {
      record.deleted_at = new Date('2026-03-01T00:00:00.000Z');
    },
  };
  return Object.assign(record, overrides);
}

interface StubRouteRecord {
  id: string;
  school_id: string;
  update: (values: Partial<StubRouteRecord>) => Promise<StubRouteRecord>;
  destroy: () => Promise<void>;
}

function makeRouteRecord(id: string): StubRouteRecord {
  const record: StubRouteRecord = {
    id,
    school_id: SCHOOL_A,
    update: async (values) => {
      Object.assign(record, values);
      return record;
    },
    destroy: async () => undefined,
  };
  return record;
}

/** Routes repository stub: the tenant-pinned findOne the services share. */
function routesRepository(routeIds: string[]) {
  return {
    findOne: async (options: { where: { id: string; school_id: string } }) =>
      routeIds.includes(options.where.id) && options.where.school_id === SCHOOL_A
        ? (makeRouteRecord(options.where.id) as unknown as Route)
        : null,
  } as unknown as typeof Route;
}

/** Stops repository stub with the transaction the reorder path needs. */
function stopsRepository(records: StubStopRecord[]) {
  const all = [...records];
  return {
    all,
    repo: {
      findAll: async (options: { where?: Record<string, unknown> }) =>
        all
          .filter(
            (record) =>
              record.deleted_at === null &&
              record.school_id === options.where?.['school_id'] &&
              (options.where?.['route_id'] === undefined ||
                record.route_id === options.where['route_id']),
          )
          .map((record) => record as unknown as Stop),
      findOne: async (options: { where: { id: string; school_id: string } }) =>
        (all.find(
          (record) =>
            record.id === options.where.id &&
            record.school_id === options.where.school_id &&
            record.deleted_at === null,
        ) as unknown as Stop) ?? null,
      create: async (values: Partial<StubStopRecord>) => {
        const record = makeStopRecord({ ...values, id: `stop-${all.length + 1}` });
        all.push(record);
        return record as unknown as Stop;
      },
      max: async () => null,
      sequelize: {
        transaction: async <T>(fn: (transaction: unknown) => Promise<T>): Promise<T> =>
          fn({ id: 'tx-1' }),
      },
    } as unknown as typeof Stop,
  };
}

function allowAllPlanLimits(): PlanLimitsService {
  return {
    runWithinLimit: async <T>(_schoolId: string, _resource: unknown, work: () => Promise<T>) =>
      work(),
  } as unknown as PlanLimitsService;
}

const emptyRelations = {
  findAll: async () => [],
} as unknown as typeof Stop;

function makeRoutesService(
  stops: typeof Stop,
  routeGeometry?: RouteGeometryService,
): RoutesService {
  return new RoutesService(
    routesRepository([ROUTE_A, ROUTE_B]),
    stops,
    emptyRelations as never,
    emptyRelations as never,
    emptyRelations as never,
    emptyRelations as never,
    emptyRelations as never,
    allowAllPlanLimits(),
    undefined,
    routeGeometry,
  );
}

function makeStopsService(stops: typeof Stop, routeGeometry?: RouteGeometryService): StopsService {
  return new StopsService(
    stops,
    routesRepository([ROUTE_A, ROUTE_B]),
    allowAllPlanLimits(),
    routeGeometry,
  );
}

function makeReorderDto(stopIds: string[]): ReorderRouteStopsDto {
  const dto = new ReorderRouteStopsDto();
  dto.stop_ids = stopIds;
  return dto;
}

describe('eager geometry compute after a stop reorder', () => {
  it('schedules exactly one compute for the reordered route, and the save still answers', async () => {
    const stop1 = makeStopRecord({ id: STOP_1, sequence_number: 1 });
    const stop2 = makeStopRecord({ id: STOP_2, sequence_number: 2 });
    const stop3 = makeStopRecord({ id: STOP_3, sequence_number: 3 });
    const { repo } = stopsRepository([stop1, stop2, stop3]);
    const geometry = recordingGeometry();
    const service = makeRoutesService(repo, geometry.service);

    const response = await service.reorderRouteStops(
      SCHOOL_A,
      ROUTE_A,
      makeReorderDto([STOP_3, STOP_1, STOP_2]),
    );

    // The admin's save is unaffected by the compute.
    assert.deepEqual(
      response.items.map((stop) => stop.id),
      [STOP_3, STOP_1, STOP_2],
    );
    await flushMicrotasks();
    assert.deepEqual(geometry.calls, [{ schoolId: SCHOOL_A, routeId: ROUTE_A }]);
  });

  it('never fails the mutation when the compute throws', async () => {
    const stop1 = makeStopRecord({ id: STOP_1, sequence_number: 1 });
    const stop2 = makeStopRecord({ id: STOP_2, sequence_number: 2 });
    const { repo } = stopsRepository([stop1, stop2]);
    const geometry = recordingGeometry();
    geometry.failWith(new Error('engine is down'));
    const service = makeRoutesService(repo, geometry.service);

    const response = await service.reorderRouteStops(
      SCHOOL_A,
      ROUTE_A,
      makeReorderDto([STOP_2, STOP_1]),
    );

    assert.equal(response.items.length, 2);
    await flushMicrotasks();
    assert.equal(geometry.calls.length, 1, 'the compute was attempted and swallowed');
  });

  it('schedules nothing when routing is disabled or no geometry service is wired', async () => {
    const stop1 = makeStopRecord({ id: STOP_1, sequence_number: 1 });
    const stop2 = makeStopRecord({ id: STOP_2, sequence_number: 2 });
    const { repo } = stopsRepository([stop1, stop2]);

    const disabled = recordingGeometry({ enabled: false });
    await makeRoutesService(repo, disabled.service).reorderRouteStops(
      SCHOOL_A,
      ROUTE_A,
      makeReorderDto([STOP_2, STOP_1]),
    );
    await flushMicrotasks();
    assert.equal(disabled.calls.length, 0, 'disabled routing schedules nothing');

    const unwired = makeRoutesService(repo);
    await unwired.reorderRouteStops(SCHOOL_A, ROUTE_A, makeReorderDto([STOP_2, STOP_1]));
    await flushMicrotasks();
  });
});

describe('eager geometry compute after a stop save', () => {
  it('create schedules a compute for the stop route', async () => {
    const { repo } = stopsRepository([]);
    const geometry = recordingGeometry();
    const service = makeStopsService(repo, geometry.service);

    const dto = new CreateStopDto();
    dto.route_id = ROUTE_A;
    dto.name = 'Evening Gate';
    dto.latitude = 33.7;
    dto.longitude = 73.06;
    await service.create(SCHOOL_A, dto);

    await flushMicrotasks();
    assert.deepEqual(geometry.calls, [{ schoolId: SCHOOL_A, routeId: ROUTE_A }]);
  });

  it('update schedules a compute for the route the stop now belongs to', async () => {
    const stop = makeStopRecord({ id: STOP_1, route_id: ROUTE_A, latitude: 33.6844 });
    const { repo } = stopsRepository([stop]);
    const geometry = recordingGeometry();
    const service = makeStopsService(repo, geometry.service);

    const dto = new UpdateStopDto();
    dto.latitude = 33.69;
    await service.update(SCHOOL_A, STOP_1, dto);

    await flushMicrotasks();
    assert.deepEqual(geometry.calls, [{ schoolId: SCHOOL_A, routeId: ROUTE_A }]);
  });

  it('moving a stop to another route schedules a compute for BOTH routes', async () => {
    const stop = makeStopRecord({ id: STOP_1, route_id: ROUTE_A });
    const { repo } = stopsRepository([stop]);
    const geometry = recordingGeometry();
    const service = makeStopsService(repo, geometry.service);

    const dto = new UpdateStopDto();
    dto.route_id = ROUTE_B;
    await service.update(SCHOOL_A, STOP_1, dto);

    await flushMicrotasks();
    assert.deepEqual(geometry.calls, [
      { schoolId: SCHOOL_A, routeId: ROUTE_B },
      { schoolId: SCHOOL_A, routeId: ROUTE_A },
    ]);
  });

  it('remove schedules a compute for the route the stop left', async () => {
    const stop = makeStopRecord({ id: STOP_1, route_id: ROUTE_A });
    const { repo } = stopsRepository([stop]);
    const geometry = recordingGeometry();
    const service = makeStopsService(repo, geometry.service);

    await service.remove(SCHOOL_A, STOP_1);

    await flushMicrotasks();
    assert.deepEqual(geometry.calls, [{ schoolId: SCHOOL_A, routeId: ROUTE_A }]);
  });

  it('a failed mutation schedules nothing (no stop list changed)', async () => {
    const { repo } = stopsRepository([]);
    const geometry = recordingGeometry();
    const service = makeStopsService(repo, geometry.service);

    // The route does not exist in this school → the create is rejected.
    const dto = new CreateStopDto();
    dto.route_id = '99999999-9999-4999-8999-999999999999';
    dto.name = 'Nowhere';
    await assert.rejects(service.create(SCHOOL_A, dto));

    await flushMicrotasks();
    assert.equal(geometry.calls.length, 0);
  });
});
