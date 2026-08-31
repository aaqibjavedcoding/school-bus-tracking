import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PlanBillingPeriod,
  PlanFeature,
  PlanLimitResource,
} from '@school-bus-tracking/shared-types';
import {
  adminPlanCreateSchema,
  adminPlanListQuerySchema,
  adminPlanUpdateSchema,
} from '@school-bus-tracking/validation';

describe('Admin plans zod validation', () => {
  it('accepts a well-formed create payload with unlimited and capped limits', () => {
    const parsed = adminPlanCreateSchema.safeParse({
      code: 'pro',
      name: 'Pro',
      description: 'The mid tier',
      price: 49.99,
      currency: 'usd',
      billing_period: PlanBillingPeriod.MONTHLY,
      is_active: true,
      features: { [PlanFeature.LIVE_TRACKING]: true, [PlanFeature.ANALYTICS]: false },
      limits: {
        [PlanLimitResource.STUDENTS]: { unlimited: false, value: 1000 },
        [PlanLimitResource.BUSES]: { unlimited: true, value: null },
      },
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.currency, 'USD');
    assert.equal(parsed.data.price, 49.99);
  });

  it('rejects a code with invalid characters', () => {
    const parsed = adminPlanCreateSchema.safeParse({
      code: 'NOT-VALID',
      name: 'Bad',
      price: 0,
      currency: 'USD',
      billing_period: PlanBillingPeriod.YEARLY,
    });
    assert.equal(parsed.success, false);
  });

  it('rejects an unknown feature key', () => {
    const parsed = adminPlanCreateSchema.safeParse({
      code: 'basic',
      name: 'Basic',
      price: 0,
      currency: 'USD',
      billing_period: PlanBillingPeriod.MONTHLY,
      features: { made_up_feature: true },
    });
    assert.equal(parsed.success, false);
  });

  it('rejects a limit entry where unlimited=true and value is set', () => {
    const parsed = adminPlanCreateSchema.safeParse({
      code: 'basic',
      name: 'Basic',
      price: 0,
      currency: 'USD',
      billing_period: PlanBillingPeriod.MONTHLY,
      limits: { [PlanLimitResource.STUDENTS]: { unlimited: true, value: 100 } },
    });
    assert.equal(parsed.success, false);
  });

  it('rejects a negative price', () => {
    const parsed = adminPlanCreateSchema.safeParse({
      code: 'basic',
      name: 'Basic',
      price: -1,
      currency: 'USD',
      billing_period: PlanBillingPeriod.MONTHLY,
    });
    assert.equal(parsed.success, false);
  });

  it('rejects an empty update body', () => {
    const parsed = adminPlanUpdateSchema.safeParse({});
    assert.equal(parsed.success, false);
  });

  it('accepts a partial update body changing price only', () => {
    const parsed = adminPlanUpdateSchema.safeParse({ price: 9.5 });
    assert.ok(parsed.success);
    assert.equal(parsed.data.price, 9.5);
  });

  it('rejects an invalid list query page value', () => {
    const parsed = adminPlanListQuerySchema.safeParse({ page: -1 });
    assert.equal(parsed.success, false);
  });

  it('accepts a well-formed list query', () => {
    const parsed = adminPlanListQuerySchema.safeParse({
      page: 2,
      limit: 25,
      search: 'pro',
      status: 'active',
      sort: 'price',
      order: 'asc',
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.page, 2);
    assert.equal(parsed.data.limit, 25);
  });
});
