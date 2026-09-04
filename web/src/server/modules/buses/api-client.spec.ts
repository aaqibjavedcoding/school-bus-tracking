import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type {
  BusCreateRequest,
  RouteCreateRequest,
  RouteStopsOrderRequest,
  StopCreateRequest,
} from '@school-bus-tracking/shared-types';

const busBody: BusCreateRequest = {
  registration_number: 'ABC-1234',
  bus_number: 'BUS-01',
  capacity: 48,
};

const routeBody: RouteCreateRequest = {
  name: 'North Loop — Morning',
  code: 'NORTH-AM',
};

const stopBody: StopCreateRequest = {
  route_id: 'route-id',
  name: 'Maple St & 5th Ave',
  sequence_number: 1,
};

const orderBody: RouteStopsOrderRequest = {
  stop_ids: ['stop-1', 'stop-2'],
};

describe('ApiClient bus, route and stop methods', () => {
  it('uses tenant-free fleet and route endpoints', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.createBus(busBody);
      await client.listBuses({ page: 2, limit: 10, search: 'ABC' });
      await client.getBus('bus-id');
      await client.updateBus('bus-id', { capacity: 60 });
      await client.deleteBus('bus-id');
      await client.createRoute(routeBody);
      await client.listRoutes({ page: 1, limit: 5 });
      await client.getRoute('route-id');
      await client.updateRoute('route-id', { name: 'Renamed' });
      await client.deleteRoute('route-id');
      await client.createStop(stopBody);
      await client.listStops({ page: 1, limit: 50, route_id: 'route-id' });
      await client.getStop('stop-id');
      await client.updateStop('stop-id', { sequence_number: 2 });
      await client.deleteStop('stop-id');
      await client.listRouteStops('route-id');
      await client.reorderRouteStops('route-id', orderBody);

      assert.equal(requests[0].url, 'https://api.example.test/api/v1/buses');
      assert.equal(requests[0].method, 'POST');
      assert.ok(!requests[0].body?.includes('school_id'));
      assert.ok(requests.every((request) => !request.url.includes('school_id=')));
      assert.equal(
        requests[1].url,
        'https://api.example.test/api/v1/buses?page=2&limit=10&search=ABC',
      );
      assert.equal(requests[4].url, 'https://api.example.test/api/v1/buses/bus-id');
      assert.equal(requests[4].method, 'DELETE');
      assert.equal(requests[5].url, 'https://api.example.test/api/v1/routes');
      assert.equal(requests[9].url, 'https://api.example.test/api/v1/routes/route-id');
      assert.equal(requests[9].method, 'DELETE');
      assert.equal(requests[10].url, 'https://api.example.test/api/v1/stops');
      assert.equal(
        requests[11].url,
        'https://api.example.test/api/v1/stops?page=1&limit=50&route_id=route-id',
      );
      assert.equal(requests[15].url, 'https://api.example.test/api/v1/routes/route-id/stops');
      assert.equal(requests[15].method, 'GET');
      assert.equal(requests[16].url, 'https://api.example.test/api/v1/routes/route-id/stops');
      assert.equal(requests[16].method, 'PUT');
      assert.equal(requests[16].body, JSON.stringify(orderBody));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
