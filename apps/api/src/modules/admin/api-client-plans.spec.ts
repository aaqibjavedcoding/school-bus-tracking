import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type { AdminPlanCreateRequest } from '@school-bus-tracking/shared-types';
import { PlanBillingPeriod, PlanFeature, PlanLimitResource } from '@school-bus-tracking/shared-types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';

const createBody: AdminPlanCreateRequest = {
  code: 'basic',
  name: 'Basic',
  description: 'Starter tier',
  price: 19.99,
  currency: 'USD',
  billing_period: PlanBillingPeriod.MONTHLY,
  is_active: true,
  features: { [PlanFeature.LIVE_TRACKING]: true },
  limits: { [PlanLimitResource.STUDENTS]: { unlimited: false, value: 300 } },
};

describe('ApiClient plan management methods', () => {
  it('targets /admin/plans endpoints with the correct HTTP verbs and URLs', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(
        JSON.stringify({ success: true, data: { items: [], meta: { page: 1, totalPages: 0 } } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });

      await client.createAdminPlan(createBody);
      await client.listAdminPlans({ page: 2, limit: 10, search: 'pro', status: 'active' });
      await client.getAdminPlan(PLAN_ID);
      await client.updateAdminPlan(PLAN_ID, { name: 'Basic+', price: 24.99 });
      await client.activateAdminPlan(PLAN_ID);
      await client.deactivateAdminPlan(PLAN_ID);

      const [create, list, get, update, activate, deactivate] = requests;

      assert.equal(create.method, 'POST');
      assert.equal(create.url, 'https://api.example.test/api/v1/admin/plans');
      assert.ok(create.body?.includes('"code":"basic"'));

      assert.equal(list.method, 'GET');
      assert.ok(list.url.includes('/admin/plans?'));
      assert.ok(list.url.includes('page=2'));
      assert.ok(list.url.includes('search=pro'));
      assert.ok(list.url.includes('status=active'));

      assert.equal(get.method, 'GET');
      assert.equal(get.url, `https://api.example.test/api/v1/admin/plans/${PLAN_ID}`);

      assert.equal(update.method, 'PATCH');
      assert.equal(update.url, `https://api.example.test/api/v1/admin/plans/${PLAN_ID}`);
      assert.ok(update.body?.includes('"name":"Basic+"'));

      assert.equal(activate.method, 'POST');
      assert.ok(activate.url.endsWith(`/admin/plans/${PLAN_ID}/activate`));

      assert.equal(deactivate.method, 'POST');
      assert.ok(deactivate.url.endsWith(`/admin/plans/${PLAN_ID}/deactivate`));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
