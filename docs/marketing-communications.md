# Marketing Communications

## Overview

The marketing communications system lets the platform operator (Zero Mile
Systems) create email templates, target school audiences with campaigns,
capture demo leads from the public landing page, and manage the resulting
sales pipeline — on the same SMTP rail, database and Super Admin console the
product already runs on. No paid email API is involved.

This document is the architectural contract for the feature. It is written
for engineers implementing and reviewing later phases; each section states
both the design and the reason for it.

**Scope of the four-session rollout:**

| Session        | Scope                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| 1              | Architecture, database, shared contracts, configuration                           |
| 2              | Template & campaign management APIs (SUPER_ADMIN), audience snapshot builder      |
| 3 (current)    | Delivery worker, per-recipient rendering, tracking endpoints, Super Admin console |
| 4              | Demo request endpoint, lead console, landing page form                            |

Sending real email requires `EMAIL_PROVIDER=smtp` plus complete SMTP
settings; with anything else the whole rail runs on `NoOpEmailProvider`, so
dev and CI exercise the same code paths without a relay.

## Access model

- Template, campaign, suppression and lead management are **SUPER_ADMIN only**
  (the platform operator's console). The API layer must guard every such
  endpoint with the existing role guard; no school-scoped role may read or
  write any of these tables.
- Exactly two public (unauthenticated) surfaces exist, both token-protected:
  the demo-request submission endpoint and the unsubscribe confirmation.
- School staff never see marketing data. Schools are the _audience_ of
  campaigns, not their operators — the tables carry no `school_id` except the
  recipient snapshot's attribution column.

## Email template lifecycle

A template is a **container**, never the content:

```
email_templates (name, slug, status)
  └── email_template_versions (version, subject, html_body, text_body,
                               allowed_variables, published_at)
```

1. **DRAFT** — the template exists with a unique slug. Draft versions are
   created on each save and may be edited freely.
2. **PUBLISHED** — at least one version has been published. Campaigns may
   reference the template. The status is console metadata; the _send-time_
   guarantee comes from the version pin below.
3. **ARCHIVED** — retired. Existing campaigns keep working; new campaigns
   may not select it.

The slug is unique among live (non-soft-deleted) templates, so a re-created
template keeps its identity in audits and lookups.

## Immutable template versions

Every save of template content creates a new `email_template_versions` row
(`version` increments per template; unique `(template_id, version)`). A
version row has two states:

- **Draft** (`published_at IS NULL`) — still editable.
- **Published** (`published_at` set) — **immutable**. The service layer
  refuses any update. Publishing is a one-way door.

Why immutability matters: a campaign stores `template_version_id`, so "what
exactly did school X receive on date Y" must resolve to bytes that cannot
change afterwards. The foreign key from `email_campaigns` uses
`ON DELETE RESTRICT`, so a version any campaign referenced can never even be
deleted. This is the audit and reproducibility guarantee of the whole
system — the email equivalent of the append-only `audit_logs` table.

`allowed_variables` (JSONB) is the checkable contract of which
`{{placeholders}}` the renderer may substitute. Unknown placeholders are left
untouched rather than guessed at; a missing _required_ variable fails the
send before any email leaves. The renderer only ever substitutes variables
declared in this list — template authors cannot exfiltrate data the contract
does not grant them.

## Campaign lifecycle

```
DRAFT ──schedule──► SCHEDULED ──due──► SENDING ──► COMPLETED
  ▲                    │                  │
  │                    │                  └──► PAUSED ──resume──► SENDING
  └── (edit filter)    └──cancel──► CANCELLED          │
                                              system abort ──► FAILED
```

- **DRAFT** — the audience filter may still change; no snapshot exists.
- **SCHEDULED** — `scheduled_at` is set and the **audience snapshot has been
  frozen** (see below). The filter can no longer change; the campaign can be
  cancelled but not edited.
- **SENDING** — the worker has started; recipients are being delivered with
  bounded retries.
- **PAUSED** — interrupted by a Super Admin; resumable.
- **COMPLETED / CANCELLED / FAILED** — terminal. `FAILED` means the system
  aborted (e.g. the email rail is misconfigured); it never auto-retries —
  an operator must diagnose and re-schedule, because silently retrying a
  half-sent blast is how duplicates are born.

**No bulk email is ever sent inside an HTTP request.** The API only moves a
campaign between lifecycle states; all delivery happens in the background
worker (below). An HTTP handler that loops over recipients calling the
provider would tie request latency to SMTP throughput and die on the first
greylisting timeout — it is a prohibited pattern, not just a discouraged one.

Aggregate counters (`recipient_count`, `sent_count`, `failed_count`,
`clicked_count`, `unsubscribed_count`) are denormalized on the campaign row
and maintained transactionally by the worker, so the console list view never
aggregates the recipient table per row.

## School audience filtering

`email_campaigns.audience_filter` (JSONB) is the _question_ — validated by
`marketingCampaignAudienceFilterSchema` (`packages/validation`), all fields
AND-combined, every array bounded, unknown keys rejected:

| Field                                       | Meaning                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| `search`                                    | case-insensitive substring on school name / code / email |
| `countries`                                 | ISO 3166-1 alpha-2 (`schools.country`)                   |
| `cities`                                    | case-insensitive `schools.city` (normalized both sides)  |
| `states`                                    | case-insensitive `schools.state` (normalized both sides) |
| `subscription_statuses`                     | current subscription status of the school                |
| `include_school_ids` / `exclude_school_ids` | explicit include, then exclude                           |
| `active_only`                               | only `schools.is_active = true` (the default)            |
| `recipient_sources`                         | which address sources may contribute (default: `SCHOOL_EMAIL` only) |

The filter never contains email addresses. Address selection happens when the
snapshot is built: each school contributes its **primary contact address**
(`schools.email`) and/or its **SCHOOL_ADMIN account address**
(`users.email`), recorded per recipient in `recipient_source`
(`SCHOOL_ADMIN` / `SCHOOL_EMAIL`). Exactly which sources are eligible is
decided by the snapshot builder (Phase 2), never by the client.

## Recipient snapshotting

When a campaign is **scheduled**, the server (never the browser):

1. evaluates the audience filter against the schools tables;
2. resolves the recipient addresses for each matching school;
3. normalizes (trim + lowercase) and deduplicates by address —
   unique `(campaign_id, normalized_email)` enforces it at the database
   level;
4. writes one `email_campaign_recipients` row per address with status
   `PENDING`;
5. stores `audience_snapshot_hash` — a SHA-256 digest of the canonicalized
   snapshot — so two campaigns can be _proven_ to have targeted the same
   audience without keeping a second copy of the list.

From that moment the campaign's audience is frozen: schools registered
afterwards are simply not in this campaign. That is the audit-correct
behaviour for a marketing send — "who was this sent to" must be a stable
fact, not a live query.

Suppression is applied **twice**, by design: the snapshot builder (Session 2)
excludes already-suppressed addresses from the snapshot — a suppressed
address never becomes a `PENDING` recipient — and the worker (Session 3)
checks suppression again at send time, the last possible moment, so an
unsubscribe arriving between snapshot and send still protects every
not-yet-sent recipient. The preview reports the suppressed count separately
so an operator can see how many candidate addresses the do-not-send list
removed.

## Suppression and unsubscribe behavior

`marketing_suppressions` is the global do-not-send list: one row per
normalized address (unique index), with a safe `reason`
(`UNSUBSCRIBED` / `HARD_BOUNCE` / `COMPLAINED` / `MANUAL`) and `source`
(`RECIPIENT_LINK` / `SYSTEM` / `SUPER_ADMIN`).

- **Unsubscribe is one click, no login.** Every campaign email carries a
  personalized unsubscribe link whose URL token is random; only its SHA-256
  digest is stored (`unsubscribe_token_hash`, unique). The token is never
  persisted in plaintext, never logged, and never returned by any endpoint —
  the same construction as `password_reset_tokens`. The public endpoint
  resolves the digest to exactly one recipient row, writes the suppression,
  records an `UNSUBSCRIBED` email event, and shows a plain confirmation page.
- **The worker checks suppression at send time** — the last possible moment —
  in addition to any snapshot-time filtering. A suppression that arrives
  between snapshot and send turns the recipient into `SUPPRESSED`, not into
  an unwanted email.
- **Suppression is not deletion.** The row is the proof the address opted
  out, which is what an auditor or a mailbox provider asks for. Removing an
  entry is a deliberate Super Admin action, recorded in the audit log.
- **Scope: marketing only.** Transactional school notifications (trip
  alerts, password resets) are a different consent basis and a different
  table; they are unaffected by this list.

## Background worker and cron strategy

The campaign worker follows the established in-process scheduler pattern
(`retention.worker`, notification outbox `delivery.worker`): it is scheduled
**inside the custom server process** (`web/server.js` starts it after
`bootstrapDatabase()` and stops it on shutdown), with no external queue and
no separate deployment. The durable queue is the
`email_campaign_recipients` table itself — there is no in-memory job list to
lose, so a restart, a crash or a second instance changes nothing about what
eventually gets sent.

**Bulk email is never sent from an HTTP request.** Scheduling a campaign
only freezes the snapshot and returns; every message is produced later by
the worker, one recipient per attempt.

- **Cadence.** First sweep `MARKETING_WORKER_INITIAL_DELAY_MS` (default 30 s)
  after boot, then every `MARKETING_WORKER_INTERVAL_MS` (default 15 s).
  `MARKETING_WORKER_ENABLED=false` disables scheduling entirely, and the
  scheduler is skipped automatically when no database is configured.
- **Claiming.** One `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) …
  RETURNING` statement moves up to `MARKETING_BATCH_SIZE` (default 25) due
  recipients from `PENDING`/`RETRYING` to `PROCESSING`, stamping
  `locked_by` (a per-process id) and `lease_expires_at`. `SKIP LOCKED` means
  two instances sweeping simultaneously claim *disjoint* rows instead of
  blocking or duplicating, and the whole sweep additionally sits behind a
  transaction-scoped PostgreSQL advisory lock (a distinct lock class from
  retention and the push outbox).
- **Crash recovery.** A claimed row whose `lease_expires_at`
  (`MARKETING_LEASE_MS`, default 120 s) has passed is claimable again. Every
  state transition is conditional (`WHERE status = 'PROCESSING' AND
  locked_by = me`), so a revived worker that comes back after its lease
  expired cannot overwrite the outcome recorded by whoever took the row
  over. Transitions are idempotent, so re-running a sweep is safe.
- **Bounded concurrency and pacing.** Within a sweep, claimed rows are
  processed in chunks of `MARKETING_CONCURRENCY` (default 3), with a
  `MARKETING_SEND_DELAY_MS` ± `MARKETING_SEND_JITTER_MS` gap between sends
  and a hard ceiling of `MARKETING_RATE_PER_MINUTE` (default 60) messages
  per rolling minute. Pacing is a deliverability requirement, not politeness:
  a burst of thousands of messages is what makes providers start rejecting a
  domain.
- **Retry policy.** Transient failures (SMTP 4xx, connection/timeout, no
  response) go back to `RETRYING` with exponential backoff plus jitter
  (`MARKETING_RETRY_BASE_MS`, doubling, capped at 15 minutes) until
  `MARKETING_MAX_ATTEMPTS` (default 5) is exhausted. Permanent rejections
  (SMTP 5xx), suppressed addresses, cancelled campaigns and expired rows are
  **never** retried — retrying a permanent rejection only damages the sending
  reputation further.
- **Recipient states.** `PENDING` → `PROCESSING` → `SENT` / `RETRYING` /
  `FAILED`, plus `SUPPRESSED` (opted out), `SKIPPED` (no longer eligible),
  `CANCELLED` (campaign cancelled) and `EXPIRED` (still unsent
  `MARKETING_EXPIRY_MS` after the campaign started — nobody wants a
  three-day-late "reminder").
- **Pause and cancel.** Pausing blocks new claims; work already handed to the
  provider finishes, because an accepted message cannot be recalled.
  Cancelling is terminal and blocks all future sends.
- **No secrets in logs.** Worker log lines carry campaign ids, counters and
  error *categories* (`MarketingErrorCategory`) — never SMTP passwords, raw
  tokens, rendered bodies or provider transcripts.
- **Alerting.** Exhausted retries and worker startup/configuration failures
  email `MARKETING_ADMIN_EMAILS` on a per-campaign, per-stage cooldown. An
  alert failure never blocks delivery, and campaign recipients never receive
  an operational alert.

Delivery uses the **existing email provider abstraction**
(`notifications/providers/email-provider.factory.ts`): `EMAIL_PROVIDER=smtp`
plus complete SMTP settings selects `SmtpEmailProvider`; anything else keeps
`NoOpEmailProvider`. The provider returns a result object and never throws
into the caller, so a relay outage degrades a campaign, not the API.

## Campaign progress and counters

`email_campaigns` carries a counter per recipient state (`queued`,
`processing`, `sent`, `retrying`, `failed`, `suppressed`, `skipped`,
`cancelled`, `expired`) plus engagement (`clicked_count`,
`total_click_count`, `unsubscribed_count`). They are **recomputed from the
recipient rows** at the end of each sweep rather than incremented ad hoc:
counters derived from the source of truth cannot drift, double-count or go
negative, whatever a crash interrupted.

A campaign reaches `COMPLETED` (or `PARTIALLY_FAILED` when some recipients
failed) only when nothing is outstanding — no queued, processing or retrying
rows remain. `FAILED` is reserved for a campaign where nothing could be
delivered at all.

## Per-recipient rendering

Each message is rendered from the **immutable template version** the campaign
pinned, filled from the **recipient snapshot row** — never from live school
data, so a school renamed mid-campaign does not change what the already-
frozen audience receives.

The closed variable set is `recipient_name`, `school_name`, `campaign_url`,
`unsubscribe_url` and `current_year`. Unknown variables are rejected rather
than silently blanked, values are HTML-escaped in the HTML part, and both an
HTML and a plain-text part are produced for every send. URLs contain no
internal ids and no recipient address — only an opaque per-recipient token,
stored as a SHA-256 digest.

## Personalized click tracking

Every tracked link in a campaign email is personalized per recipient: the
URL carries a random token, and only its SHA-256 digest is stored
(`click_token_hash`, unique). When the recipient follows the link, the public
redirect endpoint hashes the presented token, resolves the single matching
recipient row, records a `CLICKED` `email_event`, and redirects to the real
destination.

- The plaintext token exists only inside the sent email — a database read or
  leaked backup cannot forge a click attribution.
- `email_events` stores no raw token, no email body and no subject; `metadata`
  is bounded, safe context (which link was followed — by path, not full URL).
- **No open/pixel tracking.** A tracking pixel is a privacy cost this system
  does not ask recipients to pay. Engagement is measured by clicks and
  replies (demo leads) only.

### Public endpoints

| Endpoint                                        | Behavior                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/v1/public/marketing/click/:token`      | records the click, then redirects                                    |
| `GET /api/v1/public/marketing/unsubscribe/:token`| suppresses the address, returns a plain confirmation page            |
| `POST /api/v1/public/marketing/unsubscribe/:token`| one-click unsubscribe target for `List-Unsubscribe-Post`            |

All three are unauthenticated and share a strict public rate-limit policy
(`marketing_public`, 20 requests / 60 s per IP), separate from the
authenticated console limits.

- **Token handling.** The presented token must match `^[a-f0-9]{64}$` and is
  resolved by digest. An unknown token answers a generic not-found — it never
  reveals whether a campaign, a recipient or an address exists.
- **Counting.** Every click increments `total_click_count`; the *first* click
  of a given recipient additionally increments `clicked_count`, via a
  conditional update, so repeats cannot inflate the unique figure.
- **Redirect safety.** The redirect target is always derived from the
  configured `APP_URL`; a `?next=` or any other caller-supplied absolute URL
  is ignored. Only a small allowlist of UTM parameters is preserved. An open
  redirect on a link that arrives in thousands of inboxes is a phishing kit,
  which is why the destination is never taken from the request.
- **Unsubscribe is idempotent.** Repeating it writes nothing new and still
  answers success; the normalized address enters `marketing_suppressions`
  once, an `UNSUBSCRIBED` event is recorded, and analytics rows are kept.
  Transactional mail is untouched.

## Demo request flow

The public landing page (`web/src/app/page.tsx`) carries the "Request a
Demo" form (`web/src/app/DemoRequestForm.tsx`, Session 4) in an accessible
`#request-demo` section. It posts through the shared `apiClient` — never a
raw `fetch` — to `POST /api/v1/public/marketing/demo-request`
(`web/src/server/api/public-demo-request.ts`), which answers `202` with the
same generic sentence for every accepted submission:

1. **Honeypot first.** The form renders a visually hidden `website` field
   (`tabIndex={-1}`, skipped by humans). A non-empty value marks a bot: the
   server answers the generic response and stores nothing.
2. **Validation.** The browser submits `MarketingDemoLeadInput` (validated
   by the shared `marketingDemoLeadInputSchema`: bounded fields, `consent`
   must be literally `true`, unknown keys rejected — a body naming a
   `campaign_id`, `school_id` or admin address is a 400). The endpoint is
   unauthenticated and throttled by the dedicated `marketing_demo_request`
   policy: per IP **and** per hashed-email identity bucket. No raw IP is
   ever stored.
3. **Idempotency.** A content fingerprint (SHA-256 over the normalized
   email/name/institution/message) deduplicates browser retries and double
   submits inside a 24-hour window — same generic answer, no second row, no
   second notification. A *later* genuine re-submission creates a fresh
   lead: silently dropping a new inquiry is worse than a duplicate row.
4. **Attribution.** The server resolves the HttpOnly attribution cookie a
   tracked campaign click set (`campaignDigest.recipientDigest`, both
   opaque). Only a digest matching a real campaign/recipient attaches
   `campaign_id` / `campaign_recipient_id`; a forged or stale cookie
   resolves to nothing. Client JSON can never name either. **Caveat:** if
   the campaign email was forwarded, recipient-level attribution points at
   the original recipient — the form's own email is the reliable identity
   of the person asking.
5. **Store first.** The server normalizes the email, records
   `consent_at = now()` and `consent_source = 'public-form'`, writes the
   `marketing_leads` row (`status = NEW`, `source = LANDING_PAGE`) with the
   allowlisted UTM parameters echoed from the landing URL, and appends a
   `CREATED` event (`actor = 'public-form'`).
6. **Notify afterwards.** Only after the row is committed, an asynchronous
   notification goes to **`MARKETING_ADMIN_EMAILS`** through the email
   provider abstraction (`marketing-lead-notifications.ts`): one bounded
   retry, then the outcome is recorded on the lead's timeline
   (`ADMIN_NOTIFIED` stamps `admin_notified_at`; `ADMIN_NOTIFY_FAILED`
   records a failure class, never a transcript). The email carries the
   contact facts and a console deep link built from `APP_URL` — never the
   free-text message and never a localhost URL. A dead SMTP relay can slow
   nothing down and lose nothing: the lead is already stored and visible in
   the console.

The submitter always receives the same generic confirmation; the endpoint
is not an oracle for which addresses already asked. And the wording matters:
submitting the form **requests** a demo — nothing is booked. `DEMO_SCHEDULED`
is only ever set later, by the operator who actually confirmed an
appointment.

## Lead lifecycle

```
NEW ──► CONTACTED ──► QUALIFIED ──► DEMO_SCHEDULED ──► CONVERTED (terminal)
 │        │   │           │            │        │
 │        │   └───────────┼────────────┘        └──► QUALIFIED (re-qualify)
 └────────┴───────────────┴──► LOST ──► CONTACTED (re-engage)
```

The graph is `MARKETING_LEAD_STATUS_TRANSITIONS` in
`packages/shared-types` and is **enforced server-side** in
`marketing-leads.service.ts` — the console only offers the buttons the
graph allows, the API decides:

- `NEW` → `CONTACTED` / `QUALIFIED` / `LOST`
- `CONTACTED` → `QUALIFIED` / `DEMO_SCHEDULED` / `LOST`
- `QUALIFIED` → `DEMO_SCHEDULED` / `LOST`
- `DEMO_SCHEDULED` → `CONVERTED` / `QUALIFIED` (fell through, re-qualify) / `LOST`
- `CONVERTED` is terminal; `LOST` → `CONTACTED` (re-engagement).

`DEMO_SCHEDULED` deliberately means **a real appointment was confirmed with
the contact**. There is no calendar integration, so nothing sets it
automatically — not the form, not the notifier — only the explicit operator
action, and a fresh `NEW` lead cannot jump there without being contacted
first.

- Every transition appends a `marketing_lead_events` row (`STATUS_CHANGED`,
  `CONTACTED`, `NOTE_ADDED`) with a safe `actor` label (`system` /
  `public-form` / `super-admin`) — never an email address or raw token.
  Status changes and notes are additionally audited (`audit_logs`) with
  statuses and note *lengths* only — never the note text or contact
  details.
- Attribution: leads from campaign replies carry `campaign_id` /
  `campaign_recipient_id` (both `ON DELETE SET NULL` — the lead, and its
  consent evidence, must survive campaign data being purged).
- Privacy: this is personal data volunteered for a sales conversation.
  `consent_at` is non-nullable proof of permission; soft delete hides a lead
  from the console without destroying consent evidence; a right-to-erasure
  request is a hard delete plus lead-event cleanup.

## SPF, DKIM, DMARC and List-Unsubscribe requirements

Deliverability is a **deployment** responsibility (DNS records for the
sending domain), but the application enforces its half of the contract:

- **SPF** — the SMTP relay must be an authorized sender for the `EMAIL_FROM`
  domain. Deployment: one SPF TXT record on the sending domain. App: nothing
  to do — it sends through the configured relay only.
- **DKIM** — the relay must sign outgoing mail. Deployment: publish the
  relay's DKIM public key. App: nothing to sign itself (no local MTA).
- **DMARC** — deployment publishes a policy (start at `p=none` with
  `rua=` reporting, tighten to quarantine/reject once aligned). App: never
  sends from a domain it does not control; `EMAIL_FROM` is configuration.
- **List-Unsubscribe** — every campaign email carries the
  `List-Unsubscribe` (and `List-Unsubscribe-Post`) headers pointing at the
  recipient's personalized unsubscribe endpoint, plus a visible unsubscribe
  link in the body. One-click unsubscribes are honoured without login. This
  is both a mailbox-provider requirement for bulk senders and the polite
  thing to do.

`EMAIL_FROM`, the relay host and the credentials are environment
configuration (see below). SPF/DKIM/DMARC setup is documented in
`docs/deployment.md` territory and belongs to the operator's DNS.

## Campaign recipients vs Super Admin notifications

Two strictly separated rails — confusing them is the classic marketing-system
bug, so the boundary is enforced in configuration and in code:

|                       | Campaign emails                                             | Super Admin notifications                                                    |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Recipients            | School addresses from the **server-side audience snapshot** | `MARKETING_ADMIN_EMAILS` only                                                |
| What                  | Marketing content (template version)                        | Test emails, demo lead notifications, campaign failure alerts, system alerts |
| Sent by               | Background worker, batched with backoff                     | The event that caused them (single messages, never bulk)                     |
| May be test-targeted? | No — test sends go only to `MARKETING_TEST_RECIPIENTS`      | Yes — that is their purpose                                                  |
| Analytics             | `email_events` per recipient                                | None (operational mail)                                                      |

Rules that follow:

- **A campaign email is never automatically copied to the Super Admin.**
  Doing so would put a live recipient list into a forwarded/shared mailbox
  (see next section) and would distort click/unsubscribe analytics.
- **Test sending is closed by construction.** The browser cannot supply an
  arbitrary test address; `isMarketingTestRecipient()` (in
  `web/src/server/config/marketing.config.ts`) is the single gate, and the
  only way to widen the set is `MARKETING_TEST_RECIPIENTS` in the
  environment.
- **Campaign failure alerts** (worker aborted a campaign, rail
  misconfigured) go to `MARKETING_ADMIN_EMAILS` as operational mail.

## Privacy limitation of forwarded emails and shared mailboxes

Auto-forwarding and shared/group mailboxes defeat the privacy model of
per-recipient tokens, and the system deliberately does not fight it:

- A **forwarded campaign email** carries the original recipient's click and
  unsubscribe tokens. Whoever receives the forward can click tracked links
  (attributing engagement to the original recipient), use the one-click
  unsubscribe (suppressing the _original_ address), and read the content.
  Per-recipient digest tokens make forgery impossible, but they cannot make
  a voluntarily forwarded email private.
- A **shared mailbox** (several staff reading one address) makes
  "who clicked" ambiguous by nature — the analytics record the address, not
  the human.
- **Why we accept this:** preventing it would require locking emails to a
  device or identity (authenticated links), which breaks the no-login
  unsubscribe requirement and the email medium itself. The mitigation is
  honesty: tokens identify an _address_, not a person, and no sensitive
  personal data is ever placed in a campaign body or a tracking URL beyond
  the opaque token itself.

Consequence for operators: never configure `MARKETING_ADMIN_EMAILS` or
`MARKETING_TEST_RECIPIENTS` as an auto-forwarding shared mailbox that leaves
the organization's control — the demo lead notifications sent there contain
personal data (name, email, phone) entrusted by the data subject.

## Environment variables

| Variable                                  | Purpose                                               | Default      |
| ----------------------------------------- | ----------------------------------------------------- | ------------ |
| `EMAIL_PROVIDER`                          | `smtp` selects real delivery                          | unset → NoOp |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | relay endpoint                                        | —            |
| `SMTP_USER` / `SMTP_PASS`                 | relay credentials (**secrets — never commit or log**) | —            |
| `EMAIL_FROM`                              | header sender of every message                        | —            |
| `MARKETING_ADMIN_EMAILS`                  | Super Admin notification recipients (comma-separated) | empty        |
| `MARKETING_TEST_RECIPIENTS`               | closed allowlist for test sends (comma-separated)     | empty        |
| `MARKETING_WORKER_ENABLED`                | `false` disables the campaign worker                  | `true`       |
| `MARKETING_WORKER_INTERVAL_MS`            | sweep cadence                                         | `15000`      |
| `MARKETING_WORKER_INITIAL_DELAY_MS`       | delay before first sweep                              | `30000`      |
| `MARKETING_BATCH_SIZE`                    | recipients claimed per sweep                          | `25`         |
| `MARKETING_MAX_ATTEMPTS`                  | attempts before terminal `FAILED`                     | `5`          |
| `MARKETING_RETRY_BASE_MS`                 | first retry delay (doubles + jitter, capped 15 min)   | `60000`      |
| `MARKETING_RATE_PER_MINUTE`               | hard ceiling of messages per rolling minute           | `60`         |
| `MARKETING_CONCURRENCY`                   | recipients in flight at once                          | `3`          |
| `MARKETING_SEND_DELAY_MS`                 | base gap between sends                                | `250`        |
| `MARKETING_SEND_JITTER_MS`                | random extra gap between sends                        | `250`        |
| `MARKETING_EXPIRY_MS`                     | age after which an unsent recipient expires           | `259200000`  |
| `MARKETING_LEASE_MS`                      | claim lease; drives crash recovery                    | `120000`     |

`MARKETING_WORKER_BATCH_SIZE`, `MARKETING_DELIVERY_MAX_ATTEMPTS` and
`MARKETING_DELIVERY_BASE_BACKOFF_MS` remain accepted as aliases of the three
canonical names above.

`MARKETING_ADMIN_EMAILS` and `MARKETING_TEST_RECIPIENTS` are the only place
recipient addresses for operational mail may be configured — they are never
hard-coded in business logic. An empty list means the corresponding
notifications are skipped (and the failure is logged, not swallowed).

## Data model reference

| Table                       | Purpose                            | Key constraints                                                                                              |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `email_templates`           | template container                 | unique live `slug`                                                                                           |
| `email_template_versions`   | immutable content snapshots        | unique `(template_id, version)`; `published_at` marks immutability                                           |
| `email_campaigns`           | one send                           | pins `template_version_id` (`RESTRICT`); `audience_filter` JSONB; `audience_snapshot_hash`; counters         |
| `email_campaign_recipients` | audience snapshot + delivery state | unique `(campaign_id, normalized_email)`; unique `click_token_hash`, `unsubscribe_token_hash` (digests only) |
| `email_events`              | append-only engagement log         | no raw tokens, no bodies; `(campaign_id, event_type, occurred_at)` analytics index                           |
| `marketing_suppressions`    | do-not-send list                   | unique `normalized_email`                                                                                    |
| `marketing_leads`           | demo/sales leads                   | non-null `consent_at`; UTM JSONB; campaign attribution `SET NULL`                                            |
| `marketing_lead_events`     | append-only lead trail             | safe `actor` label                                                                                           |

All primary keys are UUIDv4. Status-like columns are plain VARCHARs
validated against the shared enums (`packages/shared-types` →
`packages/validation` → API layer) — the `import_jobs` pattern, so adding a
value is a code-only change. The physical schema is migration-driven
(migrations `20260927130000` … `20260927130500`); the models are never
synced.

## Session roadmap

Implemented in session 1: the documentation you are reading, the six
migrations and eight models above, the shared enums/types, the validation
schemas, the typed marketing configuration and `.env.example` placeholders.

Implemented in session 2 (this session): the SUPER_ADMIN-only template and
campaign management APIs (`web/src/server/api/marketing.ts` +
`web/src/server/modules/marketing` + the App Router routes under
`web/src/app/api/v1/marketing`), including:

- template lifecycle — list/detail/create/update, draft-content saves,
  one-way **publish**, archive, preview with sample variables, and a
  test-send endpoint restricted to `MARKETING_TEST_RECIPIENTS`;
- the **tokenizer-based HTML sanitizer** that validates *and* sanitizes
  template bodies (rejecting `script`/`iframe`/`form`, `on*` handlers and
  unsafe URL schemes — never regex-only filtering);
- campaign lifecycle — list/detail/create/update, **audience preview**
  (counts, masked sample, snapshot hash), **schedule** (transactional
  recipient snapshot + `audience_snapshot_hash`, idempotent by construction
  and via `x-idempotency-key`), pause/resume/cancel with validated
  transitions;
- the **server-side school audience builder** — city/state/country,
  subscription status, explicit include/exclude, `recipient_sources`
  (school primary email by default, active SCHOOL_ADMIN accounts only when
  selected), missing/invalid-email exclusion, suppression exclusion and
  normalized-address deduplication;
- audit actions/entity types for every marketing mutation, with
  safe-metadata-only rules; typed `api-client` bindings for the whole
  surface. No email is sent by any of these endpoints (scheduling only
  freezes the snapshot); no frontend UI exists yet.

Implemented in session 3 (this session):

- the **durable delivery worker** (`marketing-delivery.worker.ts`,
  `marketing-delivery.policy.ts`, `marketing-delivery.scheduler.ts`) —
  `FOR UPDATE SKIP LOCKED` claiming under an advisory lock, leases and crash
  recovery, bounded concurrency, per-minute rate ceiling, delay/jitter,
  exponential backoff with a permanent/transient split, and expiry;
- **per-recipient rendering** from the pinned immutable version
  (`marketing-message.builder.ts`), token minting with SHA-256-only storage,
  `Reply-To` / `List-Unsubscribe` / `List-Unsubscribe-Post` headers;
- **campaign progress counters** recomputed from recipient rows, with
  completion, `PARTIALLY_FAILED` and cancellation semantics;
- the **public tracking endpoints** (`api/public-marketing.ts`) with unique
  vs total click counting, idempotent unsubscribe, strict rate limiting and
  open-redirect prevention;
- **admin alerting** to `MARKETING_ADMIN_EMAILS` with per-campaign cooldown;
- **platform-scoped idempotency keys** (`school_id IS NULL`) that cannot
  collide with tenant keys or with another resource type;
- the **Super Admin console** — `/admin/marketing/templates` and
  `/admin/marketing/campaigns` (list, create, detail, publish, preview,
  test send, schedule, pause/resume/cancel, progress and engagement),
  built on the shared `apiClient` with no direct `fetch`.

Implemented in session 4 (this session):

- the **public "Request a Demo" form** on the landing page
  (`web/src/app/DemoRequestForm.tsx`, `#request-demo` section): required
  name/work email/institution, optional phone/city/country/contact
  time/message, explicit consent checkbox, hidden honeypot, loading /
  success / validation / server-error states — submitted through the shared
  `apiClient`;
- the **public lead capture endpoint**
  (`POST /public/marketing/demo-request`, `api/public-demo-request.ts`):
  shared-schema validation, email normalization, honeypot drop, content
  fingerprint idempotency, dedicated per-IP + hashed-identity rate limits,
  cookie-only attribution resolution, one generic `202` answer, and the
  **store-lead-before-notify** ordering;
- the **asynchronous admin notification**
  (`marketing-lead-notifications.ts`) to `MARKETING_ADMIN_EMAILS`: bounded
  retry, `ADMIN_NOTIFIED` / `ADMIN_NOTIFY_FAILED` timeline records,
  `admin_notified_at` stamp, `APP_URL`-based console deep link, no payload
  logging;
- the **Super Admin Leads console** (`/admin/marketing/leads` +
  `/admin/marketing/leads/[id]`, SUPER_ADMIN only): search, status /
  source / campaign filters, date range, pagination, masked list columns,
  detail with contact info, attribution (+ forwarded-email caveat),
  consent record, event timeline, internal notes and server-enforced
  status transition buttons;
- **lead funnel metrics** (`GET /marketing/leads/metrics`): new leads (7/30
  days), leads by status and by campaign, total + unique clicks,
  click-to-lead conversion, unsubscribed total, recent demo requests — all
  plain counts, no charting dependency;
- audit actions for lead status changes and notes (safe metadata only), the
  `20260928080000-marketing-lead-capture` migration (`consent_source`,
  `admin_notified_at`, `submission_fingerprint` + index), and typed
  `api-client` bindings for the whole lead surface.

## Production delivery scheduling (Hardening 5A)

Campaigns keep their own `scheduled_at` instant. The worker wakes every minute,
claims only due PostgreSQL rows, and applies the durable daily and per-minute
caps in `/admin/marketing/settings`. Reaching the daily cap does **not** mean one
run every 24 hours: unsent rows stay queued and resume automatically on the next
calendar day in the configured IANA timezone. Pause behaves the same way: it
stops new claims without deleting queue rows.

Two deployment options are supported:

1. **Always-on Render web service** — keep `MARKETING_WORKER_ENABLED=true`; the
   in-process scheduler runs while the service is awake.
2. **Optional Render Cron Job** — run
   `npm --prefix web run marketing:worker:once`. It performs one sweep, prints
   only aggregate metrics, closes PostgreSQL, and exits. PostgreSQL advisory
   locks, row locks, and leases make this safe alongside the web worker.

A sleeping Render web service cannot process an in-process timer. Use an
always-on service or the Cron Job option; merely scheduling a campaign does not
keep a sleeping service alive.

All real database and SMTP secrets belong only in Render Environment settings.
For Gmail SMTP, use a Gmail App Password rather than the account password. The
current `gmail.com` sender provides no custom DNS control, so configure
`Zero Mile Systems <zeromilesystems@gmail.com>` and never invent an unverified
invented or unverified custom-domain sender.
