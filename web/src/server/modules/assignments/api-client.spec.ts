import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import {
  RouteAssignmentCreateRequest,
  RouteAssignmentRole,
} from '@school-bus-tracking/shared-types';

const assignmentBody: RouteAssignmentCreateRequest = {
  route_id: 'route-id',
  bus_id: 'bus-id',
  user_id: 'driver-id',
  role: RouteAssignmentRole.DRIVER,
  effective_from: '2026-08-27',
};

describe('ApiClient route assignment methods', () => {
  it('uses tenant-free CRUD endpoints and forwards assignment filters', async () => {
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
      await client.createRouteAssignment(assignmentBody);
      await client.listRouteAssignments({
        page: 2,
        limit: 10,
        route_id: 'route-id',
        bus_id: 'bus-id',
        user_id: 'driver-id',
        role: RouteAssignmentRole.DRIVER,
        is_active: true,
      });
      await client.getRouteAssignment('assignment-id');
      await client.updateRouteAssignment('assignment-id', { effective_to: '2026-12-31' });
      await client.deleteRouteAssignment('assignment-id');

      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        [
          'POST https://api.example.test/api/v1/route-assignments',
          'GET https://api.example.test/api/v1/route-assignments?page=2&limit=10&route_id=route-id&bus_id=bus-id&user_id=driver-id&role=DRIVER&is_active=true',
          'GET https://api.example.test/api/v1/route-assignments/assignment-id',
          'PATCH https://api.example.test/api/v1/route-assignments/assignment-id',
          'DELETE https://api.example.test/api/v1/route-assignments/assignment-id',
        ],
      );
      assert.equal(requests[0].body, JSON.stringify(assignmentBody));
      for (const request of requests) {
        assert.ok(!request.url.includes('school_id'));
        assert.ok(!request.body?.includes('school_id'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps short assignment aliases pointed at the same resource', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.createAssignment(assignmentBody);
      await client.getAssignment('assignment-id');
      assert.deepEqual(urls, [
        'https://api.example.test/api/v1/assignments',
        'https://api.example.test/api/v1/assignments/assignment-id',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
