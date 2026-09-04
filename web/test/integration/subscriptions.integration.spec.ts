import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import { createPlan, createSchool, createSubscription } from '../support/fixtures';
import { AdminSubscriptionsService } from '../../src/modules/admin/admin-subscriptions.service';
import { resolveSubscriptionEntitlement } from '../../src/common/subscriptions';
import { Plan, School, SchoolSubscription } from '../../src/database/models';

const DAY = 86_400_000;

/**
 * Subscription lifecycle against a real database.
 *
 * Covers the invariant the application relies on (at most one *live* row per
 * school, enforced by a partial unique index — not just by service code) and
 * the time-aware entitlement rules applied to real `timestamptz` values.
 */
describe('school subscriptions (real PostgreSQL)', () => {
  let sequelize: Sequelize;
  let service: AdminSubscriptionsService;

  before(async () => {
    sequelize = await prepareDatabase();
    service = new AdminSubscriptionsService(SchoolSubscription, School, Plan);
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  it('allows only one live subscription per school (partial unique index)', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

    await assert.rejects(
      createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE }),
      /unique|duplicate/i,
    );
    await assert.rejects(
      createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.TRIALING,
        trial_end: new Date(Date.now() + DAY),
      }),
      /unique|duplicate/i,
    );
  });

  it('keeps full history: terminal rows do not occupy the live slot', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    await createSubscription(school.id, plan.id, {
      status: SubscriptionStatus.CANCELLED,
      cancelled_at: new Date(),
    });
    await createSubscription(school.id, plan.id, { status: SubscriptionStatus.EXPIRED });
    const live = await createSubscription(school.id, plan.id, { status: SubscriptionStatus.ACTIVE });

    const all = await SchoolSubscription.findAll({ where: { school_id: school.id } });
    assert.equal(all.length, 3);
    assert.equal(
      all.filter((row) => row.status === SubscriptionStatus.ACTIVE)[0].id,
      live.id,
    );
  });

  it('serializes two concurrent "assign subscription" requests to a single live row', async () => {
    const school = await createSchool();
    const plan = await createPlan();

    const results = await Promise.allSettled([
      service.createSubscription(school.id, { plan_id: plan.id }),
      service.createSubscription(school.id, { plan_id: plan.id }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);

    const live = await SchoolSubscription.count({
      where: { school_id: school.id, status: SubscriptionStatus.ACTIVE },
    });
    assert.equal(live, 1);
  });

  it('rejects the projection-only "none" status at the database level', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    await assert.rejects(
      sequelize.query(
        `INSERT INTO school_subscriptions
           (id, school_id, plan_id, status, current_period_start, created_at, updated_at)
         VALUES ($id, $school, $plan, 'none', now(), now(), now())`,
        { bind: { id: randomUUID(), school: school.id, plan: plan.id }, type: QueryTypes.INSERT },
      ),
      /ck_school_subscriptions_status_not_none|violates check/i,
    );
  });

  it('rejects a trialing row without a trial end and an inverted period', async () => {
    const school = await createSchool();
    const plan = await createPlan();

    await assert.rejects(
      createSubscription(school.id, plan.id, {
        status: SubscriptionStatus.TRIALING,
        trial_end: null,
      }),
      /violates check|trialing_requires_trial_end/i,
    );

    await assert.rejects(
      createSubscription(school.id, plan.id, {
        current_period_start: new Date(Date.now() + 10 * DAY),
        current_period_end: new Date(Date.now() - 10 * DAY),
      }),
      /violates check|period_range/i,
    );
  });

  it('protects a referenced plan from deletion (ON DELETE RESTRICT)', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    await createSubscription(school.id, plan.id);
    await assert.rejects(
      sequelize.query('DELETE FROM plans WHERE id = $id', { bind: { id: plan.id } }),
      /foreign key|violates/i,
    );
  });

  it('resolves the entitlement of persisted rows in a time-aware way', async () => {
    const school = await createSchool();
    const plan = await createPlan();

    const expired = await createSubscription(school.id, plan.id, {
      status: SubscriptionStatus.ACTIVE,
      current_period_start: new Date(Date.now() - 40 * DAY),
      current_period_end: new Date(Date.now() - 10 * DAY),
    });
    const reloaded = await SchoolSubscription.findByPk(expired.id);
    const entitlement = resolveSubscriptionEntitlement(reloaded!, new Date());
    assert.equal(entitlement.has_paid_access, false);
    assert.equal(entitlement.effective_status, SubscriptionStatus.EXPIRED);
    // The stored status is untouched — access eligibility and persisted
    // lifecycle status are separate concerns.
    assert.equal(reloaded!.status, SubscriptionStatus.ACTIVE);
  });

  it('reads timestamps back as absolute instants regardless of session timezone', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    const end = new Date(Date.now() + 5 * DAY);
    const row = await createSubscription(school.id, plan.id, { current_period_end: end });

    await sequelize.query("SET TIME ZONE 'Pacific/Kiritimati'");
    const inKiritimati = await SchoolSubscription.findByPk(row.id);
    assert.equal(
      resolveSubscriptionEntitlement(inKiritimati!, new Date()).has_paid_access,
      true,
    );
    assert.equal(new Date(inKiritimati!.current_period_end as Date).getTime(), end.getTime());

    await sequelize.query("SET TIME ZONE 'UTC'");
  });

  it('repairs a stored-live row whose window elapsed, without a cron job', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    const stale = await createSubscription(school.id, plan.id, {
      status: SubscriptionStatus.ACTIVE,
      current_period_start: new Date(Date.now() - 60 * DAY),
      current_period_end: new Date(Date.now() - DAY),
    });

    const response = await service.getSubscription(school.id);
    assert.equal(response.status, SubscriptionStatus.EXPIRED);

    const reloaded = await SchoolSubscription.findByPk(stale.id);
    assert.equal(reloaded?.status, SubscriptionStatus.EXPIRED);
  });

  it('frees the live slot once a lapsed row is repaired', async () => {
    const school = await createSchool();
    const plan = await createPlan();
    await createSubscription(school.id, plan.id, {
      status: SubscriptionStatus.TRIALING,
      trial_start: new Date(Date.now() - 30 * DAY),
      trial_end: new Date(Date.now() - DAY),
      current_period_end: null,
    });

    // Before the fix this raised "school already has a subscription".
    const created = await service.createSubscription(school.id, { plan_id: plan.id });
    assert.equal(created.status, SubscriptionStatus.ACTIVE);
    assert.equal(await SchoolSubscription.count({ where: { school_id: school.id } }), 2);
  });

  it('reports "none" for a school with no subscription row', async () => {
    const school = await createSchool();
    const response = await service.getSubscription(school.id);
    assert.equal(response.status, SubscriptionStatus.NONE);
    assert.equal(resolveSubscriptionEntitlement(null).has_paid_access, false);
  });
});
