# Notification Hardening — Phase 1 Handoff

Phase 1 fixes **stop-arrival/proximity detection and notification recipient
correctness**. No push-provider changes, no iOS fixes, no delivery workers
(those are Phase 2). No paid services, no routing APIs, no production
deploys — local calculations over existing backend/database infrastructure
only.

## What changed

### 1. Correct recipients (`notifications.service.ts` + `run-ridership.ts`)

- New shared pure helpers in
  `web/src/server/modules/live-tracking/run-ridership.ts`:
  `resolveTripRunId` / `studentRidesTripRun` (+ `normalizeRunId`).
- Stop-arrival and trip-status recipient resolution is now **trip/run
  aware**: only riders allocated to the trip's run (explicit `run_id` →
  else route default run → else every route student on run-less routes;
  unallocated students ride the default run). Different runs sharing a
  route/stop no longer notify each other's parents.
- `resolveGuardianUserIdsForStop` now takes the trip, verifies the stop is
  on the trip's route, and returns nobody for unknown trips — previously it
  ignored the trip entirely.
- `LiveTrackingService.hasLinkedChildOnTrip` was refactored onto the same
  helpers, so parent observation visibility and notification recipients
  cannot drift apart.
- Preserved: tenant pinning on every lookup, active student / active
  guardian-link / active `PARENT`-role checks, sibling + duplicate-link
  dedup (per-user `(type, trip, stop)` idempotency), and the
  `SCHEDULED`-never-notifies rule.

### 2. GPS freshness and quality (`stop-arrivals.service.ts`, `eta.service.ts`)

- Ingestion is untouched (every accepted fix is still persisted and stays in
  history / offline attendance), but live alerts now pass
  `assessFixEligibility`, measured from the original `recorded_at` against
  the server receipt clock:
  - **stale** — older than `ARRIVAL_MAX_FIX_AGE_MS` (default 3 min: live
    fixes arrive within seconds; 3 min tolerates flaky-network batching
    while rejecting offline replays hours old);
  - **future** — beyond `ARRIVAL_FUTURE_TOLERANCE_MS` (default 1 min,
    tighter than the 5 min ingest skew window, which stays permissive);
  - **inaccurate** — worse than `ARRIVAL_MAX_ACCURACY_METERS` (default
    100 m: a fix less precise than the default geofence cannot localise
    inside it);
  - **missing accuracy** — eligible iff `ARRIVAL_ALLOW_MISSING_ACCURACY`
    (default true: the field is optional and some devices omit it);
  - **implausible jump** — implied speed over `ARRIVAL_MAX_PLAUSIBLE_SPEED_KMH`
    (default 150) across at least `ARRIVAL_MIN_JUMP_DISTANCE_METERS`
    (default 500 m, so stationary wander never triggers). Jumps still
    advance the reference point: one glitch costs at most two fixes and
    genuine relocation re-syncs immediately.
- Arrival rows are timestamped at the fix's original time (clamped to
  `now`), not evaluation time.
- Stale GPS no longer appears as a fresh ETA: `computeTripEta` accepts
  `now`, and fixes older than `ETA_STALE_AFTER_MS` (default 3 min) or
  future-dated yield `eta_available: false` with distances/ETAs/speed
  withheld. The last-known position (with timestamps) and arrival-derived
  progress are still returned. All production callers pass `now`
  (`api/eta.ts`, `getProgress`, parent portal).

### 3. Stop progression (`stop-arrivals.service.ts`)

- Replaced "earliest unvisited stop in radius" with
  `selectProgressionCandidate`: only stops **ahead of the progress
  frontier** (highest recorded sequence) are eligible; evidence escalates
  with distance — next stop needs `ARRIVAL_REQUIRED_CONSECUTIVE_FIXES`
  (default 2: one fix is vulnerable to urban jitter, two cost ~2.5–5 s),
  stops within `ARRIVAL_MAX_SKIP_AHEAD` (default 2) need
  `+ARRIVAL_SKIP_EXTRA_FIXES` (default 1), further stops need one more
  (explicit re-sync). Ranking: most consecutive evidence → nearest →
  earliest sequence, so overlapping geofences resolve to sustained
  presence. One fix records at most one arrival.
- Consecutive-fix evidence per trip/stop with an exit-hysteresis fringe
  (`ARRIVAL_EXIT_HYSTERESIS_METERS`, default 20 m: past-edge fixes preserve
  partial evidence instead of wiping it) and an optional dwell span
  (`ARRIVAL_MIN_DWELL_MS`, default 0/disabled — the count rule already
  implies dwell at the GPS throttle).
- Skip is final for stops behind the frontier, but never blocks later
  stops; mid-route joins and reconnects re-sync via the escalated tiers
  (frontier rebuilds from DB arrivals after restarts; only the in-memory
  consecutive counts rebuild, costing ~1 extra fix).
- Heading is **not** used (meaningless when stationary); stationary buses
  confirm by sustained presence. The domain supports one direction only —
  ascending `sequence_number` (no reverse-trip concept exists). No routing
  service; straight-line GPS explicitly cannot distinguish parallel roads.

### 4. Duplicates and wording

- DB unique index `(school_id, trip_id, stop_id)` + in-memory seen-set +
  existence check retained: once-per-trip-stop, concurrent-safe (races
  collapse to no-op), restart-safe, multi-instance-safe. Morning/afternoon
  trips are separate trips — unaffected.
- Parent copy changed to proximity wording: title `Bus is near your stop`,
  message `Bus is near <stop>.`, payload gains `proximity_only: true`. The
  `STOP_ARRIVED` type/enum name is unchanged for DB/API compatibility, and
  attendance copy (`boarded`/`dropped off`) is untouched — attendance stays
  semantically separate.
- Mobile label `📍 Bus at stop` → `📍 Bus near stop` (+ spec fixture copy).

### Config / wiring

- `web/src/server/config/eta.config.ts`: `ETA_STALE_AFTER_MS` + the
  `eta.arrival.*` block (all env-backed, safe fallbacks). `container.ts`
  wires them into `StopArrivalsService`/`EtaService` and injects `Run` into
  `NotificationsService`. `LiveTrackingService.recordLocation` passes its
  receipt clock into arrival evaluation.

## Tests (all run, all green)

- `stop-arrivals.service.spec.ts` — rewritten/extended to 49 tests: legacy
  geofence/isolation/terminal-trip cases updated to the confirmation model,
  plus stale/future/inaccurate/missing-accuracy/offline-replay/jump,
  stationary-no-heading, hysteresis fringe/reset, concurrent duplicates,
  restart recovery, skip/recovery, re-sync tiers, and unit tests for
  `assessFixEligibility` + `selectProgressionCandidate`.
- `notifications.service.spec.ts` — run-tiering fixtures: shared stop across
  runs, legacy NULL-run trips, run-less legacy routes, siblings, duplicate
  links, unknown trip/off-route stop, tenant isolation (+ updated wording
  asserts).
- `eta.service.spec.ts` — 5 new staleness tests (withheld ETA, kept
  last-known position + arrival progress, future-dated, fresh, legacy
  no-clock behaviour).
- Full `web` server suite: **1779/1779 pass**; `web` + `mobile` typecheck
  clean; eslint clean on all touched files; prettier applied; mobile
  `notifications-state.spec.ts` 7/7 pass.

## Limitations / known behaviour

- Consecutive-fix evidence and the jump reference are in-memory per
  process: a restart delays the next arrival by ~1 fix (DB still prevents
  duplicates); multi-instance deployments may each accumulate evidence but
  the unique index guarantees a single arrival/notification.
- `minDwellMs` defaults to disabled; enable per-tenant if drive-by stops
  need time-based confirmation.
- Jump suppression applies to arrival alerts; the raw fix broadcast and the
  ETA still use the reported position (ETA self-corrects on the next fix).
- No reverse-direction, loop-route repeat-visit, or per-stop exit/re-entry
  semantics — once-per-trip-stop by design.
- `STOP_ARRIVED` type name retained (proximity copy only); clients should
  key off `payload.proximity_only` if they branch on semantics.

## Phase 2 — durable push delivery (implemented)

Phase 2 (this PR) replaces the old "wire-once FCM call inside the request
path" with a **DB-backed outbox over the existing `notifications` table**,
plus the **platform-correct push rails** (Android FCM + iOS direct APNs).
No queue service, no new billable Firebase products, no paid provider.

### Outbox delivery (`web/src/server/modules/notifications/outbox/`)

- Creation persists the row **and** its delivery work atomically:
  `push_status = 'pending'`, `next_attempt_at` (due), `push_expires_at`
  (event window) and a stable `dedup_key`. A crash after event persistence
  recovers on restart because the work is a column state, not an in-flight
  call. The attendance/trip/arrival paths never block on per-parent push.
- `DeliveryWorker` sweeps due rows (default every 4s), claims them **per
  school** under `pg_try_advisory_xact_lock` (same class-of-lock trick as the
  retention worker) so N API instances never double-deliver; the lock is
  transaction-scoped and auto-releases on commit/rollback, so a crashed
  worker's rows become claimable again immediately.
- Transient failures retry with **bounded exponential backoff**
  (`2s · 2^attempt`, capped 90s, max 8 attempts). Permanent failures
  (every token rejected) and expired rows are abandoned with a reason.
- Event expiry: `push_expires_at` (default 10 min) plus a live check — a
  `STOP_ARRIVED` proximity alert is abandoned once its trip is no longer
  tracking, never delivered after the trip ends.
- Per-device outcomes: `delivered_tokens` stores the provider-_accepted_
  devices (partial success is `sent`); `delivery.delivered_tokens` in the
  response is the accepted count, never a claim of on-device display.
- Invalid/unregistered tokens (FCM `UNREGISTERED` /
  `messaging/registration-token-not-registered`; APNs `410 Unregistered` /
  `400 BadDeviceToken`) are retired immediately via `deactivateTokens`.
  (Corrected by the follow-up patch below: a bare APNs `400`, a bad
  topic/credential, or a malformed payload must **not** retire a token.)
- NoOp provider rows become `push_status = 'not_configured'` immediately —
  local dev/CI never pretend success.

### Platform-correct push rails (`providers/`)

- `PushDeliveryRouter` partitions targets by `platform`: **Android → FCM**,
  **iOS → direct APNs**, no metadata → FCM (legacy fallback). A raw APNs
  token is therefore **never sent as an FCM registration token** — the exact
  bug found in Phase 1 (`getDevicePushTokenAsync()` returns an APNs token on
  iOS).
- `FcmPushProvider` (free) — Android-only `sendEachForMulticast` on channel
  `notifications`, notification + string-only `data`, high/normal priority.
- `ApnsDirectProvider` (free, no vendor) — one HTTP/2 request per token to
  `api.push.apple.com` (sandbox outside production), ES256 provider JWT from
  an `.p8` key (`node:crypto`), 410/400→invalid, 403/429/5xx→retryable.
- iOS tokens with no APNs credentials are reported `not_configured` —
  permanent for this deployment, never "sent".

> The Phase 2 bullets above are the historical state; the **corrective patch**
> below supersedes the delivery-decision, APNs-classification and expiry
> behaviour they describe.

### Env / config

- FCM: `FIREBASE_SERVICE_ACCOUNT_JSON` (+ optional `FIREBASE_PROJECT_ID`).
- APNs: `APNS_KEY_PEM`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`,
  `APNS_PRODUCTION`.
- Outbox: `NOTIFICATION_OUTBOX_ENABLED`, `NOTIFICATION_OUTBOX_INTERVAL_MS`
  (4000), `NOTIFICATION_OUTBOX_INITIAL_DELAY_MS` (3000),
  `NOTIFICATION_OUTBOX_BATCH_SIZE` (50), `NOTIFICATION_DELIVERY_MAX_ATTEMPTS`
  (8), `NOTIFICATION_DELIVERY_BASE_BACKOFF_MS` (2000),
  `NOTIFICATION_DELIVERY_EXPIRY_MS` (10 min).

### Tests (Phase 2, all green)

- `outbox/delivery-policy.spec.ts` — backoff bounds, expiry, dedup key
  length, `decideDelivery` partial-success / not-configured / permanent.
- `outbox/delivery-worker.spec.ts` — claim/send/sent, advisory-lock skip,
  expiry abandon, trip-ended abandon, transient backoff, invalid-token
  retirement, partial success, throwing provider degrades to retryable.
- `outbox/delivery.scheduler.spec.ts` — start/restart cadence, duplicate
  registration, in-flight tick skip, throw-resilience, env disable, no-DB
  refusal.
- `providers/push-delivery-router.spec.ts` — android→FCM/ios→APNs/legacy→FCM
  partitioning, ios without APNs → `not_configured`, throwing rail → retryable.
- `providers/apns-direct.provider.spec.ts` — alert headers, 410/400 invalid,
  403/429/5xx retryable, mixed batch, Android-token refusal.
- `providers/fcm-push.provider.spec.ts` — updated to Phase 2 semantics
  (all-invalid is permanent), plus the propagated SDK error message.
- `providers/push-provider.factory.spec.ts` — NoOp default, router on
  FCM/APNs config, partial-APNs falls back to NoOp honestly.
- `notifications.service.spec.ts` — rewritten push-delivery block for outbox
  semantics (creation enqueues, never sends inline; NoOp → `not_configured`;
  `delivery` projection) + dedup-key idempotency backstop.
- Full `web` server suite **1819/1819**, `test:web` **236/236**,
  `typecheck:server` and `build:server` clean, root `lint` clean.

### Smoke

- `smoke-notifications` 18/18 (was 15/18 at HEAD — stubbed the new
  `runs`/`deviceTokens.findActiveTokenTargets`/`deliveryPolicy` surface).
- `smoke-eta-arrivals` 15/16; the one remaining failure is pre-existing at
  HEAD (a `Run` model initialization issue inside the smoke's token-flow
  replica), independent of this phase. The two stale "Bus arrived at …" copy
  assertions were updated to the committed Phase 1 "Bus is near …" copy.

### Remaining prerequisites (honestly reported)

- Android FCM requires a `firebase-admin` service-account JSON. FCM delivery
  is free; no billing-enabled account is needed for it.
- iOS delivers via direct APNs (free) but requires real Apple credentials:
  an APNs auth key (`.p8`) + Key ID + Team ID + the app's bundle id — issued
  by any (free or paid) Apple developer account. Building/signing for a real
  device additionally requires Apple code signing (never bypassed here), and
  the APNs auth key must correspond to the bundle id used to sign the app.
- Expo Go cannot receive remote push (SDK 53 removed the native modules);
  a development build is required.

## Corrective patch (A–D) — partial success, APNs, expiry, arrival atomicity

A follow-up static review of Phase 2 found four remaining correctness gaps.
This patch fixes exactly those; it does not redo Phase 1/2 and adds no maps,
features, paid services or new dependencies.

### A. Per-device delivery state (partial success / device-level retries)

Phase 2 marked a row `sent` as soon as _one_ device was accepted and
overwrote `delivered_tokens` on every attempt, so a device that failed
transiently next to an accepted one was never retried.

- **New migration** `20260918170000-notification-per-device-delivery-state.ts`
  adds `notifications.delivery_pending_tokens` (`text[]`, nullable). No merged
  migration is rewritten; `NULL` means "no attempt yet" (the first attempt
  targets every currently active device), so every pre-existing row is valid
  with **no backfill**.
- `delivered_tokens` keeps its meaning (provider-**accepted** devices only) and
  is now **accumulated** across attempts; `delivery_pending_tokens` is the
  device-level retry queue, written in the same transaction as the attempt.
- `decideDelivery()` now works from the accumulated state and returns one of
  `sent` / `partial` / `not_configured` / `failed` plus the accepted and
  still-pending device sets. Retries only target devices that are still owed a
  delivery; a device accepted by an earlier attempt (even by another instance
  before a restart) is never re-sent.
- **`partial`** is a new terminal `push_status` (added to
  `ExternalDeliveryStatus`): at least one device was accepted, other targeted
  devices never were (retired token, no rail, provider misconfiguration,
  exhausted retries or a closed event window). The response projection exposes
  `status`, `delivered_tokens` (accepted count), `pending_tokens` (never
  delivered) and `complete` (`true` only for `sent`) — a partially delivered
  row is never presented as fully delivered.
- Invalid tokens are retired per device and removed from the pending set
  without blocking the other devices; the retirement update joins the
  attempt's transaction.
- **Token rotation / new devices (explicit policy):** the target set is fixed
  by the first attempt. Tokens that disappear during the window (logout,
  unregister, invalidated) are dropped from the pending set rather than
  retried forever; devices registered _after_ the first attempt are **not**
  added — the alert is already in the in-app inbox, and adding recipients
  mid-retry would let a reinstall loop expand a delivery indefinitely.
- Retry limits, bounded exponential backoff, per-school advisory locking and
  tenant isolation are unchanged.
- **Honest semantics:** provider acceptance (`delivered_tokens`) is not proof
  of display on the phone, and exactly-once delivery is not promised — if a
  provider accepted a push but the worker's transaction did not commit, the
  row is re-claimed and that device may receive the push twice
  (at-least-once). Notification/event ids are stable, so the client side is
  idempotent.
- A `noop-push` provider can never produce `sent`: rows it touches become
  `not_configured` (this also covers rows recovered by the worker inside the
  create/crash window).

### B. Direct APNs provider correctness

- **Host selection** comes from the explicit provider configuration
  (`APNS_PRODUCTION` → `production` option): `true` → `api.push.apple.com`,
  `false` → `api.sandbox.push.apple.com`. `NODE_ENV` is no longer consulted —
  an app's APNs environment is decided by how it was signed, not by where the
  API happens to run.
- **Standards-compliant ES256 JWT:** header `alg: ES256` + `kid`, claims
  `iss` (Team ID) + `iat` (Unix seconds), base64url without padding, and the
  signature is produced with Node's `dsaEncoding: 'ieee-p1363'` (raw `R || S`,
  asserted to be exactly **64** bytes for P-256) instead of Node's default DER
  — DER signatures are what APNs answers with `InvalidProviderToken`. The
  provider-token cache now stores and compares **milliseconds** consistently
  (refresh window `APNS_TOKEN_TTL_MS` = 50 min) and can be invalidated after a 403.
- **Response classification uses the APNs `reason`, not only the status:**
  - retire the token: `Unregistered` (410), `BadDeviceToken`, a 404 device
    path, a bare 400 with no recognisable reason (treated as a message problem
    — never a token retirement);
  - terminal _config_ failure, token kept: `InvalidProviderToken`,
    `MissingProviderToken`, `BadTopic`, `MissingTopic`, `TopicDisallowed`,
    `InvalidTopicSize`, `BadPath`, `MethodNotAllowed`, `DuplicateHeaders`,
    `MissingDeviceToken`, `BadCertificate`, `BadCertificateEnvironment`,
    `DeviceTokenNotForTopic` (a mistyped topic must never wipe the device
    registry), plus 401/403 without a reason;
  - terminal _message_ failure, token kept: `PayloadEmpty`, `PayloadTooLarge`,
    `BadCollapseId`, `BadMessageId`, `BadPriority`, `BadExpirationDate`;
  - retryable: `ServiceUnavailable`, `InternalServerError`, `Shutdown`,
    `TooManyRequests`, `ExpiredProviderToken`, `IdleTimeout`,
    `TooManyProviderTokenUpdates`, 429, 5xx and any unrecognised non-4xx.
    These map onto distinct outcome buckets (`invalid`, `misconfigured`,
    `permanent`, `retryable`) so the outbox can react correctly instead of
    deactivating healthy devices or retrying a message Apple will always refuse.
- **HTTP/2 lifecycle:** every request has a hard deadline
  (`requestTimeoutMs`, default 10 s) plus a session timeout; the promise
  settles exactly once and the session is destroyed on the timeout,
  connection error, GOAWAY or response path. A failure for one device marks
  that device retryable and the loop continues, so every attempted token ends
  with a defined outcome; `send()` never throws out of the notification flow.
  (One subtlety worth keeping: the session must **not** have its listeners
  removed before `destroy()`, otherwise a teardown error such as
  `ECONNREFUSED` is emitted unhandled and crashes the process.)
- **Routing unchanged:** `PushDeliveryRouter` still sends Android → FCM and
  iOS → direct APNs, and a raw APNs token is never handed to FCM.
- **Documentation corrected:** APNs _delivery_ is free (no per-notification
  charge, no paid vendor). The prerequisites are Apple-side signing ones, not
  delivery ones: the app must be signed for a bundle id whose App ID enables
  the Push Notifications capability (so the `.p8` key's Team ID and the bundle
  id match), and installing on a physical iPhone requires Apple code signing.
  A free Apple ID "personal team" can sign with Apple's own limits; a paid
  membership removes them. Nothing here bypasses code signing and no purchase
  is required for APNs delivery.

### C. Deadline propagation (FCM TTL / APNs expiration)

- `PushNotificationPayload.expiresAt` carries the persisted **absolute**
  deadline (`notifications.push_expires_at`) from the worker → router →
  provider. The provider computes the _remaining_ lifetime immediately before
  each actual send, so a retry continues the original window instead of
  restarting it, and a long batch re-checks per device.
- Android: the remaining lifetime is passed as `android.ttl` in the Admin
  SDK's **millisecond** unit, clamped to FCM's documented 4-week maximum
  (`FCM_MAX_TTL_MS`); with no deadline the field is omitted (FCM default).
- iOS: `apns-expiration` is set to the deadline in **Unix seconds**.
- An already-expired message never calls a provider: the worker abandons it
  before resolving devices, and both providers re-check (reporting
  `deviceOutcome.expired`) even if they are called directly.
- `push_expires_at` is anchored to the **event** clock (`occurred_at`:
  arrival/attendance), so delayed processing inherits the remaining window
  instead of granting an obsolete alert a fresh 10 minutes; the worker keeps
  the active-trip check that suppresses a not-yet-sent proximity alert once
  the trip stopped tracking.
- **Honest limits:** provider-side expiry only stops stale _queued_ delivery.
  It cannot retract a notification the phone already displayed, it does not
  make delivery instant, and it is not a "trip ended ⇒ all pending alerts
  vanish" guarantee.

### D. Arrival → notification atomicity

**Option 1 (shared transaction)** was chosen, because the fan-out is small and
bounded (the guardians of one run's riders at one stop) and the code already
owns a single database: `StopArrivalsService` opens one transaction that
inserts the arrival row **and** every `notifications` row through
`NotificationsService.notifyStopArrival(input, { transaction })`.
Rationale vs Option 2: a durable fan-out job plus an idempotent worker would
add a table, a worker and a second failure mode for a fan-out that fits
comfortably in one transaction; Option 1 removes the crash window entirely
instead of shrinking it.

- A crash or error between the arrival insert and the notification rows now
  rolls **both** back, so no committed arrival loses its notification intent
  (the existing `(school_id, trip_id, stop_id)` dedup no longer blocks the
  retry, because nothing was committed).
- Nothing leaks from a rolled-back transaction: socket broadcasts and the
  outbox enqueue are registered with `transaction.afterCommit(...)`, and the
  recipient rows are written _inside_ the transaction.
- Fan-out is still idempotent: the partial unique index on
  `(school_id, user_id, dedup_key)` plus the pre-insert existence check keep a
  replayed/resumed fan-out from creating duplicate inbox rows.
- Recipient resolution keeps the Phase 1 run-aware rules, active
  account/guardian-link checks and tenant pinning — unchanged.
- **Dedup keys no longer truncate:** `deliveryDedupKey` is now a full SHA-256
  digest (64 hex chars) of the complete `[type, trip, student, stop]`
  composite, replacing `join(':').slice(0, 64)` which could cut a UUID and
  collide two genuinely different events.
- **No push calls in the GPS request path:** the fan-out only persists rows
  (`push_status = 'pending'`); FCM/APNs delivery stays with the outbox worker.
- **Scope:** only the stop-proximity/arrival path is claimed atomic.
  Attendance, trip-status and role pushes still create their rows after their
  own operation succeeded and are **not** asserted to be atomic here.

### Migrations / configuration

- New: `web/src/server/database/migrations/20260918170000-notification-per-device-delivery-state.ts`
  (`up`: add `notifications.delivery_pending_tokens`; `down`: drop it).
  Verified up + down against a real PostgreSQL 17.
- New API surface: `push_status = 'partial'`, `delivery.pending_tokens`,
  `delivery.complete` on `NotificationResponse`.
- **No new environment variables.** `APNS_PRODUCTION` keeps its meaning
  (`false` → sandbox; anything else → production) and is now the only thing
  that selects the APNs host. Delivery policy env vars are unchanged.

### Tests (all run, all green)

Unit / focused (no network, no real provider):

| Suite                                                                            | Result |
| -------------------------------------------------------------------------------- | ------ |
| `notifications/outbox/delivery-policy.spec.ts` + `delivery-worker.spec.ts`       | 42/42  |
| `providers/apns-direct.provider.spec.ts` (rewritten)                             | 21/21  |
| `providers/fcm-push.provider.spec.ts` (+7 TTL/classification)                    | 15/15  |
| `providers/push-delivery-router.spec.ts`                                         | 7/7    |
| `providers/push-provider.factory.spec.ts`                                        | 7/7    |
| `notifications/notifications.service.spec.ts` (+3 transactional, +1 event-clock) | 46/46  |
| `eta/stop-arrivals.service.spec.ts` (+4 durability)                              | 53/53  |

- Full `web` server suite: **1871/1871 pass** (403 suites).
- `test:web`: **236/236 pass**; web `typecheck` (`tsc --noEmit`),
  `typecheck:server`, the package typechecks and `build:server` clean; root
  `eslint . --max-warnings 0` clean; Prettier clean on every touched file.
  (The root `npm run typecheck` aggregates workspaces and still fails inside
  `mobile`, whose `node_modules` is not installed in this sandbox —
  `expo-router`/`@expo/vector-icons` cannot be resolved. That is an
  environment gap, not this patch: no mobile file is touched.)
- Integration against a real PostgreSQL 17
  (`test/integration/notification-outbox.integration.spec.ts`, new):
  **9/9 pass** — migration column shape, partial-success persistence, retry
  after a simulated restart targeting only the failed device, `partial`
  terminal row at the attempt limit, expired rows never reaching the provider,
  deadline passed to the provider, arrival + notification committed together,
  fan-out failure rolling the arrival back, replay idempotency, tenant
  isolation, and an outbox→delivery end-to-end with a scripted provider.
- `npm run test:db`: integration **121/121 pass** (12 suites, including the
  new outbox/arrival suite and the existing migration suite) followed by e2e
  **116/116 pass** — whole command exit 0.
- Smokes: `smoke:notifications` 18/18; `smoke:eta-arrivals` 15/16 — the single
  failure (`arrival: a fix inside the geofence records exactly one arrival`) is
  **pre-existing at the Phase 2 merge commit** (verified by running the same
  smoke from a clean worktree at `2bab8bb`), not caused by this patch.

### Real-device verification still required

Nothing in the tests above proves on-device delivery. Still needed, with real
credentials and a signed development build: an Android device behind FCM, an
iPhone behind APNs (sandbox for a dev build, production for TestFlight/App
Store), the partial-failure path with a genuinely stale token, and a
trip-ended proximity alert to confirm it stops being delivered.

### Remaining limitations

- Provider acceptance is not display; provider-side keys reduce stale _queued_
  delivery but cannot retract a displayed alert.
- At-least-once: a push accepted just before a crash may be re-sent; ids are
  stable so clients can dedupe.
- An APNs configuration error abandons the affected row (tokens kept, nothing
  retried) — fixing credentials does not replay older alerts.
- `delivery_pending_tokens` grows only with the devices targeted by the first
  attempt; a device registered after that is not retroactively targeted.
- Other business event paths (attendance, trip status, role pushes) are not
  claimed to be atomic; only the arrival/proximity path is.

## Suggested follow-ups (not in scope)

Admin UI surfacing of the tunables, per-school arrival config overrides,
metrics/alerts for delivery abandonment reasons, and any ETA smoothing or
parallel-road disambiguation beyond straight-line GPS.
