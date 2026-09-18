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

## What remains for Phase 2

Push-provider changes (FCM/APNs hardening, token lifecycle edge cases),
iOS-specific fixes, delivery workers/retries, and any ETA smoothing or
parallel-road disambiguation beyond straight-line GPS. Suggested follow-ups
from this phase: admin UI surfacing of the new tunables, per-school arrival
config overrides, and metrics for rejection reasons (`stale`/`future`/
`inaccurate`/`implausible-jump` counts).
