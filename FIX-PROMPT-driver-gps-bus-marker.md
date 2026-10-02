# FIX PROMPT (paste into a new session) — Driver GPS / bus-on-map / "I'm at this stop" button

## Context (repo: aaqibjavedcoding/school-bus-tracking, monorepo)

- `mobile/` — Expo React Native app. Driver/conductor screens: `mobile/app/(crew)/trip.tsx`, crew feature code in `mobile/src/features/crew/`.
- `web/` — Next.js admin/parent console + the API server (`web/src/server/`). Live tracking: `web/src/server/modules/live-tracking/`, maps in `web/src/features/map/`.
- The **one** GPS pipeline: driver phone → `tracking-lifecycle.ts` (one watcher, one socket) → `trip:location:update` (socket) → server stores + broadcasts to the trip room → every other screen (conductor `BusMap`, parent mobile map, admin/parent web `TripTracker`) renders the bus from that room + a REST latest-fix snapshot.

## Field report (what the driver experienced)

1. Driver logs in, taps **Start boarding** (or **Depart & drive**). Trip status changes, but GPS/location never turns on — not at the tap, not while driving. The driver is being sent elsewhere (Settings) to turn GPS on; the requirement is: tapping either of those two buttons must turn GPS on, in-app, no side trips.
2. The bus does **not** show on the map on ANY role's screen — driver, conductor, parent, admin — even after starting boarding/driving.
3. The red **"I'm at this stop — mark arrived"** hold button appears to do nothing, even when held.

## Root causes (verified in code — do not re-hunt)

### 1+2. GPS dies silently → no fixes → no bus anywhere (these two reports are ONE chain)

The tap-to-GPS wiring already existed (`trip.tsx → onTransitionApplied → startSharing → startCrewTracking`, with an in-app `requestForegroundPermissionsAsync()` before giving up). What actually breaks the chain:

- **(a) RESTART KILLS GPS FOREVER (the main bug).** A foreground `watchPositionAsync` dies with the process (OS kill, battery optimiser, crash, force-close, `hydrate`-only reopen). `hydrateCrewTracking()` in `mobile/src/features/crew/tracking-lifecycle.ts` restored the persisted context **as data only** and never restarted the watch (its doc literally said "It never starts delivery"). After any restart of a BOARDING/IN_PROGRESS run: strip says "Share GPS", zero fixes flow, and the bus is missing from **every** map — driver map (draws only this device's fix), conductor/parent/admin maps (draw only server fixes). Only a manual strip tap revived it.
- **(b) Refused starts were invisible at the tap.** `startSharing()` returned `void`; a start refused for location-services-off / permission-refused set a small message on the GPS strip only. The driver saw the green "boarding" state and drove with the bus invisible.
- **(c) Screen-locked driving.** With the OS background task not enabled, the OS suspends the foreground watch when the phone locks — i.e. exactly while driving. Enabling the background task was a separate, discoverability-poor consent flow on the Help screen.
- **(d) Concurrent starts could duplicate the native watcher.** `startCrewTracking()` has `await` points before adopting the watcher, so two interleaved starts could both see `watch === null` and create two watchers (one unstoppable). Also a start in flight across a stop/logout re-persisted the cleared context.
- **Why the settings trips happened:** `gps-strip-action.ts` offers `open-settings` only when the OS itself can no longer be asked (`canAskAgain === false`) or location services are off — an OS limit, not an app choice. The in-app permission request path (`request-permission`) already exists for askable denials.

### 3. "I'm at this stop — mark arrived" (hold 900 ms) — what it is and why it looked dead

- **What it means:** it is the manual escape hatch for when the GPS geofence did not record the stop (weak signal, bus parked across the road, permission killed by a battery optimiser). A completed hold sends `POST /trips/:tripId/stops/:stopId/arrive` (offline-queued, idempotent) — the stop is recorded as served, the run advances to the next stop, parents get the same notification a geofence arrival produces, and the manifest for that stop becomes the work list. It is hold-to-confirm (not tap) so a pocket touch cannot record a stop; screen-reader activation fires immediately.
- **Why it "did nothing":** on the trip screen the hook behind it (`useCrewStopMark`) had its `note`/`error` **never rendered and no toast wired** — success spoke only through Voice (which can be off) and a failure (server 409/404/403, e.g. marking while the trip is still `SCHEDULED` — the server only accepts marks on `BOARDING`/`IN_PROGRESS`) showed **nothing at all**. The hold worked; the result was swallowed.

## Already fixed on this branch (`arena/01a0fb11-school-bus-tracking`) — verify, don't redo

1. `mobile/src/features/crew/tracking-lifecycle.ts`
   - `hydrateCrewTracking()` now **restarts the foreground watch** when a fresh, owned, persisted context is restored and the OS background task is not running (consent evidence = the context, which only a successful start writes, a deliberate stop clears, and restore ownership/freshness-checks; server eligibility re-check still stops it for a closed trip).
   - `startCrewTracking()` is now a **serialized queue** (one start path at a time → one watcher, ever); a start queued behind a stop/logout is dropped (newest decision wins), and in-flight starts no longer re-persist a context a stop just cleared (epoch re-checks after the permission reads and after the OS permission dialog).
2. `mobile/src/features/crew/useCrewLocationSharing.ts` — `startSharing()` now returns `{ ok, message }` so callers can react.
3. `mobile/app/(crew)/trip.tsx`
   - A refused GPS start on **Start boarding / Depart & drive** now **toasts the lifecycle's reason immediately** (e.g. "Location permission is required…") — the fix is decided at the tap; Settings is only ever suggested when the OS can no longer be asked.
   - On a confirmed **Depart & drive**, if the OS background-location permission is **already granted**, the background task is enabled automatically (no prompt, no settings trip) so tracking survives the locked screen; otherwise the foreground watch continues as before.
   - The hold button now **toasts** the receipt/queued note and shows the failure as a line under the card; both mark surfaces (hold button + Arrived/Skip card) are hidden unless the trip is open (`BOARDING`/`IN_PROGRESS`), which is exactly what the server accepts.
4. `mobile/src/features/crew/useCrewStopMark.ts` — the offline-queued path also reports via `onNote` (was note-only, invisible on the quick button).
5. New spec `mobile/src/features/crew/tracking-resume.sim.spec.ts` (8 scenarios) pins: restart resumes an owned fresh context; no context / deliberate stop / foreign account / expired context never resume; queued-start-dropped-behind-stop; concurrent starts = one watcher; resumed run stops when the server says the trip closed.
6. Two pre-existing/failing wiring specs corrected to their intent: `crew-map-access.spec.ts` (gate regex accepts the guarded async block) and `trip-progress.spec.ts` (frontier-specific ref ban instead of a blanket `.current =` ban that had been red on main since the arrival-navigation refs landed).

## How to test FAST (do NOT run the root `npm test` — that chains build + 150+ web/server specs and is where your 40–60 minutes went)

Measured on this machine after `npm install`:

```bash
# from repo root, once, if node_modules is missing:
npm install --no-audit --no-fund          # ~45 s

# Driver GPS lifecycle (the two sims, 45 tests):              ~4 s
cd mobile && npm run test:tracking-sim

# Whole mobile fast suite (1555 tests):                       ~20 s
cd mobile && npm test

# Only the crew specs touched by driver work (~250 tests):     ~3 s
cd mobile && node --experimental-strip-types --test --test-timeout=60000 \
  src/features/crew/tracking-status.spec.ts src/features/crew/gps-strip-action.spec.ts \
  src/features/crew/gps-permission-state.spec.ts src/features/crew/tracking-context.spec.ts \
  src/features/crew/crew-map-access.spec.ts src/features/crew/trip-progress.spec.ts \
  src/features/crew/crew-feedback-wiring.spec.ts src/features/crew/next-stop-announcer.spec.ts

# Type + lint of the mobile app:                              ~65 s + ~10 s
cd mobile && npx tsc --noEmit && npx eslint src/features/crew app/\(crew\) --max-warnings 0
```

Web/server specs are **not affected** by these changes (no web file was touched). Only run them (`cd web && npm run test:server` / `test:web`) if you change `web/` — and then run just the module you touched, e.g. `cross-env TS_NODE_PROJECT=tsconfig.server.json node -r ts-node/register/transpile-only --test src/server/modules/live-tracking/live-tracking.service.spec.ts`.

## Manual test checklist (device, per role — ~10 minutes)

1. **Driver (dev build, NOT Expo Go — MapLibre native module needs a dev build; Expo Go shows the labelled "needs dev build" panel instead of any map).**
   - Fresh install → login → trip SCHEDULED → tap **Start boarding** → OS permission dialog appears in-app (if not already granted) → grant → GPS strip flips to Sharing ✅, driver map shows the bus marker, location icon in the status bar.
   - Refuse the permission once → tap **Depart & drive** → the strip's repair button is "Grant permission" (in-app), NOT settings; toast appears if the start fails.
   - Kill the app completely → reopen → trip still IN_PROGRESS → **GPS sharing resumes by itself** (Sharing ✅ within seconds, no manual tap).
   - Tap Stop sharing → kill & reopen → it does NOT come back by itself (deliberate stop stays stopped).
   - While IN_PROGRESS, lock the screen a few minutes with background permission previously granted → unlock → fixes kept flowing (admin map kept moving).
2. **Conductor** — trip screen shows the observer map with the live bus (driver's fixes), no GPS strip, no mark buttons.
3. **Parent (mobile + web)** — select the running trip → bus marker appears and moves; ETA/next-stop updates.
4. **Admin (web `/tracking`)** — select the trip → bus visible; works during BOARDING and IN_PROGRESS.
5. **"I'm at this stop" hold button** — only present while trip is BOARDING/IN_PROGRESS; hold ~1 s → toast "Stop N recorded…" (or the server's error reason if it fails); run advances to the next stop; nothing records on a SCHEDULED trip (button absent).

## Acceptance criteria

1. Start boarding / Depart & drive ⇒ GPS sharing starts on the driver's phone with no separate settings trip (in-app permission dialog at most).
2. App restart (or process kill) during a live run ⇒ sharing auto-resumes; deliberate stop or logout ⇒ it does not.
3. Bus visible on driver, conductor, parent (app + web) and admin (web) maps while fixes flow; stale markers only style differently, never vanish silently.
4. The hold button always answers: success toast with stop number + kids count, queued note offline, or the server's refusal reason on screen.
5. `npm run test:tracking-sim` and `npm --prefix mobile test` fully green.

## Notes / known limits (do not "fix" these)

- An app can never switch the OS location toggle or bypass a permanently-denied permission — Android/iOS only allow opening Settings for those two cases. The in-app request path covers everything else.
- Background tracking (screen locked) still requires the OS background-location permission, asked once — the app now only auto-enables the task when that grant already exists.
- Expo Go cannot render the MapLibre map (native module) — use a development build for map testing; Expo Go is fine for GPS logic itself.
