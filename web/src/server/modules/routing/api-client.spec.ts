import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';

/**
 * The typed client call for `GET /routes/:id/geometry`, pinned the same way
 * the fleet/route client calls are (`modules/buses/api-client.spec.ts`):
 * fake the global fetch, assert the exact URL and verb. The geometry call is
 * read-only and tenant-free in its path — the school comes from the JWT,
 * never from a query parameter.
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
