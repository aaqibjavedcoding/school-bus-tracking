import { SubscriptionStatus } from '@school-bus-tracking/shared-types';

/**
 * Time-aware subscription entitlement.
 *
 * ## Why this module exists
 *
 * `school_subscriptions.status` is a *persisted lifecycle* value written by a
 * Super Admin (or, later, by a billing integration). Nothing moves it forward
 * when time passes, so a row can legitimately read `status = 'active'` weeks
 * after `current_period_end`. Resolving paid-plan access from the stored
 * status alone therefore hands an expired tenant its paid entitlements for
 * free — which is the security bug this module fixes.
 *
 * ## Two separate concepts
 *
 * 1. **Access eligibility** — computed here, on every request, from the stored
 *    row *and the current time*. It never depends on a background job having
 *    run.
 * 2. **Persisted lifecycle status** — the stored column, moved to `expired` by
 *    the optional sweep script (`npm run subscriptions:sweep`). Cosmetic and
 *    reporting-oriented; access never waits for it.
 *
 * ## Policy table (see `docs/subscriptions.md`)
 *
 * ```text
 * stored status  window                                   effective   paid access
 * -------------  ---------------------------------------  ----------  -----------
 * (no row)       —                                        none        no  (pre-billing default)
 * trialing       now < trial_end                          trialing    yes
 * trialing       now >= trial_end                         expired     no
 * active         current_period_end is NULL (open-ended)  active      yes
 * active         now < current_period_end                 active      yes
 * active         now >= current_period_end                expired     no
 * past_due       within period                            past_due    yes
 * past_due       within grace after current_period_end    past_due    yes  (bounded, configurable)
 * past_due       after grace                              expired     no
 * cancelled      —                                        cancelled   no
 * expired        —                                        expired     no
 * ```
 *
 * `past_due` deliberately does **not** grant open-ended access: it keeps
 * access for a bounded, configurable dunning grace period
 * (`SUBSCRIPTION_PAST_DUE_GRACE_DAYS`, default 7 days) measured from
 * `current_period_end`, then lapses like any other expired subscription. An
 * open-ended period (`current_period_end = NULL`) is honoured as-is, because
 * the schema explicitly documents NULL as "open-ended" and no billing phase
 * exists yet to close it.
 *
 * All comparisons are absolute-instant comparisons (`Date` → epoch ms), so
 * they are timezone-independent: a `timestamptz` read back from PostgreSQL in
 * any session timezone yields the same decision.
 */
export interface SubscriptionWindow {
  status: SubscriptionStatus | string;
  trial_end?: Date | string | null;
  current_period_end?: Date | string | null;
  cancelled_at?: Date | string | null;
}

export interface SubscriptionEntitlementOptions {
  /** Grace period, in ms, granted to `past_due` after `current_period_end`. */
  pastDueGraceMs?: number;
}

export interface SubscriptionEntitlement {
  /** Time-aware status a client should act on. Never `none` for a real row. */
  effective_status: SubscriptionStatus;
  /** True when the school is entitled to its plan right now. */
  has_paid_access: boolean;
  /** Instant at which the current entitlement lapses; null when open-ended. */
  access_expires_at: Date | null;
  /** True when a stored live status has lapsed and the row is stale. */
  lapsed: boolean;
}

/** Entitlement of a school with no subscription row at all. */
export const NO_SUBSCRIPTION_ENTITLEMENT: SubscriptionEntitlement = Object.freeze({
  effective_status: SubscriptionStatus.NONE,
  has_paid_access: false,
  access_expires_at: null,
  lapsed: false,
});

const DEFAULT_PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolves the entitlement of a subscription row at instant `now`.
 *
 * `subscription = null | undefined` models "school has no subscription row",
 * which projects to `none` — exactly the pre-existing API behaviour.
 */
export function resolveSubscriptionEntitlement(
  subscription: SubscriptionWindow | null | undefined,
  now: Date = new Date(),
  options: SubscriptionEntitlementOptions = {},
): SubscriptionEntitlement {
  if (!subscription) {
    return NO_SUBSCRIPTION_ENTITLEMENT;
  }

  const nowMs = now.getTime();
  const trialEnd = toTime(subscription.trial_end);
  const periodEnd = toTime(subscription.current_period_end);
  const graceMs = options.pastDueGraceMs ?? DEFAULT_PAST_DUE_GRACE_MS;

  switch (subscription.status) {
    case SubscriptionStatus.TRIALING: {
      // A trialing row always has a trial_end (database CHECK constraint); a
      // defensive null is treated as "no trial window left" rather than an
      // unlimited free trial.
      if (trialEnd === null) {
        return lapsedEntitlement();
      }
      if (nowMs < trialEnd) {
        return {
          effective_status: SubscriptionStatus.TRIALING,
          has_paid_access: true,
          access_expires_at: new Date(trialEnd),
          lapsed: false,
        };
      }
      return lapsedEntitlement();
    }

    case SubscriptionStatus.ACTIVE: {
      if (periodEnd === null) {
        return {
          effective_status: SubscriptionStatus.ACTIVE,
          has_paid_access: true,
          access_expires_at: null,
          lapsed: false,
        };
      }
      if (nowMs < periodEnd) {
        return {
          effective_status: SubscriptionStatus.ACTIVE,
          has_paid_access: true,
          access_expires_at: new Date(periodEnd),
          lapsed: false,
        };
      }
      return lapsedEntitlement();
    }

    case SubscriptionStatus.PAST_DUE: {
      if (periodEnd === null) {
        return {
          effective_status: SubscriptionStatus.PAST_DUE,
          has_paid_access: true,
          access_expires_at: null,
          lapsed: false,
        };
      }
      const graceEnd = periodEnd + graceMs;
      if (nowMs < graceEnd) {
        return {
          effective_status: SubscriptionStatus.PAST_DUE,
          has_paid_access: true,
          access_expires_at: new Date(graceEnd),
          lapsed: false,
        };
      }
      return lapsedEntitlement();
    }

    case SubscriptionStatus.CANCELLED:
      return {
        effective_status: SubscriptionStatus.CANCELLED,
        has_paid_access: false,
        access_expires_at: null,
        lapsed: false,
      };

    case SubscriptionStatus.EXPIRED:
      return {
        effective_status: SubscriptionStatus.EXPIRED,
        has_paid_access: false,
        access_expires_at: null,
        lapsed: false,
      };

    default:
      // Unknown/unsupported stored value: never grant access on a value the
      // application does not understand.
      return {
        effective_status: SubscriptionStatus.EXPIRED,
        has_paid_access: false,
        access_expires_at: null,
        lapsed: false,
      };
  }
}

/** `true` when a stored *live* status no longer grants access at `now`. */
export function isSubscriptionLapsed(
  subscription: SubscriptionWindow | null | undefined,
  now: Date = new Date(),
  options: SubscriptionEntitlementOptions = {},
): boolean {
  return resolveSubscriptionEntitlement(subscription, now, options).lapsed;
}

/** Converts the configured grace period in days to milliseconds. */
export function pastDueGraceMsFromDays(days: number | undefined): number {
  if (days === undefined || !Number.isFinite(days) || days < 0) {
    return DEFAULT_PAST_DUE_GRACE_MS;
  }
  return Math.round(days * 24 * 60 * 60 * 1000);
}

function lapsedEntitlement(): SubscriptionEntitlement {
  return {
    effective_status: SubscriptionStatus.EXPIRED,
    has_paid_access: false,
    access_expires_at: null,
    lapsed: true,
  };
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}
