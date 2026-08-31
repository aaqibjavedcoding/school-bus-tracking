/**
 * Injection tokens and user-facing messages for Super Admin school
 * subscription management (`/api/v1/admin/schools/:schoolId/subscription`).
 *
 * The `SchoolSubscription` model is injected behind a token so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can substitute stubs —
 * the same pattern used by the schools, plans and other feature modules.
 */
import type { AdminSchoolSubscriptionInfo } from '@school-bus-tracking/shared-types';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';

export const ADMIN_SUBSCRIPTIONS_REPOSITORY = 'ADMIN_SUBSCRIPTIONS_REPOSITORY';

/** No subscription record exists for the school. */
export const SUBSCRIPTION_NOT_FOUND_MESSAGE = 'This school has no subscription';

/** The school already has a live (trialing/active/past_due) subscription. */
export const SUBSCRIPTION_ALREADY_EXISTS_MESSAGE = 'This school already has an active subscription';

/** A retired plan may not be attached to a new subscription. */
export const SUBSCRIPTION_PLAN_INACTIVE_MESSAGE =
  'This plan is inactive and cannot be assigned to a subscription';

/** No live subscription to change/cancel (it may be cancelled or expired). */
export const SUBSCRIPTION_NOT_ACTIVE_MESSAGE = 'This school has no active subscription to change';

export const SUBSCRIPTION_NOT_CANCELLABLE_MESSAGE =
  'This school has no active subscription to cancel';

/** Cancellation confirmation. */
export const SUBSCRIPTION_CANCELLED_MESSAGE = 'Subscription cancelled';

/**
 * The canonical "no subscription" projection.
 *
 * This is the descendant of the original `NO_SUBSCRIPTION` placeholder that
 * lived in `admin-schools.service.ts`: identical wire shape
 * (`status: 'none'`, `plan: null`, `current_period_end: null`), now produced
 * by the subscription domain so every consumer keeps working unchanged for
 * schools that have not been assigned a plan yet.
 */
export const NO_SUBSCRIPTION_INFO: AdminSchoolSubscriptionInfo = {
  status: SubscriptionStatus.NONE,
  plan: null,
  current_period_end: null,
};
