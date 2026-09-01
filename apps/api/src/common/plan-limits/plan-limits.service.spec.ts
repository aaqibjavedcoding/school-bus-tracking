import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { HttpStatus } from '@nestjs/common';
import {
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  PLAN_LIMIT_REACHED_CODE,
  PlanLimitResource,
  SubscriptionStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { PlanLimitsService } from './plan-limits.service';
import { PlanLimitReachedException, planLimitReachedMessage } from './plan-limit-reached.exception';
import type { Bus, Plan, Route, SchoolSubscription, Stop, Student, Trip, User } from '../../database/models';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';

function makePlan(limits: Record<string, { unlimited: boolean; value: number | null }>) {
  return { id: PLAN_ID, limits } as unknown as Plan;
}

function makeService(options: {
  subscriptionSchoolId?: string | null;
  status?: SubscriptionStatus;
  plan?: Plan | null;
  counts?: Partial<Record<PlanLimitResource, number>>;
  countWheres?: Array<{ resource?: string; where: Record<PropertyKey, unknown> }>;
}) {
  const countWheres = options.countWheres ?? [];
  const counts = options.counts ?? {};
  const subscription =
    options.subscriptionSchoolId === null
      ? null
      : {
          school_id: options.subscriptionSchoolId ?? SCHOOL_A,
          plan_id: PLAN_ID,
          status: options.status ?? SubscriptionStatus.ACTIVE,
        };

  const subscriptions = {
    findOne: async (query: { where: Record<PropertyKey, unknown> }) => {
      if (!subscription) return null;
      if (query.where.school_id !== subscription.school_id) return null;
      return subscription as unknown as SchoolSubscription;
    },
  } as unknown as typeof SchoolSubscription;

  const plans = {
    findOne: async () => options.plan ?? makePlan({}),
  } as unknown as typeof Plan;

  const countRepo = (resource: PlanLimitResource) =>
    ({
      count: async (query: { where: Record<PropertyKey, unknown> }) => {
        countWheres.push({ resource, where: query.where });
        return counts[resource] ?? 0;
      },
    }) as unknown as typeof Student & typeof Bus & typeof Route & typeof Stop & typeof Trip;

  return {
    countWheres,
    service: new PlanLimitsService(
      subscriptions,
      plans,
      countRepo(PlanLimitResource.STUDENTS) as unknown as typeof Student,
      countRepo(PlanLimitResource.BUSES) as unknown as typeof Bus,
      countRepo(PlanLimitResource.ROUTES) as unknown as typeof Route,
      countRepo(PlanLimitResource.STOPS) as unknown as typeof Stop,
      {
        count: async (query: { where: Record<PropertyKey, unknown> }) => {
          countWheres.push({ where: query.where });
          const role = query.where.role;
          if (role === UserRole.DRIVER) return counts[PlanLimitResource.DRIVERS] ?? 0;
          if (role === UserRole.CONDUCTOR) return counts[PlanLimitResource.CONDUCTORS] ?? 0;
          if (role === UserRole.PARENT) return counts[PlanLimitResource.PARENTS] ?? 0;
          return counts[PlanLimitResource.STAFF] ?? 0;
        },
      } as unknown as typeof User,
      countRepo(PlanLimitResource.TRIPS) as typeof Trip,
    ),
  };
}

async function expectLimit(
  promise: Promise<unknown>,
  resource: PlanLimitResource,
  limit: number,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PlanLimitReachedException);
    assert.equal(error.getStatus(), HttpStatus.CONFLICT);
    assert.notEqual(error.getStatus(), 500);
    const body = error.getResponse() as { error: string; message: string; details: { limit: number } };
    assert.equal(body.error, PLAN_LIMIT_REACHED_CODE);
    assert.equal(body.details.limit, limit);
    assert.match(body.message, new RegExp(String(limit)));
    assert.equal(body.message, planLimitReachedMessage(resource, limit));
    return true;
  });
}

describe('PlanLimitsService', () => {
  it('allows create when usage is below the plan limit', async () => {
    const { service } = makeService({
      plan: makePlan({ students: { unlimited: false, value: 100 } }),
      counts: { [PlanLimitResource.STUDENTS]: 99 },
    });
    await service.assertWithinLimit(SCHOOL_A, PlanLimitResource.STUDENTS);
  });

  it('rejects create when usage has reached the plan limit and includes the limit in the message', async () => {
    const { service } = makeService({
      plan: makePlan({ students: { unlimited: false, value: 100 } }),
      counts: { [PlanLimitResource.STUDENTS]: 100 },
    });
    await expectLimit(
      service.assertWithinLimit(SCHOOL_A, PlanLimitResource.STUDENTS),
      PlanLimitResource.STUDENTS,
      100,
    );
  });

  it('allows create after usage drops (deleted/deactivated no longer counted)', async () => {
    const { service } = makeService({
      plan: makePlan({ students: { unlimited: false, value: 1 } }),
      counts: { [PlanLimitResource.STUDENTS]: 0 },
    });
    await service.assertWithinLimit(SCHOOL_A, PlanLimitResource.STUDENTS);
  });

  it('does not let school A usage block school B', async () => {
    const { service, countWheres } = makeService({
      subscriptionSchoolId: SCHOOL_B,
      plan: makePlan({ students: { unlimited: false, value: 20 } }),
      counts: { [PlanLimitResource.STUDENTS]: 20 },
    });
    await expectLimit(
      service.assertWithinLimit(SCHOOL_B, PlanLimitResource.STUDENTS),
      PlanLimitResource.STUDENTS,
      20,
    );
    assert.ok(countWheres.every((entry) => entry.where.school_id === SCHOOL_B));
  });

  it('always scopes usage queries to the authenticated school_id', async () => {
    const { service, countWheres } = makeService({
      plan: makePlan({ buses: { unlimited: false, value: 5 } }),
      counts: { [PlanLimitResource.BUSES]: 1 },
    });
    await service.assertWithinLimit(SCHOOL_A, PlanLimitResource.BUSES);
    assert.equal(countWheres.length, 1);
    assert.equal(countWheres[0].where.school_id, SCHOOL_A);
    assert.equal(countWheres[0].where.is_active, true);
  });

  it('never uses a client-supplied school_id — only the argument from JWT context', async () => {
    const { service, countWheres } = makeService({
      plan: makePlan({ routes: { unlimited: false, value: 3 } }),
      counts: { [PlanLimitResource.ROUTES]: 0 },
    });
    await service.assertWithinLimit(SCHOOL_A, PlanLimitResource.ROUTES);
    assert.ok(!countWheres.some((entry) => entry.where.school_id === SCHOOL_B));
  });

  it('allows unlimited and missing limits, and schools without a live subscription', async () => {
    await makeService({
      plan: makePlan({ students: { unlimited: true, value: null } }),
      counts: { [PlanLimitResource.STUDENTS]: 10_000 },
    }).service.assertWithinLimit(SCHOOL_A, PlanLimitResource.STUDENTS);

    await makeService({
      plan: makePlan({}),
      counts: { [PlanLimitResource.STUDENTS]: 10_000 },
    }).service.assertWithinLimit(SCHOOL_A, PlanLimitResource.STUDENTS);

    await makeService({ subscriptionSchoolId: null }).service.assertWithinLimit(
      SCHOOL_A,
      PlanLimitResource.STUDENTS,
    );
  });

  it('enforces buses, routes, stops, parents, trips and staff', async () => {
    const cases: Array<[PlanLimitResource, string]> = [
      [PlanLimitResource.BUSES, 'buses'],
      [PlanLimitResource.ROUTES, 'routes'],
      [PlanLimitResource.STOPS, 'stops'],
      [PlanLimitResource.PARENTS, 'parents'],
      [PlanLimitResource.TRIPS, 'trips'],
    ];
    for (const [resource, key] of cases) {
      const { service } = makeService({
        plan: makePlan({ [key]: { unlimited: false, value: 2 } }),
        counts: { [resource]: 2 },
      });
      await expectLimit(service.assertWithinLimit(SCHOOL_A, resource), resource, 2);
    }

    const { service } = makeService({
      plan: makePlan({ staff: { unlimited: false, value: 4 } }),
      counts: { [PlanLimitResource.STAFF]: 4 },
    });
    await expectLimit(
      service.assertStaffWithinLimit(SCHOOL_A, UserRole.DRIVER),
      PlanLimitResource.STAFF,
      4,
    );
  });

  it('honours role-specific driver limits', async () => {
    const { service } = makeService({
      plan: makePlan({ drivers: { unlimited: false, value: 1 } }),
      counts: { [PlanLimitResource.DRIVERS]: 1 },
    });
    await expectLimit(
      service.assertStaffWithinLimit(SCHOOL_A, UserRole.DRIVER),
      PlanLimitResource.DRIVERS,
      1,
    );
  });

  it('resolves only live subscription statuses', async () => {
    assert.deepEqual(LIVE_SUBSCRIPTION_STATUS_VALUES, [
      SubscriptionStatus.TRIALING,
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
    ]);
  });
});
