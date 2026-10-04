import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RouteGeometryLineString } from '@school-bus-tracking/shared-types';

import {
  createRoadGeometryLoader,
  normalizeRoadGeometry,
  roadGeometryCacheKey,
  roadGeometryFromResponse,
  type RoadGeometryLoaderDeps,
} from './route-geometry-core.ts';

/**
 * The road-geometry cache's decisions, pinned — the same split as
 * `queue-core.spec.ts`: everything here is pure, so AsyncStorage and the
 * API client never need to load for these tests.
 *
 * The load the driver depends on: one fetch per trip, the persisted copy
 * when signal is lost, and never a mangled payload drawn as a road.
 */

const geometry: RouteGeometryLineString = {
  type: 'LineString',
  coordinates: [
    [72.85, 19.05],
    [72.855, 19.055],
    [72.86, 19.06],
    [72.87, 19.07],
  ],
};

describe('roadGeometryCacheKey — one stored geometry per route', () => {
  it('keys by route id, stably and safely', () => {
    assert.equal(roadGeometryCacheKey('route-1'), '@sbt/route-geometry/route-1');
    assert.equal(roadGeometryCacheKey('route-1'), roadGeometryCacheKey('route-1'));
    assert.equal(roadGeometryCacheKey('a/b'), '@sbt/route-geometry/a%2Fb');
  });

  it('never collides across routes', () => {
    assert.notEqual(roadGeometryCacheKey('route-1'), roadGeometryCacheKey('route-2'));
  });
});

describe('normalizeRoadGeometry — an untrusted value as a road geometry', () => {
  it('accepts a valid LineString payload unchanged', () => {
    assert.deepEqual(normalizeRoadGeometry(geometry), geometry);
  });

  it('drops coordinates that fail isValidCoordinate instead of drawing them', () => {
    const mangled: unknown = {
      type: 'LineString',
      coordinates: [[Number.NaN, 19.04], ...geometry.coordinates, [72.9, 91], 'not-a-point'],
    };
    assert.deepEqual(normalizeRoadGeometry(mangled), geometry);
  });

  it('refuses anything with fewer than two usable coordinates', () => {
    assert.equal(normalizeRoadGeometry({ type: 'LineString', coordinates: [] }), null);
    assert.equal(
      normalizeRoadGeometry({ type: 'LineString', coordinates: [[72.85, 19.05]] }),
      null,
    );
    assert.equal(
      normalizeRoadGeometry({
        type: 'LineString',
        coordinates: [
          [Number.NaN, 19.05],
          [91, 19.06],
        ],
      }),
      null,
    );
  });

  it('refuses non-geometries outright', () => {
    assert.equal(normalizeRoadGeometry(null), null);
    assert.equal(normalizeRoadGeometry(undefined), null);
    assert.equal(normalizeRoadGeometry('LineString'), null);
    assert.equal(normalizeRoadGeometry({ type: 'Point', coordinates: [72.85, 19.05] }), null);
    assert.equal(normalizeRoadGeometry({ type: 'LineString' }), null);
    // A parsed AsyncStorage row that is not a usable geometry must degrade
    // to "no geometry", never crash the map.
    assert.equal(normalizeRoadGeometry(JSON.parse('{"coordinates":[[72.85,19.05]]}')), null);
  });
});

describe('roadGeometryFromResponse — the /routes/:id/geometry payload', () => {
  it('returns the geometry of an ok payload, validated', () => {
    const payload = { status: 'ok', route_id: 'route-1', geometry, provider: 'osrm' };
    assert.deepEqual(roadGeometryFromResponse(payload), geometry);
  });

  it('refuses an ok payload whose geometry is unusable', () => {
    assert.equal(roadGeometryFromResponse({ status: 'ok', geometry: null }), null);
    assert.equal(
      roadGeometryFromResponse({ status: 'ok', geometry: { type: 'LineString', coordinates: [] } }),
      null,
    );
  });

  it("treats 'unavailable' as no geometry, not an error", () => {
    assert.equal(roadGeometryFromResponse({ status: 'unavailable' }), null);
  });

  it('refuses null, garbage and unknown statuses', () => {
    assert.equal(roadGeometryFromResponse(null), null);
    assert.equal(roadGeometryFromResponse(undefined), null);
    assert.equal(roadGeometryFromResponse('ok'), null);
    assert.equal(roadGeometryFromResponse({ status: 'pending' }), null);
  });
});

describe('createRoadGeometryLoader — one fetch per trip, the cache offline', () => {
  interface Harness {
    loader: ReturnType<typeof createRoadGeometryLoader>;
    fetches: number;
    writes: Array<{ routeId: string; geometry: RouteGeometryLineString }>;
    cache: Map<string, RouteGeometryLineString>;
    failFetches: boolean;
  }

  function harness(overrides: Partial<RoadGeometryLoaderDeps> = {}): Harness {
    const state: Harness = {
      loader: null as unknown as Harness['loader'],
      fetches: 0,
      writes: [],
      cache: new Map(),
      failFetches: false,
    };
    state.loader = createRoadGeometryLoader({
      fetchGeometry: async () => {
        state.fetches += 1;
        if (state.failFetches) throw new Error('Network request failed');
        return { status: 'ok', route_id: 'route-1', geometry };
      },
      readCache: async (routeId) => state.cache.get(routeId) ?? null,
      writeCache: async (routeId, value) => {
        state.writes.push({ routeId, geometry: value });
        state.cache.set(routeId, value);
      },
      ...overrides,
    });
    return state;
  }

  it('returns the fetched geometry and persists it for the offline case', async () => {
    const state = harness();
    const loaded = await state.loader.load('trip-1', 'route-1');
    assert.deepEqual(loaded, geometry);
    assert.deepEqual(state.writes, [{ routeId: 'route-1', geometry }]);
  });

  it('fetches once per trip — remounts and next-stop changes never refetch', async () => {
    const state = harness();
    await state.loader.load('trip-1', 'route-1');
    await state.loader.load('trip-1', 'route-1');
    await state.loader.load('trip-1', 'route-1');
    assert.equal(state.fetches, 1);
    assert.equal(state.writes.length, 1);
  });

  it('refetches for the next trip on the same route', async () => {
    const state = harness();
    await state.loader.load('trip-1', 'route-1');
    await state.loader.load('trip-2', 'route-1');
    assert.equal(state.fetches, 2);
  });

  it('shares one in-flight fetch between concurrent loads of a trip', async () => {
    const state = harness();
    const [a, b] = await Promise.all([
      state.loader.load('trip-1', 'route-1'),
      state.loader.load('trip-1', 'route-1'),
    ]);
    assert.deepEqual(a, geometry);
    assert.deepEqual(b, geometry);
    assert.equal(state.fetches, 1);
  });

  it("memoises 'unavailable' for the trip without touching the cache", async () => {
    let fetches = 0;
    const state = harness({
      fetchGeometry: async () => {
        fetches += 1;
        return { status: 'unavailable' };
      },
    });
    assert.equal(await state.loader.load('trip-1', 'route-1'), null);
    assert.equal(await state.loader.load('trip-1', 'route-1'), null);
    assert.equal(fetches, 1);
    assert.equal(state.writes.length, 0);
  });

  it('falls back to the persisted copy when the fetch fails (signal lost)', async () => {
    const state = harness();
    await state.loader.load('trip-1', 'route-1'); // online: fetch + persist
    state.failFetches = true;
    // The same trip answers from memory; a NEW trip in the dead zone reads
    // the copy the earlier fetch persisted — the line survives the signal.
    assert.deepEqual(await state.loader.load('trip-1', 'route-1'), geometry);
    assert.deepEqual(await state.loader.load('trip-2', 'route-1'), geometry);
    assert.equal(state.fetches, 2);
  });

  it('a failed fetch is not an answer: the next load tries the network again', async () => {
    const state = harness();
    state.failFetches = true;
    assert.equal(await state.loader.load('trip-1', 'route-1'), null); // offline, nothing cached
    state.failFetches = false;
    assert.deepEqual(await state.loader.load('trip-1', 'route-1'), geometry);
    assert.equal(state.fetches, 2);
  });

  it('answers null offline when no copy was ever persisted', async () => {
    const state = harness();
    state.failFetches = true;
    assert.equal(await state.loader.load('trip-1', 'route-1'), null);
    assert.equal(state.writes.length, 0);
  });

  it('a failed cache write never loses the load', async () => {
    const state = harness({
      writeCache: async () => {
        throw new Error('disk full');
      },
    });
    const loaded = await state.loader.load('trip-1', 'route-1');
    assert.deepEqual(loaded, geometry);
  });
});
