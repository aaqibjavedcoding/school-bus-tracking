import { Inject, Injectable } from '@nestjs/common';
import {
  AdminDashboardRevenueEstimate,
  AdminDashboardResponse,
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  PlanBillingPeriod,
  PersistedSubscriptionStatus,
  SubscriptionStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  Plan,
  Route,
  School,
  SchoolSubscription,
  Student,
  Trip,
  User,
} from '../../database/models';
import {
  ADMIN_BUSES_REPOSITORY,
  ADMIN_PLANS_REPOSITORY,
  ADMIN_ROUTES_REPOSITORY,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_STUDENTS_REPOSITORY,
  ADMIN_SUBSCRIPTIONS_REPOSITORY,
  ADMIN_TRIPS_REPOSITORY,
  ADMIN_USERS_REPOSITORY,
} from './admin.constants';
import { toAdminPlanResponse } from './admin-plans.mapper';

/** Result of one grouped COUNT(*) query. */
type GroupCount = Record<string, number | string | boolean>;

/** Non-terminal trip states — the platform's "relevant" live trips. */
const ACTIVE_TRIP_STATUSES = [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS];

/** Places the dashboard explicitly in estimate territory. */
export const DASHBOARD_REVENUE_NOTE =
  'Estimated from plan catalogue list prices attached to live subscriptions. No payment provider, invoicing or cash ledger is connected, so these figures are estimates only and do not represent billed or received revenue.';

/** Minimal subscription shape used for the in-memory current-row selection. */
interface SubscriptionRow {
  school_id: string;
  plan_id: string;
  status: PersistedSubscriptionStatus;
}

/** An in-memory subscription row chosen as the school's current (live-first) state. */
interface ChosenSubscription {
  school_id: string;
  plan_id: string | null;
  status: PersistedSubscriptionStatus;
  price_cents: number | null;
  currency: string | null;
  billing_period: PlanBillingPeriod | null;
}

/**
 * SaaS-level platform dashboard for the Super Admin console.
 *
 * All metrics come from a fixed set of grouped aggregate queries plus one
 * bulk subscription read (no per-school iteration and no N+1). The response
 * shape is intentionally flat and additive. Subscription metrics are derived
 * from the existing `plans` and `school_subscriptions` tables; revenue is
 * always labelled as an estimate because no payment system is connected.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(ADMIN_SCHOOLS_REPOSITORY) private readonly schools: typeof School,
    @Inject(ADMIN_USERS_REPOSITORY) private readonly users: typeof User,
    @Inject(ADMIN_STUDENTS_REPOSITORY) private readonly students: typeof Student,
    @Inject(ADMIN_BUSES_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(ADMIN_ROUTES_REPOSITORY) private readonly routes: typeof Route,
    @Inject(ADMIN_TRIPS_REPOSITORY) private readonly trips: typeof Trip,
    @Inject(ADMIN_SUBSCRIPTIONS_REPOSITORY)
    private readonly subscriptions: typeof SchoolSubscription,
    @Inject(ADMIN_PLANS_REPOSITORY) private readonly plans: typeof Plan,
  ) {}

  async getMetrics(): Promise<AdminDashboardResponse> {
    const sequelize = this.schools.sequelize!;
    // Casts bridge the Sequelize typings for aggregate aliases — the runtime
    // shape is verified by the grouped-result parsing below.
    const count = (column: unknown) => sequelize.fn('COUNT', column as never) as never;
    const col = (name: string) => sequelize.col(name);

    const [schoolRows, userRoleRows, studentRows, busRows, routeRows, tripRows, planRows] =
      await Promise.all([
        this.schools.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.users.findAll({
          attributes: ['role', [count(col('id')), 'count']],
          group: ['role'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.students.findAll({
          attributes: [count(col('id'))],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.buses.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.routes.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.trips.findAll({
          attributes: ['status', [count(col('id')), 'count']],
          group: ['status'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.plans.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
      ]);

    // Schools
    let activeSchools = 0;
    let inactiveSchools = 0;
    for (const row of schoolRows) {
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activeSchools += Number(row.count ?? 0);
      } else {
        inactiveSchools += Number(row.count ?? 0);
      }
    }
    const totalSchools = activeSchools + inactiveSchools;

    // Users
    let schoolAdmins = 0;
    let drivers = 0;
    let conductors = 0;
    let parents = 0;
    let superAdmins = 0;
    for (const row of userRoleRows) {
      const value = Number(row.count ?? 0);
      switch (row.role) {
        case UserRole.SCHOOL_ADMIN:
          schoolAdmins += value;
          break;
        case UserRole.DRIVER:
          drivers += value;
          break;
        case UserRole.CONDUCTOR:
          conductors += value;
          break;
        case UserRole.PARENT:
          parents += value;
          break;
        case UserRole.SUPER_ADMIN:
          superAdmins += value;
          break;
      }
    }
    const students = Number(studentRows[0]?.count ?? 0);

    // Transport
    let activeBuses = 0;
    let totalBuses = 0;
    for (const row of busRows) {
      const value = Number(row.count ?? 0);
      totalBuses += value;
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activeBuses += value;
      }
    }
    let activeRoutes = 0;
    let totalRoutes = 0;
    for (const row of routeRows) {
      const value = Number(row.count ?? 0);
      totalRoutes += value;
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activeRoutes += value;
      }
    }
    let activeTrips = 0;
    let totalTrips = 0;
    for (const row of tripRows) {
      const value = Number(row.count ?? 0);
      totalTrips += value;
      if (ACTIVE_TRIP_STATUSES.includes(row.status as TripStatus)) {
        activeTrips += value;
      }
    }

    // Plans
    let activePlans = 0;
    let inactivePlans = 0;
    for (const row of planRows) {
      const value = Number(row.count ?? 0);
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activePlans += value;
      } else {
        inactivePlans += value;
      }
    }
    const totalPlans = activePlans + inactivePlans;

    // Subscription model. We read the full table once and reduce in memory —
    // there is no N+1 and the platform console is the only consumer.
    const [subscriptionRows, planDefs] = await Promise.all([
      this.subscriptions.findAll({
        attributes: ['school_id', 'plan_id', 'status'],
        order: [['created_at', 'DESC']],
      }) as unknown as Promise<SubscriptionRow[]>,
      this.plans.findAll() as unknown as Promise<Plan[]>,
    ]);
    const planById = new Map(planDefs.map((plan) => [plan.id, plan]));
    const chosen = this.chooseCurrentSubscriptions(subscriptionRows);

    // Enrich chosen rows with the commercial terms of their plan.
    for (const row of chosen.values()) {
      const plan = row.plan_id ? planById.get(row.plan_id) : undefined;
      row.price_cents = plan?.price_cents ?? null;
      row.currency = plan?.currency ?? null;
      row.billing_period = plan?.billing_period ?? null;
    }

    const subscriptionMetrics: AdminDashboardResponse['subscriptions'] = {
      total: subscriptionRows.length,
      live: 0,
      trialing: 0,
      active: 0,
      past_due: 0,
      cancelled: 0,
      expired: 0,
    };
    for (const row of subscriptionRows) {
      const status = row.status;
      subscriptionMetrics[status] += 1;
      if ((LIVE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(status)) {
        subscriptionMetrics.live += 1;
      }
    }

    const statusDistribution = new Map<SubscriptionStatus, number>();
    for (const row of chosen.values()) {
      statusDistribution.set(row.status, (statusDistribution.get(row.status) ?? 0) + 1);
    }
    const noneSchools = Math.max(0, totalSchools - chosen.size);
    const schoolSubscriptionStatus: AdminDashboardResponse['school_subscription_status'] = (
      [
        { status: SubscriptionStatus.NONE, schools: noneSchools },
        ...(['trialing', 'active', 'past_due', 'cancelled', 'expired'] as const).map((status) => ({
          status: status as SubscriptionStatus,
          schools: statusDistribution.get(status as SubscriptionStatus) ?? 0,
        })),
      ] as AdminDashboardResponse['school_subscription_status']
    ).filter((item) => item.schools > 0);

    const planBucket = new Map<string, { planId: string; schools: number; live_schools: number }>();
    for (const row of chosen.values()) {
      if (!row.plan_id) continue;
      const bucket =
        planBucket.get(row.plan_id) ?? { planId: row.plan_id, schools: 0, live_schools: 0 };
      bucket.schools += 1;
      if ((LIVE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(row.status)) {
        bucket.live_schools += 1;
      }
      planBucket.set(row.plan_id, bucket);
    }

    const planDistribution: AdminDashboardResponse['plan_distribution'] = [];
    for (const [planId, bucket] of planBucket) {
      const plan = planById.get(planId);
      const response = plan ? toAdminPlanResponse(plan) : null;
      planDistribution.push({
        plan_id: planId,
        plan_code: response?.code ?? null,
        plan_name: response?.name ?? null,
        price: response?.price ?? null,
        currency: response?.currency ?? null,
        billing_period: response?.billing_period ?? null,
        schools: bucket.schools,
        live_schools: bucket.live_schools,
      });
    }
    planDistribution.sort(
      (a, b) => b.schools - a.schools || (a.plan_name ?? '').localeCompare(b.plan_name ?? ''),
    );

    const revenueBuckets = new Map<
      string,
      { sumMrrCents: number; sumArrCents: number; liveSubscriptions: number }
    >();
    for (const row of chosen.values()) {
      if (!row.plan_id || !(LIVE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(row.status)) {
        continue;
      }
      const priceCents = row.price_cents ?? 0;
      const currency = row.currency;
      if (
        !currency ||
        (row.billing_period !== PlanBillingPeriod.MONTHLY &&
          row.billing_period !== PlanBillingPeriod.YEARLY)
      ) {
        continue;
      }
      const bucket = revenueBuckets.get(currency) ?? {
        sumMrrCents: 0,
        sumArrCents: 0,
        liveSubscriptions: 0,
      };
      const monthly = row.billing_period === PlanBillingPeriod.YEARLY ? priceCents / 12 : priceCents;
      bucket.sumMrrCents += monthly;
      bucket.sumArrCents += monthly * 12;
      bucket.liveSubscriptions += 1;
      revenueBuckets.set(currency, bucket);
    }

    const estimatedRevenue: AdminDashboardRevenueEstimate[] = [...revenueBuckets.entries()]
      .map(([currency, bucket]) => ({
        currency,
        estimated_mrr: money(bucket.sumMrrCents),
        estimated_arr: money(bucket.sumArrCents),
        live_subscriptions: bucket.liveSubscriptions,
      }))
      .sort(
        (a, b) => b.live_subscriptions - a.live_subscriptions || a.currency.localeCompare(b.currency),
      );

    return {
      schools: {
        total: totalSchools,
        active: activeSchools,
        inactive: inactiveSchools,
      },
      users: {
        total: schoolAdmins + students + parents + drivers + conductors,
        school_admins: schoolAdmins,
        students,
        parents,
        drivers,
        conductors,
        super_admins: superAdmins,
      },
      transport: {
        buses: totalBuses,
        active_buses: activeBuses,
        routes: totalRoutes,
        active_routes: activeRoutes,
        trips: totalTrips,
        active_trips: activeTrips,
      },
      subscriptions: subscriptionMetrics,
      plans: { total: totalPlans, active: activePlans, inactive: inactivePlans },
      plan_distribution: planDistribution,
      school_subscription_status: schoolSubscriptionStatus,
      estimated_revenue: estimatedRevenue,
      revenue_note: DASHBOARD_REVENUE_NOTE,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Chooses the current subscription of each school: a live row when one
   * exists, otherwise the newest historical row. Rows are pre-sorted newest
   * first by the caller.
   */
  private chooseCurrentSubscriptions(rows: SubscriptionRow[]): Map<string, ChosenSubscription> {
    const chosen = new Map<string, ChosenSubscription>();
    for (const row of rows) {
      const schoolId = row.school_id;
      if (chosen.has(schoolId)) continue;
      chosen.set(schoolId, {
        school_id: schoolId,
        plan_id: row.plan_id,
        status: row.status,
        price_cents: null,
        currency: null,
        billing_period: null,
      });
    }
    // Rows are newest-first, so a live row can only replace a historical one.
    for (const row of rows) {
      const schoolId = row.school_id;
      const current = chosen.get(schoolId);
      if (!current) continue;
      if ((LIVE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(current.status)) continue;
      if ((LIVE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(row.status)) {
        chosen.set(schoolId, {
          school_id: schoolId,
          plan_id: row.plan_id,
          status: row.status,
          price_cents: null,
          currency: null,
          billing_period: null,
        });
      }
    }
    return chosen;
  }
}

/** Cents → decimal string with two fraction digits ("12.34"). */
function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}
