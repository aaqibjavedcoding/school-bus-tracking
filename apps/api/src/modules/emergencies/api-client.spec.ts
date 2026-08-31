import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import { EmergencyStatus, EmergencyType } from '@school-bus-tracking/shared-types';

describe('ApiClient emergency / SOS methods', () => {
  it('uses tenant-free emergency endpoints', async () => {
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

      await client.raiseSos({ type: EmergencyType.ACCIDENT, message: 'Bus hit a divider' });
      await client.listMyEmergencies({ status: EmergencyStatus.OPEN });
      await client.cancelMyEmergency('event-1');
      await client.listActiveEmergencies();
      await client.listEmergencies({ type: EmergencyType.MEDICAL, date_from: '2026-08-01' });
      await client.getEmergency('event-1');
      await client.updateEmergencyStatus('event-1', {
        status: EmergencyStatus.ACKNOWLEDGED,
        note: 'Van dispatched',
      });

      assert.equal(requests[0].url, 'https://api.example.test/api/v1/emergencies/sos');
      assert.equal(requests[0].method, 'POST');
      // No tenant, no bus, no timestamp: all of those are server-owned.
      assert.ok(!requests[0].body?.includes('school_id'));
      assert.ok(!requests[0].body?.includes('triggered_at'));

      assert.equal(requests[1].url, 'https://api.example.test/api/v1/emergencies/mine?status=OPEN');
      assert.equal(requests[2].url, 'https://api.example.test/api/v1/emergencies/event-1/cancel');
      assert.equal(requests[2].method, 'PATCH');
      assert.equal(requests[3].url, 'https://api.example.test/api/v1/emergencies/active');
      assert.equal(
        requests[4].url,
        'https://api.example.test/api/v1/emergencies?type=MEDICAL&date_from=2026-08-01',
      );
      assert.equal(requests[5].url, 'https://api.example.test/api/v1/emergencies/event-1');
      assert.equal(requests[6].url, 'https://api.example.test/api/v1/emergencies/event-1/status');
      assert.equal(requests[6].method, 'PATCH');
      assert.equal(
        requests[6].body,
        JSON.stringify({ status: 'ACKNOWLEDGED', note: 'Van dispatched' }),
      );

      assert.ok(requests.every((request) => !request.url.includes('school_id=')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
