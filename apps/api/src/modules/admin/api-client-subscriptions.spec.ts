import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';

describe('ApiClient school subscription methods', () => {
  it('targets the /admin/schools/:schoolId/subscription endpoints', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ success: true, data: { status: 'none', plan: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });

      await client.getSchoolSubscription(SCHOOL_ID);
      await client.getSchoolSubscriptionHistory(SCHOOL_ID);
      await client.createSchoolSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        status: SubscriptionStatus.TRIALING,
        trial_end: '2026-03-15T00:00:00.000Z',
      });
      await client.updateSchoolSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
      await client.cancelSchoolSubscription(SCHOOL_ID, {
        cancelled_at: '2026-07-01T00:00:00.000Z',
      });

      const [get, history, create, update, cancel] = requests;
      const base = `https://api.example.test/api/v1/admin/schools/${SCHOOL_ID}/subscription`;

      assert.equal(get.method, 'GET');
      assert.equal(get.url, base);

      assert.equal(history.method, 'GET');
      assert.equal(history.url, `${base}/history`);
      assert.equal(history.body, undefined);

      assert.equal(create.method, 'POST');
      assert.equal(create.url, base);
      assert.ok(create.body?.includes(`"plan_id":"${PLAN_ID}"`));
      assert.ok(create.body?.includes('"status":"trialing"'));

      assert.equal(update.method, 'PATCH');
      assert.equal(update.url, base);

      assert.equal(cancel.method, 'POST');
      assert.equal(cancel.url, `${base}/cancel`);
      assert.ok(cancel.body?.includes('"cancelled_at":"2026-07-01T00:00:00.000Z"'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends an empty body when cancelling without an explicit date', async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(input), body: init?.body as string | undefined });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.cancelSchoolSubscription(SCHOOL_ID);
      assert.equal(requests[0].body, '{}');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
