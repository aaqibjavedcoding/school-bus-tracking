import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import { TripCreateRequest, TripStatus } from '@school-bus-tracking/shared-types';

const tripBody: TripCreateRequest = {
  route_assignment_id: 'assignment-id',
  scheduled_start_at: '2026-09-01T06:30:00.000Z',
  scheduled_end_at: '2026-09-01T07:30:00.000Z',
};

describe('ApiClient trip methods', () => {
  it('uses tenant-free CRUD endpoints and forwards trip filters', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ success: true, data: { items: [], meta: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.createTrip(tripBody);
      await client.listTrips({
        page: 2,
        limit: 10,
        status: TripStatus.IN_PROGRESS,
        route_id: 'route-id',
        bus_id: 'bus-id',
        driver_id: 'driver-id',
        conductor_id: 'conductor-id',
        date: '2026-09-01',
      });
      await client.listTrips({ date_from: '2026-09-01', date_to: '2026-09-30' });
      await client.getTrip('trip-id');
      await client.updateTrip('trip-id', { scheduled_start_at: '2026-09-01T07:00:00.000Z' });
      await client.updateTripStatus('trip-id', { status: TripStatus.COMPLETED });
      await client.cancelTrip('trip-id', { cancellation_reason: 'Heavy snow' });
      await client.deleteTrip('trip-id');

      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        [
          'POST https://api.example.test/api/v1/trips',
          'GET https://api.example.test/api/v1/trips?page=2&limit=10&status=IN_PROGRESS&route_id=route-id&bus_id=bus-id&driver_id=driver-id&conductor_id=conductor-id&date=2026-09-01',
          'GET https://api.example.test/api/v1/trips?date_from=2026-09-01&date_to=2026-09-30',
          'GET https://api.example.test/api/v1/trips/trip-id',
          'PATCH https://api.example.test/api/v1/trips/trip-id',
          'PATCH https://api.example.test/api/v1/trips/trip-id/status',
          'POST https://api.example.test/api/v1/trips/trip-id/cancel',
          'DELETE https://api.example.test/api/v1/trips/trip-id',
        ],
      );
      assert.equal(requests[0].body, JSON.stringify(tripBody));
      for (const request of requests) {
        assert.ok(!request.url.includes('school_id'));
        assert.ok(!request.body?.includes('school_id'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('omits empty query strings and encodes trip ids', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.listTrips();
      await client.getTrip('trip id/1');
      assert.deepEqual(urls, [
        'https://api.example.test/api/v1/trips',
        'https://api.example.test/api/v1/trips/trip%20id%2F1',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
