import { registerAs } from '../framework';

/**
 * Subscription lifecycle / entitlement configuration.
 *
 * See `docs/subscriptions.md` for the full policy table. Only the tunables
 * that an operator may legitimately want to change live here.
 *
 * `SUBSCRIPTION_PAST_DUE_GRACE_DAYS`
 *   How long a `past_due` subscription keeps paid access after its current
 *   period ended. `past_due` is an operator-set dunning state; the grace
 *   window is what makes it *explicitly* time-bounded instead of an
 *   indefinite free ride. Default: 7 days.
 *
 * `SUBSCRIPTION_ENFORCE_LAPSED_ACCESS`
 *   When true (default) a school whose subscription window has lapsed cannot
 *   create new plan-limited resources. Set to `false` to keep the previous
 *   behaviour (lapse only affects reporting) during a migration window.
 */
export default registerAs('subscription', () => ({
  pastDueGraceDays: nonNegativeNumber(process.env.SUBSCRIPTION_PAST_DUE_GRACE_DAYS, 7),
  enforceLapsedAccess:
    process.env.SUBSCRIPTION_ENFORCE_LAPSED_ACCESS?.trim().toLowerCase() !== 'false',
}));

function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
