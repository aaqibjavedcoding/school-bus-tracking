import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PlanBillingPeriod,
  PlanLimitResource,
  SubscriptionStatus,
  type AdminDashboardResponse,
  type AdminSchoolStats,
} from '@school-bus-tracking/shared-types';
import {
  compactUsage,
  formatLimit,
  monthlyPriceOf,
  planDistributionBars,
  resourceBars,
  revenueByPlan,
  schoolStatusSlices,
  schoolUsageRows,
  schoolsWithSubscriptionStatus,
  subscriptionStatusSlices,
  subscriptionTone,
  usagePercent,
  usageTone,
} from './metrics.ts';

const dashboard: AdminDashboardResponse = {
  schools: { total: 5, active: 4, inactive: 1 },
  users: {
    total: 100,
    school_admins: 6,
    students: 60,
    parents: 20,
    drivers: 8,
    conductors: 6,
    super_admins: 1,
  },
  transport: {
    buses: 12,
    active_buses: 10,
    routes: 9,
    active_routes: 7,
    trips: 40,
    active_trips: 3,
  },
  subscriptions: {
    total: 7,
    live: 4,
    trialing: 1,
    active: 2,
    past_due: 1,
    cancelled: 2,
    expired: 1,
  },
  plans: { total: 3, active: 2, inactive: 1 },
  plan_distribution: [
    {
      plan_id: 'plan-pro',
      plan_code: 'pro',
      plan_name: 'Pro',
      price: '100.00',
      currency: 'INR',
      billing_period: PlanBillingPeriod.MONTHLY,
      schools: 3,
      live_schools: 2,
    },
    {
      plan_id: 'plan-year',
      plan_code: 'year',
      plan_name: 'Yearly',
      price: '1200.00',
      currency: 'INR',
      billing_period: PlanBillingPeriod.YEARLY,
      schools: 1,
      live_schools: 1,
    },
    {
      plan_id: 'plan-free',
      plan_code: 'free',
      plan_name: 'Free',
      price: '0.00',
      currency: 'INR',
      billing_period: PlanBillingPeriod.MONTHLY,
      schools: 1,
      live_schools: 1,
    },
  ],
  school_subscription_status: [
    { status: SubscriptionStatus.NONE, schools: 1 },
    { status: SubscriptionStatus.TRIALING, schools: 1 },
    { status: SubscriptionStatus.ACTIVE, schools: 2 },
    { status: SubscriptionStatus.PAST_DUE, schools: 1 },
  ],
  estimated_revenue: [
    { currency: 'INR', estimated_mrr: '300.00', estimated_arr: '3600.00', live_subscriptions: 4 },
  ],
  revenue_note: 'estimates only',
  generated_at: '2026-09-01T00:00:00.000Z',
};

describe('admin dashboard metrics', () => {
  it('reads the number of schools per current subscription status', () => {
    assert.equal(schoolsWithSubscriptionStatus(dashboard, SubscriptionStatus.TRIALING), 1);
    assert.equal(schoolsWithSubscriptionStatus(dashboard, SubscriptionStatus.ACTIVE), 2);
    // A status that is absent from the payload is zero, never undefined.
    assert.equal(schoolsWithSubscriptionStatus(dashboard, SubscriptionStatus.EXPIRED), 0);
  });

  it('builds school-status slices and drops empty buckets', () => {
    const slices = schoolStatusSlices(dashboard);
    assert.deepEqual(
      slices.map((slice) => [slice.key, slice.value]),
      [
        ['active', 4],
        ['inactive', 1],
      ],
    );
    assert.equal(schoolStatusSlices({ schools: { total: 0, active: 0, inactive: 0 } }).length, 0);
  });

  it('labels and tones the subscription distribution', () => {
    const slices = subscriptionStatusSlices(dashboard);
    assert.equal(slices.length, 4);
    const active = slices.find((slice) => slice.key === SubscriptionStatus.ACTIVE);
    assert.equal(active?.label, 'Active');
    assert.equal(active?.tone, 'success');
    assert.equal(subscriptionTone(SubscriptionStatus.PAST_DUE), 'warning');
    assert.equal(subscriptionTone(SubscriptionStatus.CANCELLED), 'danger');
    assert.equal(subscriptionTone(SubscriptionStatus.NONE), 'neutral');
  });

  it('summarises the plan distribution with live counts', () => {
    const bars = planDistributionBars(dashboard);
    assert.equal(bars[0].label, 'Pro');
    assert.equal(bars[0].value, 3);
    assert.equal(bars[0].display, '3 (2 live)');
  });

  it('sorts platform resources by size', () => {
    const bars = resourceBars(dashboard);
    assert.equal(bars[0].key, 'students');
    assert.ok(bars[0].value >= bars[1].value);
  });
});

describe('estimated revenue derivation', () => {
  it('normalises yearly prices to a monthly figure', () => {
    assert.equal(monthlyPriceOf('1200.00', PlanBillingPeriod.YEARLY), 100);
    assert.equal(monthlyPriceOf(50, PlanBillingPeriod.MONTHLY), 50);
    assert.equal(monthlyPriceOf('abc', PlanBillingPeriod.MONTHLY), 0);
    assert.equal(monthlyPriceOf('10', null), 0);
  });

  it('estimates MRR/ARR per plan from live schools only', () => {
    const rows = revenueByPlan(dashboard);
    // The zero-priced plan contributes nothing and is excluded.
    assert.deepEqual(
      rows.map((row) => row.plan_id),
      ['plan-pro', 'plan-year'],
    );
    assert.equal(rows[0].estimated_mrr, 200);
    assert.equal(rows[0].estimated_arr, 2400);
    assert.equal(rows[1].estimated_mrr, 100);
    // Shares are relative to the currency total (200 + 100).
    assert.equal(Math.round(rows[0].share), 67);
    assert.equal(Math.round(rows[1].share), 33);
  });

  it('returns nothing when no school holds a live subscription', () => {
    assert.deepEqual(
      revenueByPlan({
        plan_distribution: [
          {
            plan_id: 'p',
            plan_code: 'p',
            plan_name: 'P',
            price: '10.00',
            currency: 'INR',
            billing_period: PlanBillingPeriod.MONTHLY,
            schools: 2,
            live_schools: 0,
          },
        ],
      }),
      [],
    );
  });
});

describe('usage vs plan limits', () => {
  const stats: AdminSchoolStats = {
    admin_count: 2,
    active_admin_count: 2,
    student_count: 82,
    active_student_count: 80,
    driver_count: 5,
    conductor_count: 3,
    active_staff_count: 7,
    parent_count: 60,
    bus_count: 7,
    active_bus_count: 6,
    route_count: 12,
    active_route_count: 11,
    stop_count: 30,
    assignment_count: 9,
    active_assignment_count: 8,
    trip_count: 100,
    active_trip_count: 2,
  };

  it('caps percentages and never goes negative', () => {
    assert.equal(usagePercent(82, 100), 82);
    assert.equal(usagePercent(120, 100), 100);
    assert.equal(usagePercent(5, null), 0);
    assert.equal(usagePercent(-5, 100), 0);
  });

  it('tones a quota by how close it is to the cap', () => {
    assert.equal(usageTone(10, false), 'success');
    assert.equal(usageTone(80, false), 'warning');
    assert.equal(usageTone(100, false), 'danger');
    assert.equal(usageTone(100, true), 'info');
  });

  it('distinguishes unlimited from fixed and unset limits', () => {
    assert.equal(formatLimit({ unlimited: true, value: null }), 'Unlimited');
    assert.equal(formatLimit({ unlimited: false, value: 100 }), '100');
    assert.equal(formatLimit({ unlimited: false, value: null }), 'Not set');
    assert.equal(formatLimit(undefined), 'Not set');
    assert.equal(compactUsage(7, { unlimited: false, value: 10 }), '7 / 10');
    assert.equal(compactUsage(7, undefined), '7 / Not set');
  });

  it('maps tenant statistics onto the plan limit rows', () => {
    const rows = schoolUsageRows(stats, {
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 100 },
      [PlanLimitResource.BUSES]: { unlimited: false, value: 10 },
      [PlanLimitResource.ROUTES]: { unlimited: true, value: null },
    });

    const students = rows.find((row) => row.resource === PlanLimitResource.STUDENTS);
    assert.equal(students?.display, '82 / 100');
    assert.equal(students?.percent, 82);
    assert.equal(students?.tone, 'warning');

    const routes = rows.find((row) => row.resource === PlanLimitResource.ROUTES);
    assert.equal(routes?.unlimited, true);
    assert.equal(routes?.display, '12 / Unlimited');
    assert.equal(routes?.percent, 0);

    // Staff is the crew total; stops come from the new tenant stat.
    assert.equal(rows.find((row) => row.resource === PlanLimitResource.STAFF)?.usage, 8);
    assert.equal(rows.find((row) => row.resource === PlanLimitResource.STOPS)?.usage, 30);
    // Resources the plan does not constrain are still listed with no limit.
    assert.equal(rows.find((row) => row.resource === PlanLimitResource.TRIPS)?.limit, null);
  });

  it('works for a school without any plan at all', () => {
    const rows = schoolUsageRows(stats, null);
    assert.equal(rows.length, 9);
    assert.ok(rows.every((row) => row.limit === null && !row.unlimited));
  });
});
