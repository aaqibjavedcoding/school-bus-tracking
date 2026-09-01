import {
  PLAN_LIMIT_RESOURCE_LABELS,
  PlanBillingPeriod,
  PlanLimitResource,
  SUBSCRIPTION_STATUS_LABELS,
  SubscriptionStatus,
  type AdminDashboardResponse,
  type AdminSchoolStats,
  type PlanLimitsConfig,
  type PlanLimitValue,
} from '@school-bus-tracking/shared-types';

/**
 * Pure derivation helpers for the Super Admin console.
 *
 * Everything here is plain data-in / data-out so the Node test runner can
 * execute it directly (like `features/admin/subscriptions/helpers.ts`), and so
 * the dashboard, revenue and school-detail screens all derive their numbers
 * from one audited implementation instead of re-computing them inline.
 *
 * Nothing in this file invents data: every figure is read from what the
 * existing `/admin/*` endpoints already return. Revenue values are **always**
 * estimates derived from plan list prices — no payment provider is connected.
 */

/** Badge/segment tone shared with `components/ui`. */
export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** One slice of a donut/segmented bar. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

/** One row of a horizontal bar list. */
export interface BarRow {
  key: string;
  label: string;
  hint?: string;
  value: number;
  /** Right-aligned display value; defaults to the raw number. */
  display?: string;
  tone?: Tone;
}

/** Number of schools whose *current* subscription is in `status`. */
export function schoolsWithSubscriptionStatus(
  data: Pick<AdminDashboardResponse, 'school_subscription_status'>,
  status: SubscriptionStatus,
): number {
  return data.school_subscription_status.find((row) => row.status === status)?.schools ?? 0;
}

/** Schools split by tenant lifecycle (active / inactive). */
export function schoolStatusSlices(data: Pick<AdminDashboardResponse, 'schools'>): Slice[] {
  return [
    { key: 'active', label: 'Active', value: data.schools.active, tone: 'success' },
    { key: 'inactive', label: 'Inactive', value: data.schools.inactive, tone: 'warning' },
  ].filter((slice) => slice.value > 0) as Slice[];
}

/** Tone used for each subscription state across the console. */
export function subscriptionTone(status: SubscriptionStatus): Tone {
  switch (status) {
    case SubscriptionStatus.ACTIVE:
      return 'success';
    case SubscriptionStatus.TRIALING:
      return 'info';
    case SubscriptionStatus.PAST_DUE:
      return 'warning';
    case SubscriptionStatus.CANCELLED:
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Schools split by the state of their current/latest subscription. */
export function subscriptionStatusSlices(
  data: Pick<AdminDashboardResponse, 'school_subscription_status'>,
): Slice[] {
  return data.school_subscription_status
    .filter((row) => row.schools > 0)
    .map((row) => ({
      key: row.status,
      label: SUBSCRIPTION_STATUS_LABELS[row.status],
      value: row.schools,
      tone: subscriptionTone(row.status),
    }));
}

/** Schools grouped by the plan of their current subscription. */
export function planDistributionBars(
  data: Pick<AdminDashboardResponse, 'plan_distribution'>,
): BarRow[] {
  return data.plan_distribution.map((row) => ({
    key: row.plan_id ?? 'none',
    label: row.plan_name ?? 'Unknown plan',
    hint: row.plan_code ?? undefined,
    value: row.schools,
    display: `${row.schools} (${row.live_schools} live)`,
    tone: 'info' as Tone,
  }));
}

/** Platform-wide resource counts, largest first, for the resource bar list. */
export function resourceBars(data: Pick<AdminDashboardResponse, 'users' | 'transport'>): BarRow[] {
  const rows: BarRow[] = [
    { key: 'students', label: 'Students', value: data.users.students },
    { key: 'parents', label: 'Parents / Guardians', value: data.users.parents },
    { key: 'drivers', label: 'Drivers', value: data.users.drivers },
    { key: 'conductors', label: 'Conductors', value: data.users.conductors },
    { key: 'admins', label: 'School admins', value: data.users.school_admins },
    { key: 'buses', label: 'Buses', value: data.transport.buses },
    { key: 'routes', label: 'Routes', value: data.transport.routes },
    { key: 'trips', label: 'Trips', value: data.transport.trips },
  ];
  return rows.sort((a, b) => b.value - a.value);
}

/** Estimated monthly value of one plan subscription, in major currency units. */
export function monthlyPriceOf(
  price: string | number | null,
  billingPeriod: PlanBillingPeriod | null,
): number {
  const amount = typeof price === 'string' ? Number(price) : (price ?? 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  if (billingPeriod === PlanBillingPeriod.YEARLY) return amount / 12;
  if (billingPeriod === PlanBillingPeriod.MONTHLY) return amount;
  return 0;
}

/** One plan's estimated contribution to platform revenue. */
export interface PlanRevenueEstimate {
  plan_id: string;
  plan_name: string;
  plan_code: string | null;
  currency: string;
  live_schools: number;
  estimated_mrr: number;
  estimated_arr: number;
  /** Share of the estimated MRR of the same currency, 0–100. */
  share: number;
}

/**
 * Estimated revenue split per plan, derived only from the dashboard payload
 * (list price × schools on a live subscription). Plans without a price,
 * currency or supported billing period contribute nothing.
 */
export function revenueByPlan(
  data: Pick<AdminDashboardResponse, 'plan_distribution'>,
): PlanRevenueEstimate[] {
  const rows: PlanRevenueEstimate[] = [];
  for (const item of data.plan_distribution) {
    if (!item.plan_id || !item.currency || item.live_schools <= 0) continue;
    const monthly = monthlyPriceOf(item.price, item.billing_period);
    if (monthly <= 0) continue;
    const mrr = monthly * item.live_schools;
    rows.push({
      plan_id: item.plan_id,
      plan_name: item.plan_name ?? 'Unknown plan',
      plan_code: item.plan_code,
      currency: item.currency,
      live_schools: item.live_schools,
      estimated_mrr: mrr,
      estimated_arr: mrr * 12,
      share: 0,
    });
  }

  const totalByCurrency = new Map<string, number>();
  for (const row of rows) {
    totalByCurrency.set(row.currency, (totalByCurrency.get(row.currency) ?? 0) + row.estimated_mrr);
  }
  for (const row of rows) {
    const total = totalByCurrency.get(row.currency) ?? 0;
    row.share = total > 0 ? (row.estimated_mrr / total) * 100 : 0;
  }

  return rows.sort(
    (a, b) => b.estimated_mrr - a.estimated_mrr || a.plan_name.localeCompare(b.plan_name),
  );
}

/** A single "usage vs plan limit" line (e.g. Students 82 / 100). */
export interface UsageRow {
  resource: PlanLimitResource;
  label: string;
  usage: number;
  /** Null when the plan grants an unlimited quota or defines no limit. */
  limit: number | null;
  unlimited: boolean;
  /** 0–100, capped; 0 when unlimited/unknown. */
  percent: number;
  tone: Tone;
  /** "82 / 100", "82 / Unlimited" or "82 / No limit set". */
  display: string;
}

/** Percentage of a quota consumed, capped to 100 and never negative. */
export function usagePercent(usage: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0 || !Number.isFinite(limit)) return 0;
  const value = (Math.max(0, usage) / limit) * 100;
  return Math.min(100, Math.round(value));
}

/** Green under 75 %, amber under 100 %, red at or over the cap. */
export function usageTone(percent: number, unlimited: boolean): Tone {
  if (unlimited) return 'info';
  if (percent >= 100) return 'danger';
  if (percent >= 75) return 'warning';
  return 'success';
}

/** "Unlimited" / "Not set" / "100" — one wording for every limit display. */
export function formatLimit(limit: PlanLimitValue | undefined): string {
  if (!limit) return 'Not set';
  if (limit.unlimited) return 'Unlimited';
  if (limit.value === null || limit.value === undefined) return 'Not set';
  return new Intl.NumberFormat().format(limit.value);
}

/**
 * Maps tenant statistics + plan limits onto usage rows for the School 360
 * view. Resources the plan does not constrain are still reported (with no
 * limit) so the operator can see the real footprint of the tenant.
 */
export function schoolUsageRows(
  stats: AdminSchoolStats,
  limits: PlanLimitsConfig | null | undefined,
): UsageRow[] {
  const usageByResource: Record<PlanLimitResource, number> = {
    [PlanLimitResource.STUDENTS]: stats.student_count,
    [PlanLimitResource.BUSES]: stats.bus_count,
    [PlanLimitResource.ROUTES]: stats.route_count,
    [PlanLimitResource.STOPS]: stats.stop_count ?? 0,
    [PlanLimitResource.DRIVERS]: stats.driver_count,
    [PlanLimitResource.CONDUCTORS]: stats.conductor_count,
    [PlanLimitResource.STAFF]: stats.driver_count + stats.conductor_count,
    [PlanLimitResource.PARENTS]: stats.parent_count,
    [PlanLimitResource.TRIPS]: stats.trip_count,
  };

  const order: PlanLimitResource[] = [
    PlanLimitResource.STUDENTS,
    PlanLimitResource.BUSES,
    PlanLimitResource.ROUTES,
    PlanLimitResource.STOPS,
    PlanLimitResource.DRIVERS,
    PlanLimitResource.CONDUCTORS,
    PlanLimitResource.STAFF,
    PlanLimitResource.PARENTS,
    PlanLimitResource.TRIPS,
  ];

  return order.map((resource) => {
    const limit = limits?.[resource];
    const usage = usageByResource[resource] ?? 0;
    const unlimited = Boolean(limit?.unlimited);
    const numericLimit = !limit || unlimited ? null : (limit.value ?? null);
    const percent = usagePercent(usage, numericLimit);
    return {
      resource,
      label: PLAN_LIMIT_RESOURCE_LABELS[resource],
      usage,
      limit: numericLimit,
      unlimited,
      percent,
      tone: usageTone(percent, unlimited),
      display: `${new Intl.NumberFormat().format(usage)} / ${formatLimit(limit)}`,
    };
  });
}

/** Compact "3 / 10" style summary used inside dense subscription tables. */
export function compactUsage(usage: number, limit: PlanLimitValue | undefined): string {
  return `${usage} / ${formatLimit(limit)}`;
}
