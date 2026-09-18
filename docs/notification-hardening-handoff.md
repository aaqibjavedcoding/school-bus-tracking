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
  retention worker) so N API instances never double-deliver; a claim lease +
  transaction scope make a crashed worker's rows reclaimable.
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
  `messaging/registration-token-not-registered`; APNs `410`/`400`) are
  retired immediately via `deactivateTokens`.
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

## Suggested follow-ups (not in scope)

Admin UI surfacing of the tunables, per-school arrival config overrides,
metrics/alerts for delivery abandonment reasons, and any ETA smoothing or
parallel-road disambiguation beyond straight-line GPS.
