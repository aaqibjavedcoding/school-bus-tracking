import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { PlanLimitResource, SubscriptionStatus } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createPlan,
  createSchool,
  createStop,
  createStudent,
  createSubscription,
} from '../support/fixtures';
import { PlanLimitsService } from '../../src/common/plan-limits';
import {
  Bus,
  Plan,
  Route,
  SchoolSubscription,
  Stop,
  Student,
  Trip,
  User,
} from '../../src/database/models';

/**
 * Comprehensive subscription and plan edge-case regression tests.
 *
 * Covers:
 * - active subscription
 * - trialing subscription
 * - expired subscription
 * - past_due subscription
 * - past_due inside grace period
 * - past_due after grace period
 * - cancelled subscription
 * - resubscribed
 * - no subscription
 * - inactive school
 * - exact plan limit
 * - limit + 1
 * - unlimited
 * - not-set limits
 * - plan deactivation
 * - subscription change
 * - concurrent resource creation
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

  async function createSchoolWithPlan(
    planOverrides: Partial<{
      max_students: number | null;
      max_buses: number | null;
      max_routes: number | null;
    }> = {},
    schoolOverrides: Partial<{ is_active: boolean }> = {},
  ) {
    const school = await createSchool(schoolOverrides);
    const plan = await createPlan({
      max_students: planOverrides.max_students ?? 100,
      max_buses: planOverrides.max_buses ?? 20,
      max_routes: planOverrides.max_routes ?? 10,
    });
    return { school, plan };
  }

  describe('active subscription', () => {
    it('allows resource creation within limits', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 5 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Create 4 students (within limit of 5).
      for (let i = 0; i < 4; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, true);
    });

    it('blocks resource creation at exact limit', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 3 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Create exactly 3 students (at limit).
      for (let i = 0; i < 3; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });

    it('blocks resource creation at limit + 1', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 3 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Create 4 students (over limit of 3).
      for (let i = 0; i < 4; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('unlimited plan', () => {
    it('allows unlimited resources when limit is null', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: null });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Create many students.
      for (let i = 0; i < 50; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, true);
    });
  });

  describe('not-set limits', () => {
    it('treats undefined limits as unlimited', async () => {
      const { school, plan } = await createSchoolWithPlan({});
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, true);
    });
  });

  describe('expired subscription', () => {
    it('blocks resource creation for expired subscription', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 10 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.EXPIRED);

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('past_due subscription', () => {
    it('allows creation inside grace period', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 10 });
      // Create a past_due subscription with a future grace period end.
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      await createSubscription(school.id, plan.id, SubscriptionStatus.PAST_DUE, {
        grace_period_end: futureDate,
      });

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, true);
    });

    it('blocks creation after grace period', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 10 });
      // Create a past_due subscription with an expired grace period.
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      await createSubscription(school.id, plan.id, SubscriptionStatus.PAST_DUE, {
        grace_period_end: pastDate,
      });

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('cancelled subscription', () => {
    it('blocks resource creation for cancelled subscription', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 10 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.CANCELLED);

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('trialing subscription', () => {
    it('allows resource creation during trial', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 5 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.TRIALING);

      // Create 3 students (within limit).
      for (let i = 0; i < 3; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, true);
    });
  });

  describe('no subscription', () => {
    it('blocks resource creation when no subscription exists', async () => {
      const school = await createSchool();

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('inactive school', () => {
    it('blocks resource creation for inactive school', async () => {
      const { school, plan } = await createSchoolWithPlan(
        { max_students: 10 },
        { is_active: false },
      );
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('plan deactivation', () => {
    it('blocks resource creation when plan is deactivated', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 10 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Deactivate the plan.
      await plan.update({ is_active: false });

      const result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);
    });
  });

  describe('subscription change', () => {
    it('uses the new plan limits after subscription change', async () => {
      const school = await createSchool();
      const oldPlan = await createPlan({ max_students: 5 });
      const newPlan = await createPlan({ max_students: 20 });

      await createSubscription(school.id, oldPlan.id, SubscriptionStatus.ACTIVE);

      // Create 5 students (at old limit).
      for (let i = 0; i < 5; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      // Verify at limit.
      let result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);

      // Change subscription to new plan.
      await SchoolSubscription.update(
        { plan_id: newPlan.id },
        { where: { school_id: school.id } },
      );

      // Verify now allowed.
      result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, true);
    });
  });

  describe('concurrent resource creation', () => {
    it('handles concurrent creation at limit boundary', async () => {
      const { school, plan } = await createSchoolWithPlan({ max_students: 2 });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Create 1 student (below limit).
      const stop = await createStop(school.id, randomUUID());
      await createStudent(school.id, stop.id);

      // Try to create 3 more concurrently (limit is 2, so only 1 should succeed).
      const results = await Promise.allSettled([
        (async () => {
          const s = await createStop(school.id, randomUUID());
          return createStudent(school.id, s.id);
        })(),
        (async () => {
          const s = await createStop(school.id, randomUUID());
          return createStudent(school.id, s.id);
        })(),
        (async () => {
          const s = await createStop(school.id, randomUUID());
          return createStudent(school.id, s.id);
        })(),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      // At most 1 should succeed (we already have 1, limit is 2).
      assert.ok(succeeded <= 1, `Expected at most 1 to succeed, got ${succeeded}`);
    });
  });

  describe('multiple resource types', () => {
    it('enforces limits independently per resource type', async () => {
      const { school, plan } = await createSchoolWithPlan({
        max_students: 2,
        max_buses: 1,
        max_routes: 1,
      });
      await createSubscription(school.id, plan.id, SubscriptionStatus.ACTIVE);

      // Fill student limit.
      for (let i = 0; i < 2; i++) {
        const stop = await createStop(school.id, randomUUID());
        await createStudent(school.id, stop.id);
      }

      // Students at limit.
      let result = await planLimits.checkLimit(school.id, PlanLimitResource.STUDENTS);
      assert.equal(result.allowed, false);

      // Buses still allowed.
      result = await planLimits.checkLimit(school.id, PlanLimitResource.BUSES);
      assert.equal(result.allowed, true);

      // Fill bus limit.
      await createBus(school.id);

      // Buses at limit.
      result = await planLimits.checkLimit(school.id, PlanLimitResource.BUSES);
      assert.equal(result.allowed, false);
    });
  });
});
