# Mobile Operations

## Overview

This document describes mobile-specific operational features for drivers, conductors, and admins.

## Mobile vs Web Scope

| Capability                                                                                                  | Mobile | Web |
| ----------------------------------------------------------------------------------------------------------- | :----: | :-: |
| Crew trip lifecycle, manifest board/drop, GPS sharing                                                       |   ✅   | ✅  |
| Parent live tracking, ETA, notifications                                                                    |   ✅   | ✅  |
| School-admin dashboard, trips, live tracking, attendance, emergencies                                       |   ✅   | ✅  |
| School-admin CRUD: students, buses, routes & stops, drivers & conductors, guardians, assignments, documents |   ✅   | ✅  |
| Bulk Excel import / export and import-job history                                                           |   ❌   | ✅  |
| Reports                                                                                                     |   ❌   | ✅  |
| `SUPER_ADMIN` platform console                                                                              |   ❌   | ✅  |

Mobile admin CRUD lives under the `(admin)/manage` route group and calls the same
API endpoints and shared Zod schemas as the web console. Bulk import/export and
reporting are deliberately web-only back-office workflows
(see `docs/import-export-reports.md`).

## Offline Attendance

### Problem

When a driver/conductor loses internet during a trip, boarding/drop operations must not silently disappear.

### Solution

A durable local queue stores attendance events when offline:

- Each queued operation has: local event ID, idempotency key, captured timestamp, student ID, trip ID, event type
- States: pending → syncing → success/failed
- When network returns: retry with exponential backoff
- 409 conflicts (already boarded/dropped) treated as success
- Queue persists across app restarts

### Important

Attendance and GPS are different systems. The offline queue only handles attendance events, never replays GPS data.

## Background GPS

### Location Task

- Uses expo-location for foreground/background location tracking
- Fixes are validated client-side with the same Zod schema as the API
- Fixes are never queued or replayed (honesty about network state)
- Active trip ID persisted for headless background task

### GPS States

- **GPS sharing active**: Location is being sent to server
- **GPS permission missing**: User needs to grant permission
- **Location services disabled**: Device location is off
- **Network disconnected**: No internet connection
- **Socket disconnected**: WebSocket not connected
- **Last successful location time**: When the server last received a fix

#### Where each state is visible (Phase 2)

The crew trip screen deliberately shows only three things while driving —
`Sharing ✅ / ❌`, the last-update time, and one **Retry** tap
(`GpsShareStrip`). The **diagnostic counters moved to the Help/Support screen
(`app/(crew)/help.tsx`) — moved, not deleted**: "Sent", "Rejected",
"Dropped (offline)", "Invalid fix", the last fix accuracy/age and the server's
last reason render there in the full `GpsSharePanel`, framed for the support
team (`src/features/crew/help-routing.spec.ts` guards the move in CI). The
underlying stats pipeline (`location-task.ts` counters) is unchanged — the
Help screen simply renders what the driver no longer has to.

### GPS Permission Recovery

Handles:

- Permission denied (can request again)
- Permission permanently denied (must go to settings)
- Location services disabled (must go to settings)
- Background permission unavailable
- Battery optimization issues

Provides:

- Clear explanation
- Retry/recheck button
- Settings link where supported
- Current GPS status
- Last successful update time

## Session / Network UX

### Handled Scenarios

- Expired access token → automatic **silent** refresh attempt in the
  background (single-flight; concurrent screens share one refresh)
- Refresh failure → clear local session state → redirect to login
- Logout → clear local state (access token, sockets, GPS sharing, push
  registration) + server-side refresh-token revocation
- Network unavailable → show offline indicator
- Reconnect → resume operations
- 401 → session expired message
- 403 → access denied message (the server's own reason is shown)
- 409 → conflict message (already boarded/dropped)
- 429 → rate limited message
- 500 → server error message

### Progress Indication Contract

Token refresh is **always silent** — it never renders UI. Two separate
progress signals exist deliberately:

| Signal       | Drives                                        | When it is true                          |
| ------------ | --------------------------------------------- | ---------------------------------------- |
| `loading`    | `LoadingView` / skeleton (`loading && !data`) | Initial load & dependency-driven reloads |
| `refreshing` | The pull-to-refresh spinner only              | User-initiated pull (`refresh()`)        |

Background work (stale-while-revalidate cache fetches, socket-triggered
reloads, retries after a token refresh) must **never** surface a visible
"refreshing" indicator on top of working screens.

### 403 Diagnosis (Server Taxonomy)

The API only ever issues four 403s; all are intentional security
enforcements, and the app must show the server's own message — never mask a
403 as success:

| Server message                  | Source                                           | Mobile client behavior                                 |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `Insufficient role permissions` | Roles guard                                      | Show message (verify the account's role & screen)      |
| `User account is inactive`      | JWT guard / auth service                         | Session ends → login (reactivation required)           |
| `School is inactive`            | JWT guard / auth service (incl. `/auth/refresh`) | Session ends → login (school must be re-enabled)       |
| `Request origin is not allowed` | CSRF guard                                       | Never reachable from the app — native requests send no |
|                                 |                                                  | `Origin` header; this only fires for browser-origin    |
|                                 |                                                  | requests not in `CORS_ORIGIN`                          |

Role consistency is verified: each screen only mounts endpoints its role is
granted (see the role-gated route groups), so a healthy session cannot 403.

### School-admin surfaces (Phase 3)

- **Reports** — a dedicated tab: the landing screen shows the live overview
  figures plus the catalogue grouped by category; each report opens with a
  filter sheet (only the inputs the report declares), summary cards and a
  paginated result view rendered as per-row cards. Spreadsheet export stays
  on the web console (it sends the identical query); the app is for reading.
- **Shifts** — `Manage → Shifts`: full CRUD of the bell windows, with
  server-side active/inactive filtering; the 409 refusal while runs are
  attached surfaces verbatim.
- **Runs & run crew** — `Manage → Routes → <route> → Runs`: run CRUD for the
  route (code, shift window, bus, active flag; bus-window overlap is only
  pre-warned — the API owns the verdict) and the per-run crew roster
  (add/edit/remove with role-scoped person pickers).
- **Student run allocation** — the student form offers the runs of the
  chosen home stop's route and clears a stale run when the stop moves to
  another route, matching the web console.

### Critical Attendance Actions

For Driver/Conductor, attendance actions survive temporary network errors:

- Queued locally when offline
- Synced when network returns
- User sees sync state (pending count)
- Never silently lost

## Language, Voice & Vibration Settings

Support-facing notes for the localisation layer (Phase 3a) and the voice +
haptics feedback layer (Phase 3b). Full design map: `docs/mobile-ux.md` →
"Phase 3 — localisation & voice" and → "Phase 3b — voice + haptics".

### Language

- **Two languages**: English (source of truth) and Hindi. Nothing else is
  offered, so "the app is in a language I don't have" is not a possible state.
- **Where the switch is**: crew app → **Help & support** (reached from the
  trip screen) → _Language_ / _भाषा_ → tap **English** or **हिन्दी**. Each
  option names itself in its own script, so a crew member who cannot read
  English can still find हिन्दी while the app is showing English.
- **It applies instantly** — no restart, no re-login, nothing is lost on
  screen. If someone reports "I changed it and nothing happened", the app is
  on a build without Phase 3, not misconfigured.
- **It persists** in AsyncStorage under `sbt.mobile.locale`. Clearing app data
  (or a reinstall) resets it to the default.
- **Default**: `DRIVER`/`CONDUCTOR` → **Hindi**, even on an English-locale
  phone. `SCHOOL_ADMIN`/`PARENT` → the device language. This is deliberate: the
  crew app is built for the person who cannot read English, and the switch is
  the escape hatch.
- **Deliberately still English**, and not a bug to file:
  - student names, route/bus codes, stop names, school names — that is data;
  - API error messages, emergency type/status labels, document type labels —
    the server sends English and Phase 3 is client-side only;
  - the four GPS counters on the Help screen ("Sent", "Rejected",
    "Dropped (offline)", "Invalid fix") — they are read aloud to the support
    engineer, who works in English;
  - an **unknown** server error code shows the server's message plus a
    `Server code XYZ` line. Ask the caller to read that code back — it is the
    exact identifier the API returned.

### Voice feedback (Phase 3b)

Spoken confirmations use the device's own text-to-speech engine (`expo-speech`) —
nothing is downloaded, no audio file ships with the app, and no permission is
involved. Full design: `docs/mobile-ux.md` → "Phase 3b — voice + haptics".

**"Voice nahi aa rahi" — work through these three, in this order.**

1. **The switch is off.** Crew app → **Help & support** → _Sound & vibration_ /
   _आवाज़ और वाइब्रेशन_ → is **Speak actions aloud** / _Action बोलकर बताएँ_ on?
   Ask them to tap **Test sound & vibration** / _आवाज़ और वाइब्रेशन जाँचें_:
   that row exercises exactly what is enabled, so it is the fastest answer. If
   the test says nothing, the toggle is the whole story — not a bug.
   Defaults, for reference: `DRIVER`/`CONDUCTOR` **on**, `SCHOOL_ADMIN`/`PARENT`
   **off** (deliberate — office screens should not announce boardings). A
   parent or admin reporting "no voice" is usually working as designed.
   The choice persists in AsyncStorage under `sbt.mobile.feedback`; clearing app
   data or reinstalling resets it to the role default.
2. **The device has no TTS engine at all.** Android: _Settings → Accessibility →
   Text-to-speech output_ (on some skins, _Settings → General management →
   Language & input → Text-to-speech_). If that screen is missing or empty, or
   the "Listen to an example" button is silent, the handset has no engine
   installed — common on the cheapest devices and on some AOSP-lite builds. The
   fix is to install a TTS engine (Google Speech Services) from the Play Store.
   **The app never fails because of this**: a missing engine is caught and
   swallowed, the action still records, and vibration keeps working.
3. **No Hindi voice is installed** — and this one is _already handled_, so it
   should not be reported as a fault. The spoken copy is deliberately
   **Latin-script Hinglish** (`voice.*` keys), not Devanagari, precisely so a
   device with only an English voice still pronounces it intelligibly. If a
   caller reports the voice sounds "English-ish" or has a foreign accent, that is
   the device's default engine reading Hinglish — expected, and still
   understandable. If instead they report **garbled noise**, they are on a build
   from before Phase 3b (when the copy was still Devanagari); updating the app
   fixes it.

Also worth ruling out before any of the above: the phone is on **silent/vibrate**,
media volume is at zero (TTS uses the media stream, not the ring stream), or a
Bluetooth headset has taken the audio route.

### Vibration feedback (Phase 3b)

**"Vibration nahi aa rahi"** — check in this order:

1. **The switch is off**: Help & support → _Sound & vibration_ → **Vibration** /
   _वाइब्रेशन_. The **Test** row buzzes once if it is on. When vibration is
   switched off the app makes **zero** native haptics calls — proven by a spec,
   so "off" can never be a partial state.
2. **The phone has no motor, or haptics are disabled system-wide.** Budget
   handsets sometimes ship without a vibration motor; others have
   _Settings → Sound & vibration → Touch vibration_ / _Haptic feedback_ turned
   off, which suppresses the OS haptic APIs the app uses. Test with any other app
   that buzzes on tap (the dialler keypad is the usual check).
3. **Battery saver / power-saving mode.** Several OEM skins disable haptics while
   a saver profile is active.

`android.permission.VIBRATE` is declared by the `expo-haptics` library manifest
and merged into the app at build time; it is an install-time permission, so
**there is no prompt and nothing for the user to grant**. If someone reports
being asked for a vibration permission, they are not on this build.

Like voice, vibration is fire-and-forget: a device that cannot buzz never fails
an action and never blocks one.

## List / Search / Pagination

All major management screens support:

- Server-side search
- Debouncing (300ms)
- Pagination (page-based)
- Pull-to-refresh
- Loading state
- Empty state
- Error state with retry
- FlatList/virtualization
- Stable keys
- No unnecessary full-list rerender

## Build Configuration

### API base URL (`EXPO_PUBLIC_API_URL`)

- **Development**: optional. The base URL is derived from the Metro
  dev-server host (physical devices on the same WiFi), `10.0.2.2` on the
  Android emulator, and `localhost` on the iOS simulator/web. The port can
  be overridden with `EXPO_PUBLIC_API_PORT` (default 3001).
- **Standalone builds (EAS preview/production)**: **mandatory** — a release
  build without it surfaces a configuration error on the sign-in screen
  instead of silently targeting localhost. The value must include the
  `/api/v1` prefix and must be reachable from the device. Against an API
  running with `NODE_ENV=production` it must be `https://…` (the production
  refresh cookie is `Secure; SameSite=None`).

### Google Maps (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`)

Read by `app.config.js` and injected into `android.config.googleMaps.apiKey`
at prebuild/build time. Required for standalone Android builds that show the
live map; omit for Expo Go. Restrict the key in Google Cloud to "Maps SDK
for Android" + this package name + the signing-certificate SHA-1.

Both variables can be set via a local `.env`, the shell environment, or the
`env` block of an `eas.json` build profile. See `mobile/.env.example`.

### EAS profiles

`eas.json` already defines the three profiles used for testing:
`development` (dev-client APK), `preview` (internal APK) and `production`
(AAB, `autoIncrement`). The project id, owner and Android package are pinned
in `app.json`.
