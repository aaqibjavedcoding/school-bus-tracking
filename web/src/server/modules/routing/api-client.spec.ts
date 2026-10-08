import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type { RouteGeometryStoreRequest } from '@school-bus-tracking/shared-types';

/**
 * The typed client calls for the route geometry surface, pinned the same way
 * the fleet/route client calls are (`modules/buses/api-client.spec.ts`):
 * fake the global fetch, assert the exact URL and verb. The geometry calls
 * are tenant-free in their path — the school comes from the JWT, never from
 * a query parameter.
 */
describe('ApiClient getRouteGeometry', () => {
  it('calls GET /routes/:id/geometry with the id encoded', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            status: 'ok',
            route_id: 'route-id',
            stops_hash: 'a'.repeat(64),
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
            computed_at: '2026-10-03T08:30:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.getRouteGeometry('route-id');

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, 'https://api.example.test/api/v1/routes/route-id/geometry');
      assert.equal(requests[0].method, 'GET');
      assert.ok(!requests[0].url.includes('school_id='), 'tenant stays in the JWT, not the URL');

      assert.equal(response.success, true);
      const data = response.data;
      assert.ok(data, 'expected a data payload');
      assert.equal(data.status, 'ok');
      if (data.status === 'ok') {
        assert.equal(data.geometry.type, 'LineString');
        assert.equal(data.provider, 'osrm');
        assert.equal(data.distance_meters, 4820.5);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('type-checks the unavailable branch of the union', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, data: { status: 'unavailable' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.getRouteGeometry('route-id');

      const data = response.data;
      assert.ok(data, 'expected a data payload');
      assert.equal(data.status, 'unavailable');
      // The unavailable branch carries no geometry fields at all.
      assert.equal('geometry' in data, false);
      assert.equal('legs' in data, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('ApiClient geometry write calls', () => {
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
    computed_at: '2026-10-08T10:00:00.000Z',
  };

  function captureRequests(): {
    requests: Array<{ url: string; method: string; body: unknown }>;
    restore: () => void;
  } {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const data = url.endsWith('/geometry/recompute')
        ? {
            id: 'route-id',
            message: 'Cached route geometry cleared',
            geometry: {
              status: 'ok',
              route_id: 'route-id',
              stops_hash: 'a'.repeat(64),
              geometry: STORE_BODY.geometry,
              distance_meters: 4820.5,
              duration_seconds: 612.3,
              legs: [],
              provider: 'osrm',
              computed_at: '2026-10-08T10:00:00.000Z',
            },
          }
        : {
            status: 'ok',
            route_id: 'route-id',
            stops_hash: 'a'.repeat(64),
            geometry: STORE_BODY.geometry,
            distance_meters: 4820.5,
            duration_seconds: 612.3,
            legs: [],
            provider: 'osrm',
            computed_at: '2026-10-08T10:00:00.000Z',
          };
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return {
      requests,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  it('storeRouteGeometry PUTs the engine result to /routes/:id/geometry', async () => {
    const { requests, restore } = captureRequests();
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.storeRouteGeometry('route-id', STORE_BODY);

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, 'https://api.example.test/api/v1/routes/route-id/geometry');
      assert.equal(requests[0].method, 'PUT');
      assert.deepEqual(requests[0].body, STORE_BODY);
      assert.ok(!requests[0].url.includes('school_id='), 'tenant stays in the JWT, not the URL');

      assert.equal(response.success, true);
      assert.equal(response.data?.status, 'ok');
      assert.equal(response.data?.stops_hash, 'a'.repeat(64));
    } finally {
      restore();
    }
  });

  it('recomputeRouteGeometry POSTs to /routes/:id/geometry/recompute with no body', async () => {
    const { requests, restore } = captureRequests();
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const response = await client.recomputeRouteGeometry('route-id');

      assert.equal(requests.length, 1);
      assert.equal(
        requests[0].url,
        'https://api.example.test/api/v1/routes/route-id/geometry/recompute',
      );
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].body, undefined, 'the recompute call sends no body');

      assert.equal(response.success, true);
      assert.equal(response.data?.id, 'route-id');
      assert.equal(response.data?.geometry.status, 'ok');
    } finally {
      restore();
    }
  });
});
