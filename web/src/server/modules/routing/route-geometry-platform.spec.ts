import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  RouteGeometryLeg,
  RouteGeometryLineString,
} from '@school-bus-tracking/shared-types';
import { NotFoundException } from '../../framework';
import { Route, RouteGeometry, Stop } from '../../database/models';
import { ROUTE_NOT_FOUND_MESSAGE } from '../routes/routes.constants';
import { hashRouteStops } from './stops-hash';
import type { RoadRoute } from './osrm-response';
import type { RouteCoordinate } from './osrm.provider';
import { StoreRouteGeometryDto } from './dto/store-route-geometry.dto';
import { RouteGeometryService, type RouteGeometryProvider } from './route-geometry.service';

/**
 * The PLATFORM write surface of the geometry cache —
 * `PUT /admin/routes/:routeId/geometry` and
 * `POST /admin/routes/:routeId/geometry/recompute` — at the service level:
 *
 *  - a SUPER_ADMIN addresses a route by id alone, in ANY school; the row is
 *    stored under that route's OWN school (the caller names no school);
 *  - the cache key is pinned SERVER-SIDE from the route's current located
 *    stops, so the next school GET is a cache hit with zero engine calls;
 *  - an unknown route id answers the generic 404;
 *  - storing works with routing disabled (blank ROUTING_SERVICE_URL);
 *  - the school path keeps its tenant pin: a cross-tenant id still 404s.
 */

const SCHOOL_ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROUTE_BETA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROUTE_UNKNOWN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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

function roadRoute(): RoadRoute {
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

/** Programmable engine double; every compute is recorded. */
class StubProvider implements RouteGeometryProvider {
  readonly name = 'osrm';
  calls: RouteCoordinate[][] = [];

  async computeRoute(coordinates: readonly RouteCoordinate[]): Promise<RoadRoute | null> {
    this.calls.push([...coordinates]);
    return roadRoute();
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
  update(values: Partial<StoredRow>): Promise<StoredRow>;
}

/** In-memory `route_geometries`, honouring the live-row (route, hash) key. */
class GeometryStore {
  rows: StoredRow[] = [];

  private attach(row: StoredRow): StoredRow {
    row.update = async (values: Partial<StoredRow>) => {
      Object.assign(row, values);
      return row;
    };
    return row;
  }

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

  async create(values: Omit<StoredRow, 'update'>): Promise<StoredRow> {
    const row = this.attach({ ...values } as StoredRow);
    this.rows.push(row);
    return row;
  }

  async destroy(options: { where: { route_id: string } }): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.route_id !== options.where.route_id);
    return before - this.rows.length;
  }
}

interface Harness {
  service: RouteGeometryService;
  store: GeometryStore;
  provider: StubProvider | null;
  setStops(stops: Array<{ id: string; latitude: number | null; longitude: number | null }>): void;
}

/**
 * One route, owned by BETA, with three located stops. The routes fake
 * answers `findOne` with or without a school pin, exactly like the model
 * query the two paths issue.
 */
function makeHarness(options: { provider?: StubProvider | null } = {}): Harness {
  const route = { id: ROUTE_BETA, school_id: SCHOOL_BETA } as Route;
  const routes = {
    findOne: async (query: { where: { id: string; school_id?: string } }) => {
      if (query.where.id !== ROUTE_BETA) return null;
      if (query.where.school_id !== undefined && query.where.school_id !== SCHOOL_BETA) return null;
      return route;
    },
  } as unknown as typeof Route;

  let stopList: Array<{ id: string; latitude: number | null; longitude: number | null }> = [
    STOP_1,
    STOP_2,
    STOP_3,
  ];
  const stops = {
    findAll: async (query: { where: { route_id: string; school_id: string } }) => {
      if (query.where.route_id !== ROUTE_BETA || query.where.school_id !== SCHOOL_BETA) {
        return [];
      }
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
    store,
    provider,
    setStops(next) {
      stopList = next;
    },
  };
}

function storeBody(): StoreRouteGeometryDto {
  const dto = new StoreRouteGeometryDto();
  dto.status = 'road';
  dto.geometry = GEOMETRY;
  dto.distance_meters = 4820.5;
  dto.duration_seconds = 612.3;
  dto.legs = [];
  dto.provider = 'osrm';
  return dto;
}

/** The key the server must pin: sha256 of the route's CURRENT located stops. */
function currentHash(stops: Array<{ id: string; latitude: number; longitude: number }>): string {
  return hashRouteStops(
    stops.map((stop) => ({ stopId: stop.id, latitude: stop.latitude, longitude: stop.longitude })),
  );
}

describe('platform geometry write — storeGeometryForRoute', () => {
  it('stores under the route’s OWN school, addressed by route id alone', async () => {
    const { service, store } = makeHarness();

    const { schoolId, result } = await service.storeGeometryForRoute(ROUTE_BETA, storeBody());

    assert.equal(schoolId, SCHOOL_BETA, 'the owning school comes from the route, not the caller');
    assert.equal(result.status, 'ok');
    assert.equal(result.route_id, ROUTE_BETA);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].route_id, ROUTE_BETA);
  });

  it('pins the cache key server-side from the current located stops', async () => {
    const { service, store } = makeHarness();

    const { result } = await service.storeGeometryForRoute(ROUTE_BETA, storeBody());

    const expected = currentHash([STOP_1, STOP_2, STOP_3]);
    assert.equal(result.stops_hash, expected);
    assert.equal(store.rows[0].stops_hash, expected);
  });

  it('makes the next school GET a cache hit with zero engine calls', async () => {
    const provider = new StubProvider();
    const { service } = makeHarness({ provider });

    await service.storeGeometryForRoute(ROUTE_BETA, storeBody());
    const read = await service.getGeometry(SCHOOL_BETA, ROUTE_BETA);

    assert.equal(read.status, 'ok');
    assert.equal(provider.calls.length, 0, 'the stored row answers the read: no engine call');
  });

  it('re-keys after a stop changes: the old row stays, the new key is pinned', async () => {
    const { service, store, setStops } = makeHarness();
    await service.storeGeometryForRoute(ROUTE_BETA, storeBody());
    const oldHash = store.rows[0].stops_hash;

    setStops([
      STOP_1,
      { ...STOP_2, latitude: 33.6905 },
      STOP_3,
    ]);
    const { result } = await service.storeGeometryForRoute(ROUTE_BETA, storeBody());

    assert.notEqual(result.stops_hash, oldHash);
    assert.equal(
      result.stops_hash,
      currentHash([STOP_1, { ...STOP_2, latitude: 33.6905 }, STOP_3]),
    );
    assert.equal(store.rows.length, 2, 'rows are never mutated: the stale key is simply unused');
  });

  it('leaves out stops without coordinates when it pins the key', async () => {
    const { service, store, setStops } = makeHarness();
    setStops([STOP_1, { id: '44444444-4444-4444-8444-444444444444', latitude: null, longitude: null }, STOP_2]);

    const { result } = await service.storeGeometryForRoute(ROUTE_BETA, storeBody());

    assert.equal(result.stops_hash, currentHash([STOP_1, STOP_2]));
    assert.equal(store.rows[0].stops_hash, currentHash([STOP_1, STOP_2]));
  });

  it('answers the generic 404 for an unknown route id', async () => {
    const { service, store } = makeHarness();

    await assert.rejects(
      service.storeGeometryForRoute(ROUTE_UNKNOWN, storeBody()),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).getStatus(), 404);
        assert.ok(JSON.stringify((error as NotFoundException).getResponse()).includes(ROUTE_NOT_FOUND_MESSAGE));
        return true;
      },
    );
    assert.equal(store.rows.length, 0);
  });

  it('stores with routing DISABLED (blank ROUTING_SERVICE_URL)', async () => {
    const { service, store } = makeHarness({ provider: null });
    assert.equal(service.enabled, false);

    const { result } = await service.storeGeometryForRoute(ROUTE_BETA, storeBody());

    assert.equal(result.status, 'ok');
    assert.equal(store.rows.length, 1);
  });
});

describe('platform geometry write — recomputeGeometryForRoute', () => {
  it('drops the route’s rows and computes once under its own school', async () => {
    const provider = new StubProvider();
    const { service, store } = makeHarness({ provider });
    await service.storeGeometryForRoute(ROUTE_BETA, storeBody());
    assert.equal(store.rows.length, 1);

    const { schoolId, result } = await service.recomputeGeometryForRoute(ROUTE_BETA);

    assert.equal(schoolId, SCHOOL_BETA);
    assert.equal(provider.calls.length, 1, 'exactly one engine call for the fresh row');
    assert.equal(result.geometry.status, 'ok');
    assert.equal(store.rows.length, 1);
  });

  it('with routing disabled, drops the rows and answers the honest unavailable', async () => {
    const { service, store } = makeHarness({ provider: null });
    await service.storeGeometryForRoute(ROUTE_BETA, storeBody());

    const { result } = await service.recomputeGeometryForRoute(ROUTE_BETA);

    assert.equal(result.geometry.status, 'unavailable');
    assert.equal(store.rows.length, 0);
  });

  it('answers the generic 404 for an unknown route id', async () => {
    const { service } = makeHarness();
    await assert.rejects(service.recomputeGeometryForRoute(ROUTE_UNKNOWN), NotFoundException);
  });
});

describe('school geometry path keeps its tenant pin', () => {
  it('still answers 404 for a cross-tenant route on the school write', async () => {
    const { service, store } = makeHarness();

    await assert.rejects(
      service.storeGeometry(SCHOOL_ALPHA, ROUTE_BETA, storeBody()),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        return true;
      },
    );
    assert.equal(store.rows.length, 0);
  });

  it('still answers 404 for a cross-tenant route on the school recompute', async () => {
    const { service } = makeHarness();
    await assert.rejects(service.recomputeGeometry(SCHOOL_ALPHA, ROUTE_BETA), NotFoundException);
  });
});
