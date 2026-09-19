# Mobile Tracking Reliability

## Overview

This document describes how the crew app keeps GPS sharing alive on a real phone —
background/headless execution, reconnect after network loss or an expired token,
honest status reporting, permission and battery handling, Android Firebase
wiring, and notification presentation de-duplication. It also states plainly what
the app **cannot** do, because an OS restriction is not a bug we can patch.

Scope: `mobile/` only. Server authorization, tenant isolation and the
notification-hardening work of PR #139 are unchanged
(see `docs/notification-hardening-handoff.md`, `docs/notifications.md`).
Offline **attendance** sync is a separate, pre-existing subsystem
(`docs/mobile-operations.md`) and is not affected by anything described here.

## Why this exists

Before this patch the crew GPS path had four failure modes that all looked like
"the school cannot see the bus":

1. A background (headless) task execution started with an **empty in-memory
   access token**, so it could not authenticate a socket and dropped every fix.
2. Each mounted screen created its own `watchPositionAsync` subscription, so
   navigating Trip → Help → Trip produced duplicate watchers and duplicate
   fixes, and unmounting one screen could stop sharing entirely.
3. Status text was derived from "the phone has a GPS fix", which is **not** the
   same fact as "the server acknowledged it" — the UI could claim the school saw
   the bus while every delivery was failing.
4. `android.googleServicesFile` was never wired, so a native Android build could
   not obtain an FCM token and push silently never arrived.

## Architecture

One **singleton lifecycle controller** owns every tracking fact; screens only
bind to it and render.

| Module | Responsibility |
| --- | --- |
| `src/features/crew/tracking-lifecycle.ts` | The controller: watcher, background task, socket delivery, recovery scheduling, persisted context, stats. Singleton — no per-screen state. |
| `src/features/crew/useCrewLocationSharing.ts` | Thin binding used by `trip.tsx` and `help.tsx`; subscribes, never starts a second watcher. |
| `src/features/crew/location-task.ts` | `TaskManager.defineTask` → `runHeadlessCrewLocationTask()`. |
| `src/services/session-recovery.ts` | Bounded, **single-flight** session recovery for headless runtimes. |
| `src/services/socket-recovery.ts` | Pure decisions: disconnect classification, bounded backoff, connect wait, ack wait, ack classification. |
| `src/features/crew/tracking-context.ts` | Persisted "which trip am I sharing" context, scoped to user + school. |
| `src/features/crew/pending-fix.ts` | The single held-fix slot (latest-only, age- and attempt-bounded). |
| `src/features/crew/tracking-status.ts` | Pure status derivation from facts (device fix vs server ack). |
| `src/features/crew/gps-permission-state.ts` | Pure permission/accuracy/services decision + settings-action mapping. |
| `src/features/crew/battery-guidance.ts` | Honest battery guidance (never claims to detect OEM restrictions). |
| `src/features/notifications/presentation-dedup.ts` | Foreground socket/push presentation claim registry. |
| `src/features/notifications/push-config.ts` | Push configuration diagnostics from error facts (no native module needed). |
| `scripts/verify-firebase-config.mjs` | Build-time Firebase wiring check (facts only, never prints contents). |

Every module in that table except the controller is **pure and native-free**, so
each branch is unit-tested without a device or an emulator.

## 1. Background / headless GPS recovery

`runHeadlessCrewLocationTask(locations)` runs a fixed, fully bounded sequence.
Each step reports its outcome as data — nothing fails silently.

1. **Batch triage.** Only the **newest** fix of an OS batch is a candidate; the
   older ones are counted as superseded. Replaying a batch would put minutes-old
   coordinates on the live map as if they were current.
2. **Session** (`recoverSession`, bound `SESSION_RECOVERY_TIMEOUT_MS = 8 s`).
   Uses the existing secure cookie refresh (`POST /auth/refresh` through
   `apiClient`) — no new auth mechanism, no token stored in JS beyond the
   existing in-memory access token. It is **single-flight**: a headless
   execution and a foreground recovery running at the same moment join one
   attempt instead of rotating the refresh token against each other. A
   generation counter makes a token that lands after logout/account switch get
   dropped, never applied.
3. **Context ownership.** The persisted context
   (`@sbt/crew-tracking-context`) carries `userId`, `schoolId`, `tripId` and a
   timestamp. It is resumed only when it belongs to the recovered session and is
   younger than `TRACKING_CONTEXT_MAX_AGE_MS = 12 h`. A context for another user
   or another school is **deleted**, not merely ignored. The pre-patch key
   (`@sbt/crew-active-trip-id`, a bare trip id with no owner) is removed on stop
   and can never be resumed.
4. **Eligibility** (`GET /trips/:id`, bound `6 s`). A trip that is not
   `BOARDING`/`IN_PROGRESS` stops tracking for good. A network failure here is
   `unverified` and deliberately **not** fatal: the socket handshake and every
   `trip:location:update` are authorized server-side anyway, so a failed extra
   GET must not kill a working stream.
5. **Connectivity** (bound `6 s`), authenticate **before** any GPS is sent, then
   rejoin the trip room.
6. **Delivery** (ack bound `5 s`). If the socket is not connected, the newest fix
   goes into the single held-fix slot and a bounded recovery pass is scheduled.

Cancellation: `stopCrewTracking()`, `endCrewTrackingSession()` (logout / account
switch, called from `AuthProvider`) and a trip switch bump an **epoch** counter,
clear the recovery timer, drop the held fix, invalidate in-flight session
recovery and clear the persisted context. Any late async completion from the
previous epoch becomes a no-op, so a session can never be resurrected after
logout — and a trip is never resumed for a different account.

## 2. Network loss and expired-auth reconnect

`classifySocketDisconnect()` maps Socket.IO signals to a decision class:

| Class | Trigger | Action |
| --- | --- | --- |
| `client-stop` | `io client disconnect` (we called `disconnect()`) | Never retry. |
| `auth-expired` | `io server disconnect` with `session:revoked { reason: 'token_expired' }`, or a refused handshake | Refresh the session, **then** reconnect explicitly (Socket.IO does not auto-reconnect after a server-side disconnect). |
| `auth-revoked` | `session:revoked { reason: 'school_deactivated' \| 'user_deactivated' }` | Permanent: stop retrying and stop tracking. |
| `network` | `transport close` / `transport error` / `ping timeout` | Bounded backoff. |
| `unknown` | anything else | Treated like `network`, still bounded. |

Backoff budget (`TRACKING_RECOVERY_POLICY`): `1 s → 2 s → 4 s → 8 s → 16 s → 20 s`,
`maxAttempts = 6` (~51 s of trying), then the connection state becomes
`gave-up` — a real state the UI shows, not a hidden infinite loop. A new fix, a
trip start, an explicit user Retry, or the next headless execution resets the
budget. Only one recovery pass is scheduled or in flight at a time: three
undeliverable fixes never start three retry loops.

After a reconnect the controller re-joins the authorized trip room and then
re-sends the held fix.

### The held fix (bounded, latest-only)

`pending-fix.ts` keeps **one** fix, never a queue:

- `PENDING_FIX_MAX_AGE_MS = 90 s` — older than that it is discarded and counted
  (`expiredCount`), because a two-minute-old position must never be replayed as
  a live one.
- `PENDING_FIX_MAX_ATTEMPTS = 3` per fix.
- `PENDING_FIX_FUTURE_TOLERANCE_MS = 60 s` — a device clock that is slightly
  ahead is tolerated; a fix stamped far in the future is invalid.
- A newer fix **replaces** the held one (counted as superseded); a fix from a
  different trip is dropped on trip switch.
- The retry reuses the **same idempotency key** and the **original
  `recorded_at`** — the server de-duplicates a redelivery, and the live map never
  re-stamps an old position as "now".

Counters surfaced in the crew UI (`GpsShareStrip` / `GpsSharePanel`): emitted
(server-acknowledged), disconnected (held), retried, superseded, expired,
invalid, throttled, rejected. They are patched as **monotonic deltas**, so a
number can never go down mid-trip.

**Explicitly out of scope:** offline GPS history. There is no track buffer and no
replay of a lost window — by design, because replaying stale coordinates as live
is worse than an honest gap. The gap is visible: the status goes `stale` and the
counters show what was discarded. (Offline **attendance** remains queued and
synced by the pre-existing offline subsystem.)

## 3. Lifecycle and honest status

One watcher for the whole app: `startCrewTracking()` is idempotent, so Trip,
Help and a re-mount of either create exactly one `watchPositionAsync`
subscription (`WATCH_INTERVAL_MS = 4 s`, `WATCH_DISTANCE_METERS = 10 m`).
Cleanup happens on trip close, on stop and on logout (`endCrewTrackingSession`).

`deriveCrewTrackingStatus()` derives the headline from facts only:

| Status | Meaning | `schoolSeesLive` |
| --- | --- | :-: |
| `stopped` | Nothing running (no watcher, no background task). | ✗ |
| `services-off` | The OS location switch is off — no fix is possible. | ✗ |
| `permission-blocked` | Foreground location permission missing/denied. | ✗ |
| `revoked` | Access permanently revoked for this account/tenant. | ✗ |
| `connecting` | Running, socket still establishing. | ✗ |
| `reconnecting` | Running, socket lost, recovery inside its budget. | ✗ |
| `waiting-for-fix` | Connected and permitted, no device fix yet. | ✗ |
| `local-only` | **The device has a fresh fix the server never acknowledged** — GPS works, delivery does not. | ✗ |
| `live` | The server acknowledged a fix inside the live window. | ✓ |
| `stale` | Something was acknowledged before, nothing recent. | ✗ |

Windows: `SERVER_ACK_LIVE_WINDOW_MS = 30 s`, `SERVER_ACK_STALE_WINDOW_MS = 120 s`,
`LOCAL_FIX_FRESH_WINDOW_MS = 30 s`. `schoolSeesLive` is true **only** for `live`,
so no surface can claim "the school can see the bus" from local GPS alone.
Recovery state is a property of the connection, not of the headline: a socket
that dropped while the last ack is still fresh reads as `live` *and*
`recovering: true`, which is exactly what the driver needs to see.

The UI keeps the two facts on separate lines — a **device line** (the phone has
GPS, with what accuracy) and a **delivery line** (the server saw it N seconds
ago, or never) — instead of merging them into one optimistic sentence.

### `killServiceOnDestroy` — the decision and the evidence

Set to **`false`** in `foregroundServiceOptions()`.

Expo's docs describe the flag ("destroy the foreground service if the app is
killed") but recommend no value, so it was resolved from the installed
`expo-location` 57 Android source (`LocationTaskService.onTaskRemoved`:
`if (mKillService) { stop() }`):

- `true` → swiping the app away from Recents **stops** the foreground service:
  the school silently loses the bus mid-run, which is the single most common
  crew complaint.
- `false` → the service survives the swipe and keeps delivering until the trip
  ends, the crew member stops sharing, or the OS kills the process. The service
  is started with `START_REDELIVER_INTENT`, so an ordinary OS kill is followed by
  a restart.

What `false` does **not** survive: a **force-stop** (Settings → Apps → Force
stop, or "swipe away" on some OEM launchers that force-stop instead of removing
the task). After a force-stop no JS runs at all — no recovery, no restart, no
notification. Only the crew member reopening the app resumes sharing. The same is
true when an OEM battery policy kills the process under memory pressure. This is
an OS guarantee we cannot buy or code around, and the app says so rather than
promising otherwise.

Background task options: `accuracy: BestForNavigation`, `timeInterval: 4 s`,
`distanceInterval: 10 m`, `deferredUpdatesInterval: 15 s` /
`deferredUpdatesDistance: 25 m`, `pausesUpdatesAutomatically: false`,
`showsBackgroundLocationIndicator: true`. Enabling background sharing requires
the crew member's **explicit consent** *and* a granted background permission —
a foreground-only grant never turns it on.

## 4. Permissions, accuracy and battery

`gps-permission-state.ts` maps the OS response to one issue:
`none`, `permission_denied`, `permission_permanently_denied`,
`location_services_disabled`, `background_permission_denied`,
`background_permission_unavailable`, `location_accuracy_reduced`.

Behaviour fixes worth calling out:

- **The background result is checked before an issue is cleared.** The previous
  `GpsPermissionRecovery.handleRequestPermission` cleared the banner as soon as
  the *foreground* request returned, even when `requestBackgroundPermissionsAsync`
  was still denied — the UI said "fixed" while background sharing was impossible.
  `evaluatePermissionRequest()` now requires the relevant grant for the issue
  being resolved.
- **Approximate location** (`android.accuracy === 'coarse'`, iOS
  `accuracy: 'reduced'`) is reported as `location_accuracy_reduced`: sharing
  continues, and the crew member is told the fix is coarse instead of being shown
  a green "all good".
- **Services off** is distinguished from **permission denied** — the first needs
  the OS location toggle, the second needs the app's permission screen.
- **Revocation while running** and **returning from Settings** are both handled:
  an `AppState` listener re-checks on `active`, so "deny → Settings → allow →
  back" resumes without an app restart, and "allow → revoke" degrades honestly.
- **Cannot ask again** (`canAskAgain === false`) routes to the settings deep link
  instead of calling the OS prompt again (which would be a no-op dialog).
  `SETTINGS_ONLY_ISSUES` lists the issues that can only be fixed outside the app.
- Deep links: `Linking.openSettings()` for app permissions, and on Android
  `Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')`
  with `Linking.openSettings()` as the fallback.

### Battery guidance is honest by construction

`batteryGuidanceFor()` returns `detection: 'unsupported'` and `detected: null`
**always**. React Native/Expo exposes no API that reports an OEM's battery
restriction, so the app never claims to have found one and never shows a fake
"restricted" badge. What it does show is guidance ("on this device, set the app
to Unrestricted / disable battery optimisation so background sharing survives")
plus the settings action, and a copy key (`gps.battery.honesty`) that states the
app cannot verify the setting. Guidance is shown only when it can still help
(`shouldShowBatteryGuidance`), not as permanent noise.

## 5. Android Firebase wiring

`mobile/app.config.js` (a thin layer over the pinned `app.json`) now wires
**two** build-time facts and nothing else:

- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` → `android.config.googleMaps.apiKey`
  (unchanged behaviour).
- `ANDROID_GOOGLE_SERVICES_FILE` → `android.googleServicesFile`, falling back to
  `./google-services.json` when that file exists. The env var is a **build-time**
  variable, so it deliberately does *not* use the `EXPO_PUBLIC_` prefix (which
  would inline it into the JS bundle). A path that does not exist produces a
  warning and no wiring, never a crash.

Rules:

- The Android package inside `google-services.json` must equal `android.package`
  in `app.json` (`com.schoolbustracking.app`). A mismatch means FCM registers a
  token for a different application id and the API's sends never match this app.
- The **backend service account never ships in the app**. It belongs to the API's
  environment only (`FIREBASE_SERVICE_ACCOUNT_JSON`, see `docs/notifications.md`);
  nothing in `mobile/` reads it.
- `npm run verify:firebase` (`scripts/verify-firebase-config.mjs`) prints
  **facts, never contents**: existence, parse ok/failed, how many client apps the
  file declares, and the package names being compared. Exit `0` when configured
  *or* merely missing (Expo Go / JS work is unaffected — a warning is printed);
  exit `1` when misconfigured (package mismatch, unreadable file, or an Expo
  config that stops wiring `android.googleServicesFile`). It is gated into the
  native build paths: `prebuild` and `preandroid:build`.
- **Expo Go** has no native FCM token of its own. Push registration is skipped
  with a diagnostic classification (`classifyPushFailure` in `push-config.ts`)
  instead of throwing — Expo Go keeps working, and the reason is reported rather
  than surfacing as a red screen or a silent no-op.
- `POST_NOTIFICATIONS` is **not** added to `app.json`: the `expo-notifications`
  config plugin already declares it, and duplicating it changes nothing.

### Free local Android build (no paid cloud service)

A native Android build is produced with the SDK already installed on the
developer machine — no EAS build, no billing account, no cloud queue:

```bash
# one-time: JDK 17 + Android SDK (Android Studio → SDK Manager), and
# ANDROID_HOME / adb on PATH. Then, from mobile/:
cd mobile
npm ci
npm run verify:firebase        # facts-only wiring check
npm run android:build          # = expo run:android (preandroid:build runs the checks)
```

`expo run:android` runs Gradle locally and installs the debug APK on a connected
device/emulator. For a release APK/AAB use the local Gradle tasks in
`android/` after `npx expo prebuild` (also gated). Note that
`npx expo export` produces a **JS bundle**, not an installable APK, and a local
build does not prove real FCM delivery — that additionally requires the
`google-services.json` for this exact package plus the API holding a valid
service account.

## 6. Foreground socket + push presentation de-duplication

A single event can reach the app twice: once over the tracking/notification
socket and once as an FCM push. In the **foreground** both paths can present a
banner, so the parent sees the same arrival twice.

`presentation-dedup.ts` coordinates this with a **claim** on a stable
notification id:

- The first presenter (socket-first or push-first) claims the id and presents;
  the second caller sees the claim and stays quiet.
- Claims are scoped to the **account/tenant**: `setPresentationAccount()` is
  called on push setup and on unregister, and `NotificationsProvider` receives
  `account={{ userId, schoolId }}` from the root layout. An account change
  invalidates previous claims, so a signed-out user's claim can never suppress
  the next user's notification.
- Retention is bounded: `PRESENTATION_DEDUP_CAPACITY = 200` entries with
  `PRESENTATION_DEDUP_TTL_MS = 10 min` — no unbounded growth in a long-lived
  process.
- Distinct events are never suppressed: the key is the notification's own stable
  id, not the event type, so two arrivals for two different trips both present.
- Inbox, unread counts and tap-navigation are untouched — de-duplication only
  decides **who presents the banner**, never whether the event is recorded.
- **Background** push is unaffected: the OS presents it (the app is not running
  JS), which is exactly the required behaviour.

## 7. Testing

```bash
cd mobile
npm test                 # 681 unit tests (pure modules, guards, i18n parity, Firebase checker)
npm run test:sim         # 4 simulations, 50 scenarios (offline, push, feedback, tracking)
npm run test:tracking-sim  # the tracking simulation alone (26 scenarios)
npm run typecheck && (cd .. && npx eslint .)
```

These are **Node-level simulations with test doubles** (AsyncStorage,
expo-location, the socket, the API client) — they are *not* device tests and do
not prove behaviour on a real phone. They do prove the decision logic end to end,
including the ordering and cancellation rules that a unit test on a pure function
cannot reach. Coverage includes: headless start with an empty token; concurrent
refreshes sharing one attempt; no session → nothing sent; another user's or
another tenant's context dropped; completed/cancelled trip not resumed; logout
mid-recovery; trip ownership and trip switch; held-fix retry with the same
idempotency key and original timestamp; expired held fix discarded and counted;
expired-auth disconnect → refresh → explicit reconnect; permanent revocation and
permanent server rejection stopping instead of retrying; one watcher for two
screens; status from the server ack rather than the local fix; permission
scenarios; Firebase configuration diagnostics; and socket/push presentation
de-duplication across an account change.

The simulation shrinks the bounded waits through
`__setTrackingTimeoutsForTests()` (a test-only seam) so a scenario takes
milliseconds instead of ~51 s. Production never calls it.

## Limitations (stated plainly)

- **Force-stop ends everything.** No JS runs, so nothing can recover until the
  crew member opens the app again. No app can bypass this, and we do not claim to.
- **OEM battery policies** (Xiaomi/MIUI, Samsung, Oppo, Vivo, Huawei) can kill or
  restrict a foreground service. We cannot detect that from JS
  (`detection: 'unsupported'`), only guide the user to the settings screen.
- **iOS** background execution depends on the `location` background mode staying
  active; there is no Android-style foreground service, and no Apple membership
  or signing workaround is implied anywhere in this patch.
- **No offline GPS history.** At most one fix is held, for at most 90 s and 3
  attempts. A long tunnel produces a visible gap, not a fabricated track.
- **Simulations ≠ devices.** Everything above is verified in Node with doubles;
  the device checklist below is the human half of the verification.

## Device checklist (per crew phone, one time)

1. Install the **native build** (not Expo Go) made with the correct
   `google-services.json`; confirm `npm run verify:firebase` printed ✓ for that
   package.
2. Location **services on**, app permission **Allow all the time** (Android 10+)
   / **Always** (iOS). If only "While using the app" is granted, background
   sharing will not start — the app says so instead of pretending.
3. Android: **Precise location** on (not approximate). iOS: **Precise Location**
   on; a reduced-accuracy grant is reported as coarse, not as working.
4. Android: Battery → app → **Unrestricted**, and disable "battery optimisation"
   for the app (the in-app action opens that exact screen).
5. Android: **Allow** the foreground-service notification — do not swipe it away.
   The notification text is localised and states only that GPS is being shared.
6. Android 13+: notifications permission granted (needed for the service
   notification and for push banners).
7. OEM autostart/"manage manually" toggles (Xiaomi, Oppo, Vivo, Samsung):
   enable autostart and lock the app in Recents so a swipe does not force-stop it.
8. Start a trip, then verify on the school console: the bus position updates and
   the crew app shows `live` with a server-ack age, not merely a local fix.
9. Swipe the app away from Recents mid-trip → sharing must continue
   (`killServiceOnDestroy: false`).
10. Turn on aeroplane mode for ~20 s, then off → status must go `reconnecting`
    and return to `live` without a restart; the held fix (if younger than 90 s)
    is re-sent once, with its original timestamp.
11. Log out mid-trip → sharing stops, the persisted context is cleared, and a
    different driver signing in on the same phone never resumes the first
    driver's trip.
12. Push: send one arrival notification and confirm the parent sees **one**
    banner (not one from the socket plus one from FCM) and that the inbox entry
    and unread count are still correct.

## Diagnostics quick reference

- Connection state: `idle` / `connecting` / `connected` / `reconnecting` /
  `gave-up` / `revoked`.
- `lastStopReason` (diagnostics only, never shown as prose): `user`,
  `trip-closed`, `trip-not-eligible`, `headless-not-eligible`, `revoked`,
  `rejected-permanent`, `account-changed`, `session-ended`.
- Recovery: `attempts`, `exhausted`, `inFlight`, `lastReason`,
  `lastDisconnectClass`.
- Stats: emitted, disconnected, retried, superseded, expired, invalid, throttled,
  rejected, `lastFix` (device fact) and `lastAckAt` (server fact).
- `npm run verify:firebase` for the Android push wiring; the same checks run
  automatically before `prebuild` / `android:build`.
