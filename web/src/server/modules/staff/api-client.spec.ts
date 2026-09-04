import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type { DriverCreateRequest } from '@school-bus-tracking/shared-types';

const driverBody: DriverCreateRequest = {
  first_name: 'Dana',
  last_name: 'Driver',
  email: 'driver@example.org',
  password: 'correct-horse-battery',
};

const conductorBody: DriverCreateRequest = {
  first_name: 'Carl',
  last_name: 'Conductor',
  email: 'conductor@example.org',
  password: 'correct-horse-battery',
};

describe('ApiClient driver and conductor methods', () => {
  it('uses tenant-free, role-pinned staff endpoints', async () => {
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
      await client.createDriver(driverBody);
      await client.listDrivers({ page: 2, limit: 10, search: 'Dana' });
      await client.getDriver('driver-id');
      await client.updateDriver('driver-id', { phone: '+1 555 0100' });
      await client.deleteDriver('driver-id');
      await client.createConductor(conductorBody);
      await client.listConductors({ limit: 5 });
      await client.getConductor('conductor-id');
      await client.updateConductor('conductor-id', { is_active: false });
      await client.deleteConductor('conductor-id');

      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        [
          'POST https://api.example.test/api/v1/drivers',
          'GET https://api.example.test/api/v1/drivers?page=2&limit=10&search=Dana',
          'GET https://api.example.test/api/v1/drivers/driver-id',
          'PATCH https://api.example.test/api/v1/drivers/driver-id',
          'DELETE https://api.example.test/api/v1/drivers/driver-id',
          'POST https://api.example.test/api/v1/conductors',
          'GET https://api.example.test/api/v1/conductors?limit=5',
          'GET https://api.example.test/api/v1/conductors/conductor-id',
          'PATCH https://api.example.test/api/v1/conductors/conductor-id',
          'DELETE https://api.example.test/api/v1/conductors/conductor-id',
        ],
      );

      // No tenant or role information may ever travel from the client.
      for (const request of requests) {
        assert.ok(!request.url.includes('school_id'));
        if (request.body) {
          assert.ok(!request.body.includes('school_id'));
          assert.ok(!request.body.includes('"role"'));
          assert.ok(!request.body.includes('password_hash'));
        }
      }
      assert.equal(requests[0].method, 'POST');
      assert.ok(requests[0].body?.includes('driver@example.org'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
