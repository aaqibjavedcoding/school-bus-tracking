import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import {
  PLAN_LIMIT_REACHED_CODE,
  PlanLimitResource,
  SubscriptionStatus,
} from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createPlan,
  createRoute,
  createSchool,
  createStudent,
  createSubscription,
} from '../support/fixtures';
import { PlanLimitsService } from '../../src/common/plan-limits';
import { SUBSCRIPTION_LAPSED_CODE } from '../../src/common/subscriptions';
import {
  Bus,
  Plan,
  Route,
  School,
  SchoolSubscription,
  Stop,
  Student,
  Trip,
  User,
} from '../../src/database/models';

/**
 * Subscription and plan-limit edge cases against a real PostgreSQL server.
 *
 * Covers the current time-aware enforcement model:
 * - live subscription below / at / over a cap (active)
 * - unlimited (`value: null`) and unset resource limits
 * - a stored *live* status whose window has already elapsed — refused
 *   (`SUBSCRIPTION_INACTIVE`), not silently upgraded to "no plan"
 * - past_due inside the grace window vs. after the grace window
 * - trialing inside vs. after the trial window
 * - no live subscription row (legacy "no caps configured" fallback)
 * - plan deactivation does not lift the caps of an existing live subscription
 * - subscription switch applies the new plan's caps immediately
 * - concurrent creation at the cap boundary (advisory-locked transactions)
 * - caps enforced independently per resource type
 *
 * School lifecycle (`is_active`) and admin-side plan gating live in the
 * authentication/authorization layer and the admin services, not in
 * `PlanLimitsService`, so they are not re-tested here.
 */
describe('subscription and plan edge cases (real PostgreSQL)', () => {
  let sequelize: Sequelize;
  let planLimits: PlanLimitsService;

  before(async () => {
    sequelize = await prepareDatabase();
    planLimits = new PlanLimitsService(
      SchoolSubscription,
      Plan,
      Student,
      Bus,
      Route,
      Stop,
      User,
      Trip,
      sequelize,
    );
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  function cap(value: number): { unlimited: boolean; value: number | null } {
    return { unlimited: false, value };
  }

  function unlimited(): { unlimited: boolean; value: number | null } {
    return { unlimited: true, value: null };
  }

  /** A school with a plan that carries the given per-resource limits. */
  async function schoolWithPlan(
    limits: Partial<Record<PlanLimitResource, { unlimited: boolean; value: number | null }>>,
  ): Promise<{ school: School; plan: Plan }> {
    const school = await createSchool();
    const plan = await createPlan(limits);
    return { school, plan };
  }

  async function expectAllowed(schoolId: string, resource: PlanLimitResource): Promise<void> {
    await planLimits.runWithinLimit(schoolId, resource, async () => undefined);
  }

  /**
   * Asserts the guarded work is refused with the standard plan-limit 409 and
   * that the work itself never runs.
   */
  async function expectPlanLimitReached(
    schoolId: string,
    resource: PlanLimitResource,
    expected: { limit: number; usage: number },
  ): Promise<void> {
    let workRan = false;
    await assert.rejects(
      planLimits.runWithinLimit(schoolId, resource, async () => {
        workRan = true;
        return undefined;
      }),
      (error: { getStatus?: () => number; getResponse?: () => unknown }) => {
        assert.equal(error.getStatus?.(), 409);
        const body = error.getResponse?.() as {
          error?: string;
          details?: { limit?: number; usage?: number };
        };
        assert.equal(body.error, PLAN_LIMIT_REACHED_CODE);
        assert.equal(body.details?.limit, expected.limit);
        assert.equal(body.details?.usage, expected.usage);
        return true;
      },
    );
    assert.equal(workRan, false, 'the guarded work must not run when the cap is reached');
  }

  /** Asserts a lapsed live subscription refuses the guarded work with 409. */
  async function expectLapsed(schoolId: string, resource: PlanLimitResource): Promise<void> {
    await assert.rejects(
      planLimits.runWithinLimit(schoolId, resource, async () => undefined),
      (error: { getStatus?: () => number; getResponse?: () => unknown }) => {
        assert.equal(error.getStatus?.(), 409);
        const body = error.getResponse?.() as { error?: string };
        assert.equal(body.error, SUBSCRIPTION_LAPSED_CODE);
        return true;
      },
    );
  }

  describe('active subscription', () => {
    it('allows resource creation within limits', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(5) });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

      for (let i = 0; i < 4; i++) {
        await createStudent(school.id, null);
      }

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
      assert.equal(await Student.count({ where: { school_id: school.id } }), 4);
    });

    it('blocks resource creation at the exact cap', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(3) });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

      for (let i = 0; i < 3; i++) {
        await createStudent(school.id, null);
      }

      await expectPlanLimitReached(school.id, PlanLimitResource.STUDENTS, { limit: 3, usage: 3 });
    });

    it('blocks resource creation past the cap', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(3) });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

      for (let i = 0; i < 4; i++) {
        await createStudent(school.id, null);
      }

      await expectPlanLimitReached(school.id, PlanLimitResource.STUDENTS, { limit: 3, usage: 4 });
    });
  });

  describe('unlimited plan', () => {
    it('allows unlimited resources when the limit is null', async () => {
      const { school, plan } = await schoolWithPlan({
        [PlanLimitResource.STUDENTS]: unlimited(),
      });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

      for (let i = 0; i < 50; i++) {
        await createStudent(school.id, null);
      }

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('not-set limits', () => {
    it('treats unset resource entries as unlimited', async () => {
      const { school, plan } = await schoolWithPlan({});
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('lapsed live subscription', () => {
    it('blocks resource creation once a stored active period has elapsed', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(10) });
      await createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.ACTIVE,
        current_period_start: new Date(Date.now() - 60 * 86_400_000),
        current_period_end: new Date(Date.now() - 86_400_000),
      });

      await expectLapsed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('past_due subscription', () => {
    it('allows creation inside the grace period', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(10) });
      // current_period_end is 3 days ago: still inside the default 7-day grace.
      await createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.PAST_DUE,
        current_period_start: new Date(Date.now() - 10 * 86_400_000),
        current_period_end: new Date(Date.now() - 3 * 86_400_000),
      });

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
    });

    it('blocks creation once the grace period has elapsed', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(10) });
      // current_period_end is 10 days ago: past the default 7-day grace.
      await createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.PAST_DUE,
        current_period_start: new Date(Date.now() - 60 * 86_400_000),
        current_period_end: new Date(Date.now() - 10 * 86_400_000),
      });

      await expectLapsed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('trialing subscription', () => {
    it('allows resource creation during the trial window', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(5) });
      await createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.TRIALING,
        trial_end: new Date(Date.now() + 5 * 86_400_000),
      });

      for (let i = 0; i < 3; i++) {
        await createStudent(school.id, null);
      }

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
    });

    it('blocks resource creation once the trial window has elapsed', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(10) });
      await createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.TRIALING,
        trial_start: new Date(Date.now() - 10 * 86_400_000),
        trial_end: new Date(Date.now() - 86_400_000),
      });

      await expectLapsed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('no live subscription', () => {
    it('leaves creation unblocked (legacy no-cap fallback)', async () => {
      // No live row means no plan is resolved: the pre-billing fallback is
      // "no caps configured" rather than an invented limit.
      const school = await createSchool();

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('plan deactivation', () => {
    it('keeps enforcing the stored caps for an existing live subscription', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(2) });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });
      await plan.update({ is_active: false });

      await createStudent(school.id, null);
      await expectAllowed(school.id, PlanLimitResource.STUDENTS);

      await createStudent(school.id, null);
      await expectPlanLimitReached(school.id, PlanLimitResource.STUDENTS, { limit: 2, usage: 2 });
    });
  });

  describe('subscription change', () => {
    it('applies the new plan limits immediately after the switch', async () => {
      const school = await createSchool();
      const oldPlan = await createPlan({ [PlanLimitResource.STUDENTS]: cap(5) });
      const newPlan = await createPlan({ [PlanLimitResource.STUDENTS]: cap(20) });

      await createSubscription(school.id, oldPlan.id, { status: SubscriptionStatus.ACTIVE });

      for (let i = 0; i < 5; i++) {
        await createStudent(school.id, null);
      }
      await expectPlanLimitReached(school.id, PlanLimitResource.STUDENTS, { limit: 5, usage: 5 });

      await SchoolSubscription.update(
        { plan_id: newPlan.id },
        { where: { school_id: school.id } },
      );

      await expectAllowed(school.id, PlanLimitResource.STUDENTS);
    });
  });

  describe('concurrent resource creation', () => {
    it('holds the boundary under concurrent creates at the cap', async () => {
      const { school, plan } = await schoolWithPlan({ [PlanLimitResource.STUDENTS]: cap(2) });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });
      await createStudent(school.id, null);

      // Two more slots exist but three concurrent creates race for them; the
      // advisory-locked transaction must admit exactly one.
      const attempts = [0, 1, 2].map((index) =>
        planLimits.runWithinLimit(
          school.id,
          PlanLimitResource.STUDENTS,
          async (transaction) =>
            Student.create(
              {
                id: randomUUID(),
                school_id: school.id,
                home_stop_id: null,
                admission_number: `EDGE-${index}-${randomUUID().slice(0, 8)}`,
                first_name: 'Edge',
                last_name: String(index),
                date_of_birth: null,
                gender: null,
                grade_level: 'Grade 1',
                emergency_contact_name: null,
                emergency_contact_phone: null,
                medical_notes: null,
                is_active: true,
              } as never,
              transaction ? { transaction } : {},
            ),
        ),
      );
      const results = await Promise.allSettled(attempts);

      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 2);
      assert.equal(await Student.count({ where: { school_id: school.id } }), 2);
    });
  });

  describe('multiple resource types', () => {
    it('enforces limits independently per resource type', async () => {
      const { school, plan } = await schoolWithPlan({
        [PlanLimitResource.STUDENTS]: cap(2),
        [PlanLimitResource.BUSES]: cap(1),
        [PlanLimitResource.ROUTES]: cap(1),
      });
      await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

      for (let i = 0; i < 2; i++) {
        await createStudent(school.id, null);
      }
      await expectPlanLimitReached(school.id, PlanLimitResource.STUDENTS, { limit: 2, usage: 2 });
      await expectAllowed(school.id, PlanLimitResource.BUSES);
      await expectAllowed(school.id, PlanLimitResource.ROUTES);

      await createBus(school.id);
      await expectPlanLimitReached(school.id, PlanLimitResource.BUSES, { limit: 1, usage: 1 });
      await expectAllowed(school.id, PlanLimitResource.ROUTES);

      await createRoute(school.id);
      await expectPlanLimitReached(school.id, PlanLimitResource.ROUTES, { limit: 1, usage: 1 });
    });
  });
});
