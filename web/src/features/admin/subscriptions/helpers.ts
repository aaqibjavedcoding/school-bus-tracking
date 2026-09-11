import {
  ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES,
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  SUBSCRIPTION_STATUS_VALUES,
  SubscriptionStatus,
  type AdminSchoolSubscriptionCreateRequest,
  type AdminSchoolSubscriptionResponse,
  type PlanBillingPeriod,
} from '@school-bus-tracking/shared-types';

/**
 * Pure presentation/form helpers for the Super Admin subscription console.
 *
 * Deliberately free of React and of relative imports so the Node test runner
 * (`npm --prefix web test`) can execute them directly, the same way
 * `lib/errors.spec.ts` does. All business rules (assignable plans, one live
 * subscription, date ordering, history preservation) live in the backend —
 * these helpers only shape what is rendered and what is sent.
 */

/** Matches the `BadgeTone` union of `components/ui` structurally. */
export type SubscriptionTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** Badge tone for each subscription lifecycle state. */
export function subscriptionStatusTone(status: SubscriptionStatus): SubscriptionTone {
  switch (status) {
    case SubscriptionStatus.ACTIVE:
      return 'success';
    case SubscriptionStatus.TRIALING:
      return 'info';
    case SubscriptionStatus.PAST_DUE:
      return 'warning';
    case SubscriptionStatus.CANCELLED:
      return 'danger';
    case SubscriptionStatus.EXPIRED:
    case SubscriptionStatus.NONE:
    default:
      return 'neutral';
  }
}

/** True for the statuses that make a subscription the school's current one. */
export function isLiveSubscriptionStatus(status: SubscriptionStatus): boolean {
  return (LIVE_SUBSCRIPTION_STATUS_VALUES as SubscriptionStatus[]).includes(status);
}

/** "/ month", "/ year" — same wording the Plans console uses. */
export function billingPeriodSuffix(period: PlanBillingPeriod | string | null): string {
  switch (period) {
    case 'monthly':
      return '/ month';
    case 'yearly':
      return '/ year';
    default:
      return period ? `/ ${period}` : '';
  }
}

/**
 * Which primary actions the subscription section offers for a given state.
 *
 * - no record at all            → Assign plan
 * - live (trialing/active/past_due) → Change plan + Cancel
 * - cancelled/expired history   → Resubscribe (creates a brand-new record;
 *   the backend never resurrects historical rows)
 *
 * The backend re-validates every action, so this only decides what to render.
 */
export type SubscriptionUiMode = 'assign' | 'manage' | 'resubscribe';

export function subscriptionUiMode(
  subscription: Pick<AdminSchoolSubscriptionResponse, 'status' | 'id'>,
): SubscriptionUiMode {
  if (subscription.id === null || subscription.status === SubscriptionStatus.NONE) {
    return 'assign';
  }
  return isLiveSubscriptionStatus(subscription.status) ? 'manage' : 'resubscribe';
}

/** Datetime-local input value → ISO-8601, or null for empty/invalid input. */
export function datetimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Raw state of the Assign/Resubscribe form (datetime-local strings). */
export interface AssignPlanFormState {
  plan_id: string;
  status: string;
  trial_start: string;
  trial_end: string;
  current_period_start: string;
  current_period_end: string;
}

export const EMPTY_ASSIGN_FORM: AssignPlanFormState = {
  plan_id: '',
  status: SubscriptionStatus.ACTIVE,
  trial_start: '',
  trial_end: '',
  current_period_start: '',
  current_period_end: '',
};

/**
 * Builds the `POST .../subscription` body from the form state.
 *
 * Empty fields are omitted entirely (the backend applies its own defaults);
 * a status outside the backend's assignable set — in particular `none`,
 * which represents the *absence* of a record and must never be persisted —
 * is dropped rather than sent.
 */
export function toAssignSubscriptionRequest(
  form: AssignPlanFormState,
): AdminSchoolSubscriptionCreateRequest {
  const body: AdminSchoolSubscriptionCreateRequest = { plan_id: form.plan_id.trim() };
  if ((ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(form.status)) {
    body.status = form.status as SubscriptionStatus;
  }
  const trialStart = datetimeLocalToIso(form.trial_start);
  const trialEnd = datetimeLocalToIso(form.trial_end);
  const periodStart = datetimeLocalToIso(form.current_period_start);
  const periodEnd = datetimeLocalToIso(form.current_period_end);
  if (trialStart) body.trial_start = trialStart;
  if (trialEnd) body.trial_end = trialEnd;
  if (periodStart) body.current_period_start = periodStart;
  if (periodEnd) body.current_period_end = periodEnd;
  return body;
}

/**
 * The two list filters of `/admin/subscriptions`, as a query string.
 *
 * `status` and `plan` are read *from* the URL and written back to it, so a
 * summary count, the status `<Select>`, the quick chips, a refresh, the back
 * button and a shared link all describe the same view. Search and page stay
 * inside `usePagedResource` — clicking a count never touches them — and every
 * URL value passes through the two parsers below, so a hand-edited link can
 * only ever mean "a filter the API accepts" or "no filter".
 */

/**
 * `?status=` → the value the list filter accepts.
 *
 * Unknown, blank and `all` values collapse to `''` (= no status filter), so a
 * hand-edited or stale link can never put the console into a state the API
 * would reject.
 */
export function parseSubscriptionStatusParam(
  raw: string | null | undefined,
): '' | SubscriptionStatus {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value || value === 'all') return '';
  return (SUBSCRIPTION_STATUS_VALUES as string[]).includes(value)
    ? (value as SubscriptionStatus)
    : '';
}

/** `?plan=` → a plan id filter, or `''` when absent. */
export function parseSubscriptionPlanParam(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  // Only a plausible UUID is forwarded; anything else would fail `plan_id`
  // validation server-side and surface as a list error instead of a filter.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : '';
}

/**
 * The console's filters → the query string that represents them.
 *
 * Keys are omitted when the filter is inactive, so the bare page stays
 * `/admin/subscriptions` and "no filter" has exactly one URL.
 */
export function buildSubscriptionFilterQuery(filters: {
  status: '' | SubscriptionStatus;
  planId: string;
}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.planId) params.set('plan', filters.planId);
  return params.toString();
}
