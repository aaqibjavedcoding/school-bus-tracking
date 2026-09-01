# Subscriptions and plan limits

This document states the *effective* policy the code implements, and — where
the pre-existing schema/UI left a question open — says so explicitly instead of
inventing a rule silently.

## The two questions, kept apart

There are two different questions about a subscription, and conflating them is
what caused the original bug:

1. **Lifecycle status** — what is *stored* in `school_subscriptions.status`:
   `trialing`, `active`, `past_due`, `cancelled`, `expired`. Operators set it
   from the Super Admin console.
2. **Access eligibility** — may this school use its paid plan *right now*?
   This is derived from the dates on every request. It is never read straight
   out of the status column.

Before this change, `PlanLimitsService` resolved a school's plan with
`status IN ('trialing', 'active', 'past_due')` and no date comparison: a
subscription whose `current_period_end` was two years in the past still granted
full paid entitlements, forever, unless somebody manually edited the row.

## Entitlement rules

`resolveSubscriptionEntitlement(subscription, now)` in
`apps/api/src/common/subscriptions/subscription-access.ts` is the single source
of truth. Boundaries are **end-exclusive**: access ends *at* the timestamp.

| Stored status | Dates | Paid access | Effective status |
| --- | --- | --- | --- |
| *(no row)* | — | no | `none` |
| `trialing` | `now < trial_end` | yes | `trialing` |
| `trialing` | `now >= trial_end` | no | `expired` |
| `trialing` | `trial_end` null (defensive) | no | `expired` |
| `active` | `current_period_end` null | yes | `active` |
| `active` | `now < current_period_end` | yes | `active` |
| `active` | `now >= current_period_end` | no | `expired` |
| `past_due` | within the grace window after `current_period_end` | yes | `past_due` |
| `past_due` | after the grace window | no | `expired` |
| `past_due` | `current_period_end` null | yes (open-ended) | `past_due` |
| `cancelled` | — | no | `cancelled` |
| `expired` | — | no | `expired` |

All comparisons are done on absolute instants (epoch milliseconds) against
`timestamptz` columns, so the result does not depend on the server's or the
session's timezone. A period ending "midnight on the 1st" ends at the instant
stored, not at the reader's local midnight.

### The `past_due` ambiguity — stated, not invented

`past_due` is listed in `LIVE_SUBSCRIPTION_STATUS_VALUES` in
`packages/shared-types`, whose comment says access decisions for it are
"deferred". The repository contains no policy for how long a past-due school
keeps working, and no billing integration exists to set the status in the first
place (it is operator-set today).

Rather than pick "keeps access forever" (the pre-existing behaviour, which is a
free ride) or "loses access instantly" (which would break an operator's dunning
flow the moment they set the status), the implementation keeps `past_due` live
for an **explicit, configurable grace window** after the period end:

```bash
SUBSCRIPTION_PAST_DUE_GRACE_DAYS=7   # default
```

Set it to `0` for "no grace" or to a large number to preserve the old
open-ended behaviour. This is the one place where a business decision had to be
made; it is configuration, not a hidden constant.

### Escape hatch

```bash
SUBSCRIPTION_ENFORCE_LAPSED_ACCESS=false
```

restores the previous behaviour where a lapsed window does not block resource
creation (lapse then only affects reporting). Intended for a migration window
if a deployment discovers stale rows in production; the default is `true`.

## Persisted status repair (no cron)

Access eligibility never depends on a background job. The stored status is
nonetheless repaired lazily: when `AdminSubscriptionsService` loads a
stored-live row whose window has elapsed, it writes the row back as `expired`
before answering. That keeps the console honest and — importantly — frees the
single "live" slot so a new subscription can be assigned. The write is best
effort; if it fails the row is still treated as not live for that request.

## One live subscription per school

At most one row per school may be in a live status (`trialing`, `active`,
`past_due`) at a time. This is not just service logic: the partial unique index
`uq_school_subscriptions_live_school` (created in
`20260831120000-create-school-subscriptions.ts`, `WHERE deleted_at IS NULL`)
enforces it, so two concurrent "assign plan" requests cannot both win. The
integration suite proves it by racing them.

Other database-level guarantees on the table:

* `ck_school_subscriptions_status_not_none` — `none` is a projection, never a
  stored value.
* trial and period ranges must be ordered; a `trialing` row must have a
  `trial_end`; a `cancelled` row must have a `cancelled_at`.
* the plan reference is `ON DELETE RESTRICT`: history cannot be orphaned.

History is never destroyed — changing plans closes the old row (`expired`) and
inserts a new one.

## Plan limits

`PlanLimitsService` resolves the school's live plan (through the entitlement
rules above), reads the cap for the requested resource, counts current usage
and enforces the quota.

* **Unlimited or missing limit** — no cap. A plan that does not mention a
  resource does not restrict it.
* **No live entitlement** — a school with no subscription falls back to the
  platform default behaviour; a school whose window has *lapsed* is refused
  with `409 SUBSCRIPTION_INACTIVE` (unless the escape hatch above is set).
* **Usage counting** excludes soft-deleted rows and inactive/deactivated
  resources, so deleting a bus frees a seat.

### The race, and how it is fixed

The old implementation counted, then created — two statements with no
serialization. Two requests at 99/100 both read 99 and both committed, leaving
101 rows (reproduced in the sandbox before the fix).

Creation now runs inside a single transaction that first takes a PostgreSQL
advisory lock scoped to the tenant *and* the resource:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('plan-limit:<school_id>:<resource>', 0));
```

The quota is re-asserted **inside** the lock and the insert happens in the same
transaction, so the check and the write are atomic. The lock is released when
the transaction ends.

Because the key includes the school id and the resource, two different tenants
— or the same tenant creating a bus and a student — never wait on each other.
There is no global mutex and no process-local state, so the fix holds across
multiple API instances.

Verified by `apps/api/test/integration/plan-limits.integration.spec.ts`:
99 existing rows, limit 100, two concurrent creates → exactly one success, one
`409 PLAN_LIMIT_REACHED`, final count exactly 100; plus an 8-way burst and a
cross-tenant non-interference check.
