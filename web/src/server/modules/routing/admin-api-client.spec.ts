import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type { RouteGeometryStoreRequest } from '@school-bus-tracking/shared-types';

/**
 * The typed client calls for the PLATFORM geometry surface (`/admin/routes/...`),
 * pinned the way `api-client.spec.ts` pins the school calls: fake the global
 * fetch, assert the exact URL and verb. The platform paths are tenant-free —
 * the SUPER_ADMIN addresses a route by id alone and never sends a school id.
 */

interface Captured {
  url: string;
  method: string;
}

/** Installs a fetch double that records the request and answers `data`. */
function fakeFetch(data: unknown): { captured: Captured[]; restore: () => void } {
  const captured: Captured[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    captured.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    captured,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

const STORE_BODY: RouteGeometryStoreRequest = {
  status: 'road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0613, 33.6972],
    ],
  },
  distance_meters: 4820.5,
  duration_seconds: 612.3,
  legs: [],
  provider: 'osrm',
};

const ROUTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('ApiClient listAdminMissingRouteGeometry', () => {
  it('calls GET /admin/routes/geometry/missing with page and limit', async () => {
    const fake = fakeFetch({
      items: [],
      meta: { page: 2, limit: 50, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: true },
      schools: [],
      totals: { routes_total: 0, routes_cached: 0, routes_missing: 0, routes_unlocated: 0 },
    });
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.listAdminMissingRouteGeometry({ page: 2, limit: 50 });

      assert.equal(fake.captured.length, 1);
      assert.equal(
        fake.captured[0].url,
        'https://api.example.test/api/v1/admin/routes/geometry/missing?page=2&limit=50',
      );
      assert.equal(fake.captured[0].method, 'GET');
      assert.equal(response.success, true);
    } finally {
      fake.restore();
    }
  });

  it('sends no query string when called without options', async () => {
    const fake = fakeFetch({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
      schools: [],
      totals: { routes_total: 0, routes_cached: 0, routes_missing: 0, routes_unlocated: 0 },
    });
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.listAdminMissingRouteGeometry();
      assert.equal(
        fake.captured[0].url,
        'https://api.example.test/api/v1/admin/routes/geometry/missing',
      );
    } finally {
      fake.restore();
    }
  });
});

describe('ApiClient storeAdminRouteGeometry', () => {
  it('calls PUT /admin/routes/:id/geometry with the id encoded and no school id', async () => {
    const fake = fakeFetch({
      status: 'ok',
      route_id: ROUTE_ID,
      stops_hash: 'a'.repeat(64),
      geometry: STORE_BODY.geometry,
      distance_meters: 4820.5,
      duration_seconds: 612.3,
      legs: [],
      provider: 'osrm',
      computed_at: '2026-10-08T10:00:00.000Z',
    });
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.storeAdminRouteGeometry(ROUTE_ID, STORE_BODY);

      assert.equal(
        fake.captured[0].url,
        `https://api.example.test/api/v1/admin/routes/${ROUTE_ID}/geometry`,
      );
      assert.equal(fake.captured[0].method, 'PUT');
      assert.ok(!fake.captured[0].url.includes('school'), 'the tenant never rides in the URL');
      assert.equal(response.data?.status, 'ok');
    } finally {
      fake.restore();
    }
  });
});

describe('ApiClient recomputeAdminRouteGeometry', () => {
  it('calls POST /admin/routes/:id/geometry/recompute', async () => {
    const fake = fakeFetch({
      id: ROUTE_ID,
      message: 'Cached route geometry cleared',
      geometry: { status: 'unavailable' },
    });
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.recomputeAdminRouteGeometry(ROUTE_ID);

      assert.equal(
        fake.captured[0].url,
        `https://api.example.test/api/v1/admin/routes/${ROUTE_ID}/geometry/recompute`,
      );
      assert.equal(fake.captured[0].method, 'POST');
      assert.equal(response.data?.geometry.status, 'unavailable');
    } finally {
      fake.restore();
    }
  });
});
