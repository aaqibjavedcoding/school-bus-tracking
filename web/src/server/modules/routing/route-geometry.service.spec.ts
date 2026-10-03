import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UniqueConstraintError } from 'sequelize';
import type {
  RouteGeometryAvailableResponse,
  RouteGeometryLineString,
  RouteGeometryLeg,
} from '@school-bus-tracking/shared-types';
import { Route, RouteGeometry, Stop } from '../../database/models';
import { ROUTE_NOT_FOUND_MESSAGE } from '../routes/routes.constants';
import { hashRouteStops } from './stops-hash';
import type { RoadRoute } from './osrm-response';
import type { RouteCoordinate } from './osrm.provider';
import { RouteGeometryService, type RouteGeometryProvider } from './route-geometry.service';

/**
 * The service is where "compute once, cache forever, zero running cost" is
 * actually enforced, so those are exactly the pinned behaviours: a hit
 * costs zero engine calls; a miss costs at most one (concurrent readers
 * join the same flight); a failure is never written down, so the next
 * reader simply tries again; and the tenant boundary is the same generic
 * 404 `GET /routes/:id` gives.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const STOP_1 = { id: '11111111-1111-4111-8111-111111111111', latitude: 33.6844, longitude: 73.0479 };
const STOP_2 = { id: '22222222-2222-4222-8222-222222222222', latitude: 33.6901, longitude: 73.0551 };
const STOP_3 = { id: '33333333-3333-4333-8333-333333333333', latitude: 33.6972, longitude: 73.0613 };

const GEOMETRY: RouteGeometryLineString = {
  type: 'LineString',
  coordinates: [
    [73.0479, 33.6844],
    [73.0551, 33.6901],
    [73.0613, 33.6972],
  ],
};

/** Flush the microtask queue: every stub resolves via promises, so two macrotask hops settle any chain of them. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function sampleRoadRoute(): RoadRoute {
  return {
    geometry: GEOMETRY,
    distanceMeters: 4820.5,
    durationSeconds: 612.3,
    legs: [
      {
        distanceMeters: 2410.2,
        durationSeconds: 300.1,
        maneuvers: [
          {
            type: 'depart',
            modifier: null,
            roadName: 'Margalla Road',
            distanceMeters: 120.4,
            location: [73.0479, 33.6844],
          },
          {
            type: 'turn',
            modifier: 'left',
            roadName: '7th Avenue',
            distanceMeters: 2289.8,
            location: [73.0551, 33.6901],
          },
        ],
      },
      {
        distanceMeters: 2410.3,
        durationSeconds: 312.2,
        maneuvers: [
          {
            type: 'arrive',
            modifier: null,
            roadName: 'Kashmir Highway',
            distanceMeters: 2410.3,
            location: [73.0613, 33.6972],
          },
        ],
      },
    ],
  };
}

/** Programmable engine double; every call is recorded. */
class StubProvider implements RouteGeometryProvider {
  readonly name = 'osrm';
  calls: RouteCoordinate[][] = [];
  private behaviour: (coords: RouteCoordinate[]) => Promise<RoadRoute | null> = () =>
    Promise.resolve(sampleRoadRoute());

  succeedWith(route: RoadRoute | null): void {
    this.behaviour = () => Promise.resolve(route);
  }

  fail(): void {
    this.behaviour = () => Promise.resolve(null);
  }

  /** Hands out manual control of the response, opening the single-flight window. */
  pending(): { resolve: (route: RoadRoute | null) => void } {
    let resolvePromise: (route: RoadRoute | null) => void = () => undefined;
    this.behaviour = () =>
      new Promise<RoadRoute | null>((resolve) => {
        resolvePromise = resolve;
      });
    return {
      resolve: (route) => {
        resolvePromise(route);
      },
    };
  }

  async computeRoute(coordinates: readonly RouteCoordinate[]): Promise<RoadRoute | null> {
    this.calls.push([...coordinates]);
    return this.behaviour([...coordinates]);
  }
}

interface StoredRow {
  route_id: string;
  stops_hash: string;
  geometry: RouteGeometryLineString;
  distance_meters: number;
  duration_seconds: number;
  legs: RouteGeometryLeg[];
  provider: string;
  computed_at: Date;
}

/** In-memory `route_geometries` table, honouring the (route, hash) key. */
class GeometryStore {
  rows: StoredRow[] = [];
  creates = 0;
  failNextCreateWith: unknown = null;

  async findOne(options: {
    where: { route_id: string; stops_hash?: string };
  }): Promise<StoredRow | null> {
    const { route_id, stops_hash } = options.where;
    return (
      this.rows.find(
        (row) =>
          row.route_id === route_id && (stops_hash === undefined || row.stops_hash === stops_hash),
      ) ?? null
    );
  }

  async create(values: StoredRow): Promise<StoredRow> {
    if (this.failNextCreateWith !== null) {
      const error = this.failNextCreateWith;
      this.failNextCreateWith = null;
      throw error;
    }
    this.creates += 1;
    this.rows.push(values);
    return values;
  }
}

type StopLike = { id: string; latitude: number | null; longitude: number | null };

interface Harness {
  service: RouteGeometryService;
  provider: StubProvider;
  store: GeometryStore;
  setStops(stops: StopLike[]): void;
  stopQueries(): number;
}

function makeHarness(options: {
  stops?: StopLike[];
  provider?: StubProvider | null;
  knownRouteSchools?: string[];
}): Harness {
  const route = { id: ROUTE_ID, school_id: SCHOOL_A } as Route;
  const knownSchools = new Set(options.knownRouteSchools ?? [SCHOOL_A]);
  const routes = {
    findOne: async (query: { where: { id: string; school_id: string } }) =>
      query.where.id === ROUTE_ID && knownSchools.has(query.where.school_id) ? route : null,
  } as unknown as typeof Route;

  let stopList: StopLike[] = options.stops ?? [STOP_1, STOP_2, STOP_3];
  let stopQueries = 0;
  const stops = {
    findAll: async () => {
      stopQueries += 1;
      return stopList;
    },
  } as unknown as typeof Stop;

  const provider = options.provider === undefined ? new StubProvider() : options.provider;
  const store = new GeometryStore();
  const service = new RouteGeometryService(
    routes,
    stops,
    store as unknown as typeof RouteGeometry,
    provider,
  );
  return {
    service,
    provider: provider ?? new StubProvider(),
    store,
    setStops(stops: StopLike[]) {
      stopList = stops;
    },
    stopQueries() {
      return stopQueries;
    },
  };
}

function hashOf(stops: Array<{ id: string; latitude: number; longitude: number }>): string {
  return hashRouteStops(
    stops.map((stop) => ({ stopId: stop.id, latitude: stop.latitude, longitude: stop.longitude })),
  );
}

describe('RouteGeometryService', () => {
  it('answers cross-tenant and unknown ids with the shared generic 404', async () => {
    const { service } = makeHarness({});
    for (const school of [SCHOOL_B, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd']) {
      await assert.rejects(service.getGeometry(school, ROUTE_ID), (error: unknown) => {
        const status = (error as { getStatus?: () => number }).getStatus?.();
        assert.equal(status, 404);
        assert.equal((error as Error).message, ROUTE_NOT_FOUND_MESSAGE);
        return true;
      });
    }
    // A tenant that legitimately owns the route passes the gate.
    const owned = await service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.equal(owned.status, 'ok');
  });

  it('returns unavailable with zero engine AND zero stop work when routing is disabled', async () => {
    const harness = makeHarness({ provider: null });
    const result = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);

    assert.deepEqual(result, { status: 'unavailable' });
    assert.equal(harness.stopQueries(), 0, 'disabled must short-circuit before loading stops');
    assert.equal(harness.provider.calls.length, 0, 'disabled must never touch the engine');
    assert.equal(harness.store.creates, 0, 'unavailable is never written to the cache');
  });

  it('returns unavailable when fewer than two stops are located', async () => {
    const harness = makeHarness({
      stops: [
        STOP_1,
        { id: STOP_2.id, latitude: null, longitude: null },
        { id: STOP_3.id, latitude: 33.6972, longitude: null },
      ],
    });
    const result = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);

    assert.deepEqual(result, { status: 'unavailable' });
    assert.equal(harness.provider.calls.length, 0, 'nothing to route — no engine call');
    assert.equal(harness.store.creates, 0);
  });

  it('serves a cache hit verbatim — no engine call, no reshaping', async () => {
    const harness = makeHarness({});
    const stopsHash = hashOf([STOP_1, STOP_2, STOP_3]);
    harness.store.rows.push({
      route_id: ROUTE_ID,
      stops_hash: stopsHash,
      geometry: GEOMETRY,
      distance_meters: 9012.5,
      duration_seconds: 1200,
      legs: [],
      provider: 'osrm',
      computed_at: new Date('2026-10-03T08:30:00.000Z'),
    });

    const result = (await harness.service.getGeometry(
      SCHOOL_A,
      ROUTE_ID,
    )) as RouteGeometryAvailableResponse;

    assert.equal(result.status, 'ok');
    assert.deepEqual(result, {
      status: 'ok',
      route_id: ROUTE_ID,
      stops_hash: stopsHash,
      geometry: GEOMETRY,
      distance_meters: 9012.5,
      duration_seconds: 1200,
      legs: [],
      provider: 'osrm',
      computed_at: '2026-10-03T08:30:00.000Z',
    });
    assert.equal(harness.provider.calls.length, 0, 'a hit must never touch the engine');
    assert.equal(harness.store.creates, 0);
  });

  it('computes on a miss, stores the row in wire vocabulary and serves it', async () => {
    const harness = makeHarness({});
    const result = (await harness.service.getGeometry(
      SCHOOL_A,
      ROUTE_ID,
    )) as RouteGeometryAvailableResponse;

    // One engine call, with OSRM-ordered [lng, lat] coordinates in stop order.
    assert.equal(harness.provider.calls.length, 1);
    assert.deepEqual(harness.provider.calls[0], [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
      [73.0613, 33.6972],
    ]);

    // One cache insert, already in the served (snake_case) vocabulary.
    assert.equal(harness.store.creates, 1);
    const row = harness.store.rows[0];
    assert.equal(row.route_id, ROUTE_ID);
    assert.equal(row.stops_hash, hashOf([STOP_1, STOP_2, STOP_3]));
    assert.equal(row.provider, 'osrm');
    assert.deepEqual(row.geometry, GEOMETRY);
    assert.equal(row.distance_meters, 4820.5);
    assert.equal(row.duration_seconds, 612.3);
    assert.deepEqual(row.legs, [
      {
        distance_meters: 2410.2,
        duration_seconds: 300.1,
        maneuvers: [
          {
            type: 'depart',
            modifier: null,
            road_name: 'Margalla Road',
            distance_meters: 120.4,
            location: [73.0479, 33.6844],
          },
          {
            type: 'turn',
            modifier: 'left',
            road_name: '7th Avenue',
            distance_meters: 2289.8,
            location: [73.0551, 33.6901],
          },
        ],
      },
      {
        distance_meters: 2410.3,
        duration_seconds: 312.2,
        maneuvers: [
          {
            type: 'arrive',
            modifier: null,
            road_name: 'Kashmir Highway',
            distance_meters: 2410.3,
            location: [73.0613, 33.6972],
          },
        ],
      },
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.provider, 'osrm');
    assert.equal(result.stops_hash, row.stops_hash);
    assert.deepEqual(result.legs, row.legs);
    assert.match(result.computed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('single-flight: concurrent readers share ONE engine call and ONE insert', async () => {
    const harness = makeHarness({});
    const gate = harness.provider.pending();

    const first = harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    const second = harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    const third = harness.service.getGeometry(SCHOOL_A, ROUTE_ID);

    // All three readers are parked on the same in-flight compute.
    await flushMicrotasks();
    assert.equal(harness.provider.calls.length, 1);

    gate.resolve(sampleRoadRoute());
    const results = await Promise.all([first, second, third]);

    assert.ok(results.every((result) => result.status === 'ok'));
    assert.equal(harness.provider.calls.length, 1, 'no second engine call for the same stops');
    assert.equal(harness.store.creates, 1, 'exactly one cache row written');
    assert.equal(harness.store.rows.length, 1);
  });

  it('never caches a failure: provider null means unavailable, and the next read retries', async () => {
    const harness = makeHarness({});
    harness.provider.fail();

    const failed = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.deepEqual(failed, { status: 'unavailable' });
    assert.equal(harness.store.creates, 0, 'a failure must not become a row');
    assert.equal(harness.store.rows.length, 0);

    // Engine recovers: the very next read computes and caches normally.
    harness.provider.succeedWith(sampleRoadRoute());
    const recovered = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.equal(recovered.status, 'ok');
    assert.equal(harness.provider.calls.length, 2, 'the miss retried the engine');
    assert.equal(harness.store.creates, 1);
  });

  it('recomputes only when the stop list actually changes', async () => {
    const harness = makeHarness({});
    const first = (await harness.service.getGeometry(
      SCHOOL_A,
      ROUTE_ID,
    )) as RouteGeometryAvailableResponse;
    const second = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.equal(first.status, 'ok');
    assert.equal(second.status, 'ok');
    assert.equal(harness.provider.calls.length, 1, 'unchanged stops stay a forever hit');

    // A surveyed stop moved → new hash → exactly one more engine call.
    const MOVED_STOP_2 = { ...STOP_2, latitude: 33.6942 };
    harness.setStops([STOP_1, MOVED_STOP_2, STOP_3]);
    const third = (await harness.service.getGeometry(
      SCHOOL_A,
      ROUTE_ID,
    )) as RouteGeometryAvailableResponse;

    assert.equal(third.status, 'ok');
    assert.notEqual(third.stops_hash, first.stops_hash);
    assert.equal(harness.provider.calls.length, 2);
    assert.equal(harness.store.creates, 2, 'one row per stop list, old rows untouched');
  });

  it('routes through located stops only, in manifest order', async () => {
    const UNSURVEYED = { id: '99999999-9999-4999-8999-999999999999', latitude: null, longitude: null };
    const harness = makeHarness({ stops: [STOP_1, UNSURVEYED, STOP_2] });

    const result = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.equal(result.status, 'ok');
    assert.deepEqual(harness.provider.calls[0], [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
    ]);
    assert.equal(harness.store.rows[0].stops_hash, hashOf([STOP_1, STOP_2]));
  });

  it('serves the winner row when a concurrent process won the insert race', async () => {
    const harness = makeHarness({});
    const stopsHash = hashOf([STOP_1, STOP_2, STOP_3]);
    const winnerGeometry: RouteGeometryLineString = {
      type: 'LineString',
      coordinates: [
        [73.0479, 33.6844],
        [73.0613, 33.6972],
      ],
    };
    // Another worker inserted between our cache-miss read and our insert.
    harness.store.failNextCreateWith = new UniqueConstraintError({
      message: 'duplicate key value violates unique constraint',
    });
    harness.store.rows.push({
      route_id: ROUTE_ID,
      stops_hash: stopsHash,
      geometry: winnerGeometry,
      distance_meters: 1,
      duration_seconds: 2,
      legs: [],
      provider: 'osrm',
      computed_at: new Date('2026-10-03T09:00:00.000Z'),
    });

    const result = (await harness.service.getGeometry(
      SCHOOL_A,
      ROUTE_ID,
    )) as RouteGeometryAvailableResponse;
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.geometry, winnerGeometry);
    assert.equal(result.computed_at, '2026-10-03T09:00:00.000Z');
  });
});
