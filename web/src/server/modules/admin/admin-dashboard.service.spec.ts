import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PlanBillingPeriod,
  SubscriptionStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * Verifies the dashboard rollup math over canned grouped COUNT rows. The
 * service issues fixed aggregate queries plus one bulk subscription read
 * (no per-school iteration); the stubs below emulate Postgres grouping rows.
 */
function rows(...data: Array<Record<string, unknown>>): Promise<unknown[]> {
  return Promise.resolve(data);
}

const PLAN_A = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'pro',
  name: 'Pro',
  description: 'Pro tier',
  price_cents: 4900,
  currency: 'USD',
  billing_period: PlanBillingPeriod.MONTHLY,
  is_active: true,
  features: { live_tracking: true },
  limits: { students: { unlimited: false, value: 500 } },
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};
const PLAN_B = {
  ...PLAN_A,
  id: '22222222-2222-4222-8222-222222222223',
  code: 'enterprise',
  name: 'Enterprise',
  price_cents: 120000,
  billing_period: PlanBillingPeriod.YEARLY,
};
const PLAN_C = {
  ...PLAN_A,
  id: '22222222-2222-4222-8222-222222222224',
  code: 'retired',
  name: 'Retired',
  is_active: false,
};

function makeService() {
  const queryCount: Record<string, number> = {
    schools: 0,
    users: 0,
    students: 0,
    buses: 0,
    routes: 0,
    trips: 0,
    plans: 0,
    subscriptions: 0,
  };

  const sequelize = {
    fn: (name: string, col: unknown) => ({ fn: name, col }),
    col: (name: string) => name,
  };

  const schools = {
    sequelize,
    findAll: async () => {
      queryCount.schools += 1;
      return rows({ is_active: true, count: '4' }, { is_active: false, count: '1' });
    },
  };
  const users = {
    sequelize,
    findAll: async () => {
      queryCount.users += 1;
      return rows(
        { role: UserRole.SCHOOL_ADMIN, count: '4' },
        { role: UserRole.DRIVER, count: '10' },
        { role: UserRole.CONDUCTOR, count: '8' },
        { role: UserRole.PARENT, count: '25' },
        { role: UserRole.SUPER_ADMIN, count: '2' },
      );
    },
  };
  const students = {
    sequelize,
    findAll: async () => {
      queryCount.students += 1;
      return rows({ count: '120' });
    },
  };
  const buses = {
    sequelize,
    findAll: async () => {
      queryCount.buses += 1;
      return rows({ is_active: true, count: '6' }, { is_active: false, count: '2' });
    },
  };
  const routes = {
    sequelize,
    findAll: async () => {
      queryCount.routes += 1;
      return rows({ is_active: true, count: '5' }, { is_active: false, count: '1' });
    },
  };
  const trips = {
    sequelize,
    findAll: async () => {
      queryCount.trips += 1;
      return rows(
        { status: 'SCHEDULED', count: '3' },
        { status: 'IN_PROGRESS', count: '2' },
        { status: 'COMPLETED', count: '50' },
        { status: 'CANCELLED', count: '4' },
      );
    },
  };

  const planDefs = [PLAN_A, PLAN_B, PLAN_C];
  const plans = {
    sequelize,
    findAll: async (options?: Record<string, unknown>) => {
      queryCount.plans += 1;
      if (!options || !options.group) {
        return Promise.resolve(planDefs);
      }
      return rows(
        { is_active: true, count: '2' },
        { is_active: false, count: '1' },
      );
    },
  };

  const subscriptionRows = [
    { school_id: '11111111-1111-4111-8111-111111111111', plan_id: PLAN_A.id, status: SubscriptionStatus.ACTIVE },
    { school_id: '11111111-1111-4111-8111-111111111112', plan_id: PLAN_B.id, status: SubscriptionStatus.TRIALING },
    { school_id: '11111111-1111-4111-8111-111111111113', plan_id: PLAN_A.id, status: SubscriptionStatus.EXPIRED },
    { school_id: '11111111-1111-4111-8111-111111111114', plan_id: PLAN_B.id, status: SubscriptionStatus.CANCELLED },
  ];
  const subscriptions = {
    sequelize,
    findAll: async () => {
      queryCount.subscriptions += 1;
      return Promise.resolve(subscriptionRows);
    },
  };

  const service = new AdminDashboardService(
    schools as never,
    users as never,
    students as never,
    buses as never,
    routes as never,
    trips as never,
    subscriptions as never,
    plans as never,
  );
  return { service, queryCount };
}

describe('AdminDashboardService.getMetrics', () => {
  it('aggregates school, user and transport counts correctly', async () => {
    const { service } = makeService();
    const metrics = await service.getMetrics();

    assert.deepEqual(metrics.schools, { total: 5, active: 4, inactive: 1 });

    assert.equal(metrics.users.school_admins, 4);
    assert.equal(metrics.users.students, 120);
    assert.equal(metrics.users.parents, 25);
    assert.equal(metrics.users.drivers, 10);
    assert.equal(metrics.users.conductors, 8);
    assert.equal(metrics.users.super_admins, 2);
    assert.equal(metrics.users.total, 4 + 120 + 25 + 10 + 8);

    assert.equal(metrics.transport.buses, 8);
    assert.equal(metrics.transport.active_buses, 6);
    assert.equal(metrics.transport.routes, 6);
    assert.equal(metrics.transport.active_routes, 5);
    assert.equal(metrics.transport.trips, 59);
    assert.equal(metrics.transport.active_trips, 5);

    assert.ok(!Number.isNaN(Date.parse(metrics.generated_at)));
  });

  it('reports real plan and subscription rollups with estimated revenue', async () => {
    const { service } = makeService();
    const metrics = await service.getMetrics();

    assert.deepEqual(metrics.plans, { total: 3, active: 2, inactive: 1 });
    assert.deepEqual(metrics.subscriptions, {
      total: 4,
      live: 2,
      trialing: 1,
      active: 1,
      past_due: 0,
      cancelled: 1,
      expired: 1,
    });

    assert.deepEqual(
      metrics.school_subscription_status.find((item) => item.status === SubscriptionStatus.NONE),
      { status: SubscriptionStatus.NONE, schools: 1 },
    );

    const pro = metrics.plan_distribution.find((item) => item.plan_id === PLAN_A.id);
    assert.ok(pro);
    assert.equal(pro.plan_name, 'Pro');
    assert.equal(pro.schools, 2);
    assert.equal(pro.live_schools, 1);

    const enterprise = metrics.plan_distribution.find((item) => item.plan_id === PLAN_B.id);
    assert.ok(enterprise);
    assert.equal(enterprise.schools, 2);
    assert.equal(enterprise.live_schools, 1);

    // Pro = 49.00/mo; Enterprise = $1200/yr => 100.00/mo.
    const revenue = metrics.estimated_revenue.find((item) => item.currency === 'USD');
    assert.ok(revenue);
    assert.equal(revenue.estimated_mrr, '149.00');
    assert.equal(revenue.estimated_arr, '1788.00');
    assert.equal(revenue.live_subscriptions, 2);
    assert.match(metrics.revenue_note, /estimate/i);
  });

  it('uses a fixed number of aggregate queries (no N+1)', async () => {
    const { service, queryCount } = makeService();
    await service.getMetrics();
    // One grouped query per table + one bulk subscription read.
    assert.equal(queryCount.schools, 1);
    assert.equal(queryCount.users, 1);
    assert.equal(queryCount.students, 1);
    assert.equal(queryCount.buses, 1);
    assert.equal(queryCount.routes, 1);
    assert.equal(queryCount.trips, 1);
    assert.equal(queryCount.plans, 2);
    assert.equal(queryCount.subscriptions, 1);
  });
});
