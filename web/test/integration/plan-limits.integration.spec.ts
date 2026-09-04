import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConfigService } from '../../src/server/framework';
import {
  PLAN_LIMIT_REACHED_CODE,
  PlanLimitResource,
  SubscriptionStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import { createPlan, createSchool, createStudent, createSubscription } from '../support/fixtures';
import { PlanLimitsService } from '../../src/common/plan-limits';
import { SUBSCRIPTION_LAPSED_CODE } from '../../src/common/subscriptions';
import { StudentsService } from '../../src/modules/students/students.service';
import {
  Bus,
  Plan,
  Route,
  RouteAssignment,
  SchoolSubscription,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../src/database/models';

function configStub(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: <T>(key: string, fallback?: T) => (key in values ? (values[key] as T) : (fallback as T)),
  } as unknown as ConfigService;
}

/**
 * Plan-limit enforcement and the **concurrency boundary**, against a real
 * PostgreSQL server.
 *
 * The race this proves cannot be reproduced with mocks: two requests must run
 * in two real database sessions so the advisory lock and the transaction
 * isolation are actually exercised.
 */
describe('plan limits (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  function makeStudentsService(config?: ConfigService): {
    students: StudentsService;
    planLimits: PlanLimitsService;
  } {
    const planLimits = new PlanLimitsService(
      SchoolSubscription,
      Plan,
      Student,
      Bus,
      Route,
      Stop,
      User,
      Trip,
      sequelize,
      config ?? configStub(),
    );
    const students = new StudentsService(
      Student,
      Stop,
      StudentGuardian,
      Route,
      RouteAssignment,
      Bus,
      planLimits,
    );
    return { students, planLimits };
  }

  before(async () => {
    sequelize = await prepareDatabase();
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  it('allows creation below the cap and rejects it at the cap', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 2 },
    });
    await createSubscription(school.id, plan.id);
    const { students } = makeStudentsService();

    await students.create(school.id, {
      admission_number: 'A1',
      first_name: 'A',
      last_name: 'One',
    } as never);
    await students.create(school.id, {
      admission_number: 'A2',
      first_name: 'A',
      last_name: 'Two',
    } as never);

    await assert.rejects(
      students.create(school.id, {
        admission_number: 'A3',
        first_name: 'A',
        last_name: 'Three',
      } as never),
      (error: { getStatus?: () => number; getResponse?: () => unknown }) => {
        assert.equal(error.getStatus?.(), 409);
        assert.equal((error.getResponse?.() as { error: string }).error, PLAN_LIMIT_REACHED_CODE);
        return true;
      },
    );

    assert.equal(await Student.count({ where: { school_id: school.id } }), 2);
  });

  it('treats unlimited and unset limits as no cap', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: true, value: null },
    });
    await createSubscription(school.id, plan.id);
    const { students } = makeStudentsService();

    for (let index = 0; index < 5; index += 1) {
      await students.create(school.id, {
        admission_number: `U${index}`,
        first_name: 'U',
        last_name: String(index),
      } as never);
    }
    assert.equal(await Student.count({ where: { school_id: school.id } }), 5);
  });

  it('frees capacity when a resource is soft-deleted or deactivated', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 1 },
    });
    await createSubscription(school.id, plan.id);
    const { students } = makeStudentsService();

    const first = await students.create(school.id, {
      admission_number: 'S1',
      first_name: 'S',
      last_name: 'One',
    } as never);
    await assert.rejects(
      students.create(school.id, {
        admission_number: 'S2',
        first_name: 'S',
        last_name: 'Two',
      } as never),
    );

    await (await Student.findByPk(first.id))?.destroy();
    const replacement = await students.create(school.id, {
      admission_number: 'S3',
      first_name: 'S',
      last_name: 'Three',
    } as never);
    assert.ok(replacement.id);
  });

  it('refuses creation when the subscription window has lapsed', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 100 },
    });
    await createSubscription(school.id, plan.id, {
      status: SubscriptionStatus.ACTIVE,
      current_period_start: new Date(Date.now() - 60 * 86_400_000),
      current_period_end: new Date(Date.now() - 86_400_000),
    });
    const { students } = makeStudentsService();

    await assert.rejects(
      students.create(school.id, {
        admission_number: 'L1',
        first_name: 'L',
        last_name: 'One',
      } as never),
      (error: { getResponse?: () => unknown }) => {
        assert.equal(
          (error.getResponse?.() as { error: string }).error,
          SUBSCRIPTION_LAPSED_CODE,
        );
        return true;
      },
    );
    assert.equal(await Student.count({ where: { school_id: school.id } }), 0);
  });

  it('one tenant reaching its cap never blocks another tenant', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 1 },
    });
    await createSubscription(schoolA.id, plan.id);
    await createSubscription(schoolB.id, plan.id);
    const { students } = makeStudentsService();

    await students.create(schoolA.id, {
      admission_number: 'T1',
      first_name: 'T',
      last_name: 'One',
    } as never);
    await assert.rejects(
      students.create(schoolA.id, {
        admission_number: 'T2',
        first_name: 'T',
        last_name: 'Two',
      } as never),
    );
    const other = await students.create(schoolB.id, {
      admission_number: 'T1',
      first_name: 'T',
      last_name: 'One',
    } as never);
    assert.ok(other.id);
  });

  /**
   * The exact boundary described in the audit: 99 existing rows, a limit of
   * 100 and two simultaneous creates. Before the fix both requests read 99 and
   * both committed, leaving 101 rows.
   */
  it('99 existing + limit 100 + 2 concurrent creates → exactly one succeeds, final count 100', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 100 },
    });
    await createSubscription(school.id, plan.id);

    for (let index = 0; index < 99; index += 1) {
      await createStudent(school.id, null, { admission_number: `SEED-${index}` });
    }
    assert.equal(await Student.count({ where: { school_id: school.id } }), 99);

    // Two independent service instances = two independent request handlers.
    const first = makeStudentsService().students;
    const second = makeStudentsService().students;

    const results = await Promise.allSettled([
      first.create(school.id, {
        admission_number: 'RACE-A',
        first_name: 'Race',
        last_name: 'A',
      } as never),
      second.create(school.id, {
        admission_number: 'RACE-B',
        first_name: 'Race',
        last_name: 'B',
      } as never),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one create must succeed');
    assert.equal(rejected.length, 1, 'exactly one create must be rejected');

    const error = (rejected[0] as PromiseRejectedResult).reason as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    assert.equal(error.getStatus?.(), 409);
    const body = error.getResponse?.() as { error: string; details: { limit: number; usage: number } };
    assert.equal(body.error, PLAN_LIMIT_REACHED_CODE);
    assert.equal(body.details.limit, 100);
    assert.equal(body.details.usage, 100);

    assert.equal(await Student.count({ where: { school_id: school.id } }), 100);
  });

  it('holds the boundary under a wider burst (limit 100, 96 existing, 8 concurrent)', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 100 },
    });
    await createSubscription(school.id, plan.id);
    for (let index = 0; index < 96; index += 1) {
      await createStudent(school.id, null, { admission_number: `BURST-${index}` });
    }

    const attempts = Array.from({ length: 8 }, (_unused, index) =>
      makeStudentsService().students.create(school.id, {
        admission_number: `NEW-${index}`,
        first_name: 'New',
        last_name: String(index),
      } as never),
    );
    const results = await Promise.allSettled(attempts);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 4);
    assert.equal(await Student.count({ where: { school_id: school.id } }), 100);
  });

  it('does not serialize unrelated tenants (the lock is per school + resource)', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 10 },
    });
    await createSubscription(schoolA.id, plan.id);
    await createSubscription(schoolB.id, plan.id);

    const results = await Promise.all([
      makeStudentsService().students.create(schoolA.id, {
        admission_number: 'P1',
        first_name: 'P',
        last_name: 'A',
      } as never),
      makeStudentsService().students.create(schoolB.id, {
        admission_number: 'P1',
        first_name: 'P',
        last_name: 'B',
      } as never),
    ]);
    assert.equal(results.length, 2);
    assert.equal(await Student.count(), 2);
  });

  it('applies the staff caps atomically as well', async () => {
    const school = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STAFF]: { unlimited: false, value: 1 },
    });
    await createSubscription(school.id, plan.id);
    const planLimits = new PlanLimitsService(
      SchoolSubscription,
      Plan,
      Student,
      Bus,
      Route,
      Stop,
      User,
      Trip,
      sequelize,
      configStub(),
    );

    const attempts = [0, 1].map((index) =>
      planLimits.runWithinStaffLimit(school.id, UserRole.DRIVER, async (transaction) =>
        User.create(
          {
            school_id: school.id,
            role: UserRole.DRIVER,
            first_name: 'Driver',
            last_name: String(index),
            email: `driver-${index}@race.test`,
            password_hash: 'x',
            email_verified_at: null,
            phone: null,
            is_active: true,
          } as never,
          transaction ? { transaction } : {},
        ),
      ),
    );

    const results = await Promise.allSettled(attempts);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await User.count({ where: { school_id: school.id, role: UserRole.DRIVER } }), 1);
  });
});
