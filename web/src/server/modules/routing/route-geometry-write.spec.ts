import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UniqueConstraintError } from 'sequelize';
import type {
  RouteGeometryAvailableResponse,
  RouteGeometryLineString,
  RouteGeometryLeg,
} from '@school-bus-tracking/shared-types';
import { Route, RouteGeometry, Stop } from '../../database/models';
import {
  ROUTE_GEOMETRY_RECOMPUTE_MESSAGE,
  ROUTE_GEOMETRY_TOO_FEW_STOPS_MESSAGE,
  ROUTE_NOT_FOUND_MESSAGE,
} from '../routes/routes.constants';
import { hashRouteStops } from './stops-hash';
import type { RoadRoute } from './osrm-response';
import type { RouteCoordinate } from './osrm.provider';
import { StoreRouteGeometryDto } from './dto/store-route-geometry.dto';
import { RouteGeometryService, type RouteGeometryProvider } from './route-geometry.service';

/**
 * The WRITE half of the geometry cache: `PUT /routes/:id/geometry` (store an
 * engine-computed row, keyed by the same stops hash the read path computes)
 * and `POST /routes/:id/geometry/recompute` (drop the route's rows, then
 * compute immediately when an engine is configured).
 *
 * The pinned behaviours:
 *  - a stored row makes the very next GET a cache hit under the SAME
 *    stops_hash, with zero engine calls;
 *  - the tenant boundary is the read path's generic 404;
 *  - storing works with routing DISABLED (the backfill fills the cache of
 *    a deployment whose engine is switched off);
 *  - recompute drops the rows first, so the read after it recomputes;
 *  - with routing disabled, recompute still drops and answers the honest
 *    `unavailable`.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const STOP_1 = {
  id: '11111111-1111-4111-8111-111111111111',
  latitude: 33.6844,
  longitude: 73.0479,
};
const STOP_2 = {
  id: '22222222-2222-4222-8222-222222222222',
  latitude: 33.6901,
  longitude: 73.0551,
};
const STOP_3 = {
  id: '33333333-3333-4333-8333-333333333333',
  latitude: 33.6972,
  longitude: 73.0613,
};

const GEOMETRY: RouteGeometryLineString = {
  type: 'LineString',
  coordinates: [
    [73.0479, 33.6844],
    [73.0551, 33.6901],
    [73.0613, 33.6972],
  ],
};

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

  fail(): void {
    this.behaviour = () => Promise.resolve(null);
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
  /** Sequelize-style instance update, attached when the row enters the store. */
  update(values: Partial<StoredRow>): Promise<StoredRow>;
}

interface RowUpdate {
  row: StoredRow;
  values: Partial<StoredRow>;
}

/**
 * In-memory `route_geometries` table honouring the (route, hash) key, with
 * the update/destroy the write path needs.
 */
class GeometryStore {
  rows: StoredRow[] = [];
  creates = 0;
  updates: RowUpdate[] = [];
  destroys: Array<{ route_id: string }> = [];
  failNextCreateWith: unknown = null;
  /** Simulates the insert race: the next findOne misses, later ones hit. */
  missNextFindOne = false;

  /** Attaches the Sequelize-style instance update to a row. */
  private attach(row: StoredRow): StoredRow {
    row.update = async (values: Partial<StoredRow>) => {
      this.updates.push({ row, values });
      Object.assign(row, values);
      return row;
    };
    return row;
  }

  /** Seeds a row the way a backfill or a previous compute would have. */
  seed(row: Omit<StoredRow, 'update'>): StoredRow {
    const stored = this.attach(row as StoredRow);
    this.rows.push(stored);
    return stored;
  }

  async findOne(options: {
    where: { route_id: string; stops_hash?: string };
  }): Promise<StoredRow | null> {
    if (this.missNextFindOne) {
      this.missNextFindOne = false;
      return null;
    }
    const { route_id, stops_hash } = options.where;
    return (
      this.rows.find(
        (row) =>
          row.route_id === route_id && (stops_hash === undefined || row.stops_hash === stops_hash),
      ) ?? null
    );
  }

  async create(values: Omit<StoredRow, 'update'>): Promise<StoredRow> {
    if (this.failNextCreateWith !== null) {
      const error = this.failNextCreateWith;
      this.failNextCreateWith = null;
      throw error;
    }
    if (
      this.rows.some(
        (row) => row.route_id === values.route_id && row.stops_hash === values.stops_hash,
      )
    ) {
      throw new UniqueConstraintError({
        message: 'duplicate key value violates unique constraint',
      });
    }
    this.creates += 1;
    return this.seed(values);
  }

  async destroy(options: { where: { route_id: string } }): Promise<number> {
    this.destroys.push(options.where);
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.route_id !== options.where.route_id);
    return before - this.rows.length;
  }
}

type StopLike = { id: string; latitude: number | null; longitude: number | null };

interface Harness {
  service: RouteGeometryService;
  provider: StubProvider;
  store: GeometryStore;
  setStops(stops: StopLike[]): void;
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
  const stops = {
    findAll: async () => stopList,
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
  };
}

/** A valid DTO, as the validated request body arrives at the service. */
function makeDto(overrides: Partial<StoreRouteGeometryDto> = {}): StoreRouteGeometryDto {
  const dto = new StoreRouteGeometryDto();
  dto.status = 'road';
  dto.geometry = {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
      [73.0613, 33.6972],
    ],
  } as RouteGeometryLineString;
  dto.distance_meters = 4820.5;
  dto.duration_seconds = 612.3;
  dto.legs = [
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
      ],
    },
  ];
  dto.provider = 'osrm';
  return Object.assign(dto, overrides);
}

function hashOf(stops: Array<{ id: string; latitude: number; longitude: number }>): string {
  return hashRouteStops(
    stops.map((stop) => ({ stopId: stop.id, latitude: stop.latitude, longitude: stop.longitude })),
  );
}

/** Flush the microtask queue so fire-and-forget chains settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('RouteGeometryService.storeGeometry (PUT /routes/:id/geometry)', () => {
  it('stores the row keyed by the SAME stops hash the read path computes', async () => {
    const harness = makeHarness({});
    const dto = makeDto({ computed_at: '2026-10-08T10:00:00.000Z' });

    const stored = (await harness.service.storeGeometry(
      SCHOOL_A,
      ROUTE_ID,
      dto,
    )) as RouteGeometryAvailableResponse;

    const expectedHash = hashOf([STOP_1, STOP_2, STOP_3]);
    assert.equal(stored.status, 'ok');
    assert.equal(stored.route_id, ROUTE_ID);
    assert.equal(stored.stops_hash, expectedHash);
    assert.deepEqual(stored.geometry, GEOMETRY);
    assert.equal(stored.distance_meters, 4820.5);
    assert.equal(stored.duration_seconds, 612.3);
    assert.equal(stored.provider, 'osrm');
    assert.equal(stored.computed_at, '2026-10-08T10:00:00.000Z');

    assert.equal(harness.store.creates, 1);
    const row = harness.store.rows[0];
    assert.equal(row.route_id, ROUTE_ID);
    assert.equal(row.stops_hash, expectedHash);
    assert.equal(row.computed_at.toISOString(), '2026-10-08T10:00:00.000Z');
  });

  it('PUT-then-GET is a cache hit under the same stops_hash, with zero engine calls', async () => {
    const harness = makeHarness({});

    await harness.service.storeGeometry(SCHOOL_A, ROUTE_ID, makeDto());
    assert.equal(harness.provider.calls.length, 0, 'storing never touches the engine');

    const read = (await harness.service.getGeometry(
      SCHOOL_A,
      ROUTE_ID,
    )) as RouteGeometryAvailableResponse;

    assert.equal(read.status, 'ok');
    assert.equal(read.stops_hash, hashOf([STOP_1, STOP_2, STOP_3]));
    assert.deepEqual(read.geometry, GEOMETRY);
    assert.equal(harness.provider.calls.length, 0, 'the stored row IS the cache hit');
    assert.equal(harness.store.creates, 1, 'no second row was written');
  });

  it('answers cross-tenant and unknown ids with the shared generic 404', async () => {
    const harness = makeHarness({});
    for (const school of [SCHOOL_B, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd']) {
      await assert.rejects(
        harness.service.storeGeometry(school, ROUTE_ID, makeDto()),
        (error: unknown) => {
          const status = (error as { getStatus?: () => number }).getStatus?.();
          assert.equal(status, 404);
          assert.equal((error as Error).message, ROUTE_NOT_FOUND_MESSAGE);
          return true;
        },
      );
    }
    assert.equal(harness.store.creates, 0, 'a cross-tenant write stores nothing');
  });

  it('rejects a route with fewer than two located stops (no stop list to key on)', async () => {
    const harness = makeHarness({
      stops: [
        STOP_1,
        { id: STOP_2.id, latitude: null, longitude: null },
        { id: STOP_3.id, latitude: 33.6972, longitude: null },
      ],
    });

    await assert.rejects(
      harness.service.storeGeometry(SCHOOL_A, ROUTE_ID, makeDto()),
      (error: unknown) => {
        const status = (error as { getStatus?: () => number }).getStatus?.();
        assert.equal(status, 400);
        assert.equal((error as Error).message, ROUTE_GEOMETRY_TOO_FEW_STOPS_MESSAGE);
        return true;
      },
    );
    assert.equal(harness.store.creates, 0);
  });

  it('stores on a deployment with routing DISABLED — the backfill writes to an engine-less prod', async () => {
    const harness = makeHarness({ provider: null });
    assert.equal(harness.service.enabled, false);

    const stored = (await harness.service.storeGeometry(
      SCHOOL_A,
      ROUTE_ID,
      makeDto(),
    )) as RouteGeometryAvailableResponse;

    assert.equal(stored.status, 'ok');
    assert.equal(harness.store.creates, 1);
    // The read path still answers unavailable (no engine to compute a miss
    // with), but the stored row is there for the day an engine is enabled.
    const read = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.deepEqual(read, { status: 'unavailable' });
    assert.equal(harness.store.rows.length, 1, 'the stored row survives the disabled read');
  });

  it('upserts: a second store for the same stops updates the row in place', async () => {
    const harness = makeHarness({});

    await harness.service.storeGeometry(SCHOOL_A, ROUTE_ID, makeDto({ distance_meters: 1000 }));
    const updated = (await harness.service.storeGeometry(
      SCHOOL_A,
      ROUTE_ID,
      makeDto({ distance_meters: 2000, duration_seconds: 99 }),
    )) as RouteGeometryAvailableResponse;

    assert.equal(updated.distance_meters, 2000);
    assert.equal(updated.duration_seconds, 99);
    assert.equal(harness.store.creates, 1, 'no second row for the same stop list');
    assert.equal(harness.store.updates.length, 1, 'the live row was updated');
    assert.equal(harness.store.rows.length, 1);
    assert.equal(harness.store.rows[0].distance_meters, 2000);
  });

  it('stores a second row under a new hash when the stop list changes', async () => {
    const harness = makeHarness({});

    await harness.service.storeGeometry(SCHOOL_A, ROUTE_ID, makeDto());
    const MOVED_STOP_2 = { ...STOP_2, latitude: 33.6942 };
    harness.setStops([STOP_1, MOVED_STOP_2, STOP_3]);
    await harness.service.storeGeometry(SCHOOL_A, ROUTE_ID, makeDto());

    assert.equal(harness.store.rows.length, 2, 'one row per stop list');
    assert.equal(harness.store.rows[1].stops_hash, hashOf([STOP_1, MOVED_STOP_2, STOP_3]));
  });

  it('serves the winner row when a concurrent process won the insert race', async () => {
    const harness = makeHarness({});
    const stopsHash = hashOf([STOP_1, STOP_2, STOP_3]);
    // Another worker inserted between our cache-miss read and our insert.
    harness.store.seed({
      route_id: ROUTE_ID,
      stops_hash: stopsHash,
      geometry: GEOMETRY,
      distance_meters: 1,
      duration_seconds: 2,
      legs: [],
      provider: 'osrm',
      computed_at: new Date('2026-10-03T09:00:00.000Z'),
    });
    harness.store.missNextFindOne = true;
    harness.store.failNextCreateWith = new UniqueConstraintError({
      message: 'duplicate key value violates unique constraint',
    });

    const stored = (await harness.service.storeGeometry(
      SCHOOL_A,
      ROUTE_ID,
      makeDto(),
    )) as RouteGeometryAvailableResponse;

    assert.equal(stored.status, 'ok');
    assert.equal(stored.distance_meters, 1, 'the winner row is served, not the loser write');
    assert.equal(harness.store.creates, 0, 'the losing insert never landed');
  });
});

describe('RouteGeometryService.recomputeGeometry (POST /routes/:id/geometry/recompute)', () => {
  it('drops the route rows, then computes immediately when an engine is configured', async () => {
    const harness = makeHarness({});
    await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.equal(harness.store.rows.length, 1, 'a cached row exists before the recompute');
    assert.equal(harness.provider.calls.length, 1);

    const result = await harness.service.recomputeGeometry(SCHOOL_A, ROUTE_ID);

    assert.deepEqual(
      harness.store.destroys,
      [{ route_id: ROUTE_ID }],
      'the cached rows were dropped',
    );
    assert.equal(result.id, ROUTE_ID);
    assert.equal(result.message, ROUTE_GEOMETRY_RECOMPUTE_MESSAGE);
    assert.equal(result.geometry.status, 'ok', 'a fresh row was computed right away');
    assert.equal(harness.provider.calls.length, 2, 'exactly one engine call for the recompute');
    assert.equal(harness.store.rows.length, 1, 'a fresh row replaced the dropped one');
    assert.equal(
      (result.geometry as RouteGeometryAvailableResponse).stops_hash,
      hashOf([STOP_1, STOP_2, STOP_3]),
    );
  });

  it('still drops the rows and answers unavailable when routing is disabled', async () => {
    const harness = makeHarness({ provider: null });
    // Seed a row directly (a backfill wrote it while the engine was up).
    harness.store.seed({
      route_id: ROUTE_ID,
      stops_hash: hashOf([STOP_1, STOP_2, STOP_3]),
      geometry: GEOMETRY,
      distance_meters: 4820.5,
      duration_seconds: 612.3,
      legs: [],
      provider: 'osrm',
      computed_at: new Date('2026-10-03T09:00:00.000Z'),
    });

    const result = await harness.service.recomputeGeometry(SCHOOL_A, ROUTE_ID);

    assert.deepEqual(harness.store.destroys, [{ route_id: ROUTE_ID }]);
    assert.equal(harness.store.rows.length, 0, 'the stale rows are gone');
    assert.deepEqual(result.geometry, { status: 'unavailable' }, 'the honest disabled answer');
    assert.equal(harness.provider.calls.length, 0, 'no engine is ever contacted');
  });

  it('answers the shared generic 404 for cross-tenant and unknown ids', async () => {
    const harness = makeHarness({});
    for (const school of [SCHOOL_B, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd']) {
      await assert.rejects(
        harness.service.recomputeGeometry(school, ROUTE_ID),
        (error: unknown) => {
          const status = (error as { getStatus?: () => number }).getStatus?.();
          assert.equal(status, 404);
          assert.equal((error as Error).message, ROUTE_NOT_FOUND_MESSAGE);
          return true;
        },
      );
    }
    assert.equal(harness.store.destroys.length, 0, 'a cross-tenant recompute drops nothing');
  });

  it('a recompute while a compute is in flight still settles on a fresh row', async () => {
    const harness = makeHarness({});
    await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.equal(harness.store.rows.length, 1);

    // Engine fails during the recompute: the drop is NOT a cached failure —
    // the next read retries the engine (the never-cache-a-failure rule).
    harness.provider.fail();
    const failed = await harness.service.recomputeGeometry(SCHOOL_A, ROUTE_ID);
    assert.deepEqual(failed.geometry, { status: 'unavailable' });
    assert.equal(harness.store.rows.length, 0);

    const retried = await harness.service.getGeometry(SCHOOL_A, ROUTE_ID);
    assert.deepEqual(retried, { status: 'unavailable' }, 'a failure is never cached');
    await flushMicrotasks();
  });
});

describe('RouteGeometryService.enabled', () => {
  it('is true with a provider and false without (routing disabled)', () => {
    assert.equal(makeHarness({}).service.enabled, true);
    assert.equal(makeHarness({ provider: null }).service.enabled, false);
  });
});
