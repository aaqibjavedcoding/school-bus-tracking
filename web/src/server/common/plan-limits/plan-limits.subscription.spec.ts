import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConfigService } from '../../framework';
import { PlanLimitResource, SubscriptionStatus } from '@school-bus-tracking/shared-types';
import { PlanLimitsService } from './plan-limits.service';
import { PlanLimitReachedException } from './plan-limit-reached.exception';
import { SUBSCRIPTION_LAPSED_CODE } from '../subscriptions';
import type { Bus, Plan, Route, SchoolSubscription, Stop, Student, Trip, User } from '../../database/models';

const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';

function makeService(options: {
  subscription: Record<string, unknown> | null;
  students?: number;
  limit?: number | null;
  config?: Record<string, unknown>;
}) {
  const subscriptions = {
    findOne: async () => options.subscription as unknown as SchoolSubscription | null,
  } as unknown as typeof SchoolSubscription;

  const plans = {
    findOne: async () =>
      ({
        id: PLAN_ID,
        limits:
          options.limit === undefined
            ? {}
            : { [PlanLimitResource.STUDENTS]: { unlimited: false, value: options.limit } },
      }) as unknown as Plan,
  } as unknown as typeof Plan;

  const counting = (value: number) =>
    ({ count: async () => value }) as unknown as typeof Student &
      typeof Bus &
      typeof Route &
      typeof Stop &
      typeof Trip &
      typeof User;

  const configValues = options.config ?? {};
  const configService = {
    get: <T>(key: string, fallback?: T) =>
      key in configValues ? (configValues[key] as T) : (fallback as T),
  } as unknown as ConfigService;

  return new PlanLimitsService(
    subscriptions,
    plans,
    counting(options.students ?? 0),
    counting(0),
    counting(0),
    counting(0),
    counting(0) as unknown as typeof User,
    counting(0) as unknown as typeof Trip,
    null,
    configService,
  );
}

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

describe('PlanLimitsService — time-aware subscription window', () => {
  it('enforces the plan while the period is valid', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        current_period_end: FUTURE,
      },
      students: 5,
      limit: 5,
    });
    await assert.rejects(
      service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS),
      PlanLimitReachedException,
    );
  });

  it('refuses new resources when a stored "active" row has already expired', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        current_period_end: PAST,
      },
      students: 0,
      limit: 100,
    });
    await assert.rejects(
      service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS),
      (error: { getStatus?: () => number; getResponse?: () => unknown }) => {
        assert.equal(error.getStatus?.(), 409);
        const body = error.getResponse?.() as { error: string };
        assert.equal(body.error, SUBSCRIPTION_LAPSED_CODE);
        return true;
      },
    );
  });

  it('refuses new resources when a trial has ended', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.TRIALING,
        trial_end: PAST,
      },
      limit: 100,
    });
    await assert.rejects(service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS), /subscription period has ended/i);
  });

  it('keeps a past_due school inside the configured grace window', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.PAST_DUE,
        current_period_end: PAST,
      },
      students: 1,
      limit: 100,
      config: { 'subscription.pastDueGraceDays': 7 },
    });
    await service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS);
  });

  it('lapses a past_due school once the grace window is set to zero', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.PAST_DUE,
        current_period_end: PAST,
      },
      limit: 100,
      config: { 'subscription.pastDueGraceDays': 0 },
    });
    await assert.rejects(service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS));
  });

  it('can fall back to the legacy behaviour when enforcement is disabled', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        current_period_end: PAST,
      },
      limit: 1,
      students: 99,
      config: { 'subscription.enforceLapsedAccess': false },
    });
    await service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS);
  });

  it('leaves a school with no subscription row untouched', async () => {
    const service = makeService({ subscription: null, students: 10_000, limit: 1 });
    await service.assertWithinLimit(SCHOOL, PlanLimitResource.STUDENTS);
  });

  it('runWithinLimit falls back to assert + work without a database connection', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        current_period_end: FUTURE,
      },
      students: 0,
      limit: 1,
    });
    const result = await service.runWithinLimit(
      SCHOOL,
      PlanLimitResource.STUDENTS,
      async (transaction) => {
        assert.equal(transaction, undefined);
        return 'created';
      },
    );
    assert.equal(result, 'created');
  });

  it('runWithinLimit rejects before running the work when the cap is reached', async () => {
    const service = makeService({
      subscription: {
        school_id: SCHOOL,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
        current_period_end: FUTURE,
      },
      students: 1,
      limit: 1,
    });
    let ran = false;
    await assert.rejects(
      service.runWithinLimit(SCHOOL, PlanLimitResource.STUDENTS, async () => {
        ran = true;
        return null;
      }),
      PlanLimitReachedException,
    );
    assert.equal(ran, false);
  });
});
