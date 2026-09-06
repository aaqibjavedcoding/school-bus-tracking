import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';

/**
 * Wire format of the dashboard stats endpoint and the `include=minimal`
 * query parameter across the list helpers.
 */
describe('ApiClient dashboard + minimal list queries', () => {
  it('calls GET /dashboard/stats without a tenant id in the URL', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            students: 1,
            buses: 2,
            routes: 3,
            active_trips: 0,
            generated_at: '2026-09-06T07:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const envelope = await client.getDashboardStats();
      assert.deepEqual(requests, [
        { url: 'https://api.example.test/api/v1/dashboard/stats', method: 'GET' },
      ]);
      assert.equal(envelope.data?.students, 1);
      assert.equal(envelope.data?.routes, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends include=minimal for every list helper that supports it', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.listStudents({ page: 1, limit: 100, include: 'minimal' });
      await client.listBuses({ include: 'minimal' });
      await client.listRoutes({ include: 'minimal' });
      await client.listStops({ include: 'minimal' });
      await client.listTrips({ include: 'minimal' });
      // Omitting the parameter keeps the historical URL untouched.
      await client.listRoutes({ page: 1 });

      assert.deepEqual(
        urls.map((url) => url.replace('https://api.example.test/api/v1', '')),
        [
          '/students?page=1&limit=100&include=minimal',
          '/buses?include=minimal',
          '/routes?include=minimal',
          '/stops?include=minimal',
          '/trips?include=minimal',
          '/routes?page=1',
        ],
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
