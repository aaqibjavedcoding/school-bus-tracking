import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListAdminSubscriptionsQueryDto } from './dto';
import {
  adminSchoolSubscriptionCancelSchema,
  adminSchoolSubscriptionCreateSchema,
  adminSchoolSubscriptionUpdateSchema,
} from '@school-bus-tracking/validation';

const PLAN_ID = '22222222-2222-4222-8222-222222222222';

describe('Admin school subscription zod validation', () => {
  it('accepts a minimal create payload (plan only)', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({ plan_id: PLAN_ID });
    assert.ok(parsed.success);
    assert.equal(parsed.data.plan_id, PLAN_ID);
  });

  it('accepts a full trial + period payload', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      status: SubscriptionStatus.TRIALING,
      trial_start: '2026-03-01T00:00:00.000Z',
      trial_end: '2026-03-15T00:00:00.000Z',
      current_period_start: '2026-03-01T00:00:00.000Z',
      current_period_end: '2026-04-01T00:00:00.000Z',
    });
    assert.ok(parsed.success);
  });

  it('rejects a non-UUID plan_id', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({ plan_id: 'pro' });
    assert.equal(parsed.success, false);
  });

  it('rejects the projection-only `none` status', () => {
    const create = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      status: SubscriptionStatus.NONE,
    });
    assert.equal(create.success, false);

    const update = adminSchoolSubscriptionUpdateSchema.safeParse({
      status: SubscriptionStatus.NONE,
    });
    assert.equal(update.success, false);
  });

  it('rejects a terminal status at creation time', () => {
    for (const status of [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED]) {
      const parsed = adminSchoolSubscriptionCreateSchema.safeParse({ plan_id: PLAN_ID, status });
      assert.equal(parsed.success, false, `${status} must not be assignable on create`);
    }
  });

  it('accepts a terminal status on update (closing a subscription)', () => {
    const parsed = adminSchoolSubscriptionUpdateSchema.safeParse({
      status: SubscriptionStatus.EXPIRED,
    });
    assert.ok(parsed.success);
  });

  it('rejects an unknown status value', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      status: 'paused',
    });
    assert.equal(parsed.success, false);
  });

  it('rejects trial_end before trial_start', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      trial_start: '2026-03-15T00:00:00.000Z',
      trial_end: '2026-03-01T00:00:00.000Z',
    });
    assert.equal(parsed.success, false);
    assert.ok(
      !parsed.success && parsed.error.issues.some((issue) => issue.path.join('.') === 'trial_end'),
    );
  });

  it('rejects current_period_end before current_period_start', () => {
    const parsed = adminSchoolSubscriptionUpdateSchema.safeParse({
      current_period_start: '2026-05-01T00:00:00.000Z',
      current_period_end: '2026-04-01T00:00:00.000Z',
    });
    assert.equal(parsed.success, false);
    assert.ok(
      !parsed.success &&
        parsed.error.issues.some((issue) => issue.path.join('.') === 'current_period_end'),
    );
  });

  it('requires trial_end when creating a trialing subscription', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      status: SubscriptionStatus.TRIALING,
    });
    assert.equal(parsed.success, false);
  });

  it('rejects malformed dates', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      current_period_start: 'yesterday',
    });
    assert.equal(parsed.success, false);
  });

  it('rejects unknown fields (no silent billing knobs)', () => {
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse({
      plan_id: PLAN_ID,
      price: 10,
      payment_method: 'card',
    });
    assert.equal(parsed.success, false);
  });

  it('rejects an empty update body', () => {
    const parsed = adminSchoolSubscriptionUpdateSchema.safeParse({});
    assert.equal(parsed.success, false);
  });

  it('accepts an empty or dated cancel body', () => {
    assert.ok(adminSchoolSubscriptionCancelSchema.safeParse({}).success);
    assert.ok(
      adminSchoolSubscriptionCancelSchema.safeParse({
        cancelled_at: '2026-07-01T00:00:00.000Z',
      }).success,
    );
    assert.equal(
      adminSchoolSubscriptionCancelSchema.safeParse({ cancelled_at: 'soon' }).success,
      false,
    );
  });
});

describe('ListAdminSubscriptionsQueryDto (global subscription console filters)', () => {
  const validateQuery = async (query: Record<string, unknown>) =>
    validate(plainToInstance(ListAdminSubscriptionsQueryDto, query));

  it('accepts the supported search / status / plan filters', async () => {
    const errors = await validateQuery({
      page: 2,
      limit: 50,
      search: 'lincoln',
      status: SubscriptionStatus.PAST_DUE,
      plan_id: PLAN_ID,
    });
    assert.equal(errors.length, 0);
  });

  it('accepts the projection-only `none` status as a read filter', async () => {
    const errors = await validateQuery({ status: SubscriptionStatus.NONE });
    assert.equal(errors.length, 0);
  });

  it('bounds the free-text search by length (MaxLength, not the numeric Max)', async () => {
    const ok = await validateQuery({ search: 'a'.repeat(100) });
    assert.equal(ok.length, 0);

    const tooLong = await validateQuery({ search: 'a'.repeat(101) });
    assert.equal(tooLong.length, 1);
    assert.match(
      Object.values(tooLong[0].constraints ?? {}).join(' '),
      /at most 100 characters/,
    );
  });

  it('rejects an unknown status and a non-UUID plan filter', async () => {
    assert.equal((await validateQuery({ status: 'paused' })).length, 1);
    assert.equal((await validateQuery({ plan_id: 'pro' })).length, 1);
  });
});
