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
`Sharing ✅ / ❌`, the last-update time, and one tap (`GpsShareStrip`). The tap
says what it does (`gps-strip-action.ts`, spec-pinned): **Share GPS** when
nothing is running yet, **Retry** when the last run failed (permanent rejection,
revoked session, refused permission), **Stop** while running — plus a Retry
beside Stop when the bounded reconnect budget has given up (`gave-up`).

**Sharing starts from the driver's own lifecycle tap.** A server-confirmed
"Start boarding" / "Depart & drive" on the trip screen starts GPS sharing for
that trip at once (the OS permission prompt appears there when needed), so a
trip that was started is never invisible to parents and the school by
default. The offline-queued path (no server confirmation), the conductor's
taps and a permission granted on the Help screen never start sharing.

The **diagnostic counters moved to the Help/Support screen
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

### Error Message Boundary (every screen)

**No technical text is ever rendered.** The API client's own message
(`Request failed with status 401`, plus a slice of the raw body for a non-JSON
response) is a _diagnostic_: it belongs in logs, not on a driver's screen. The
same rule covers a proxy's HTML page, a Nest default body
(`{"statusCode":500,"message":"Internal server error"}`), a bare HTTP reason
phrase (`Forbidden`), an axios/fetch `Network Error`, a stack trace, a request
id and a database error.

One module owns the classification — `mobile/src/lib/error-messages.ts` (pure,
dependency-free) — with three consumers:

| Consumer                               | Used by                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `lib/errors.ts` → `getApiErrorMessage` | every screen, hook and toast (login, admin, parent, crew)   |
| `lib/i18n.ts` → `localizeApiError`     | crew surfaces, which read the copy in en / hi / mr          |
| `features/crew/offline/queue-core.ts`  | the offline banner's `lastError` (persisted, then rendered) |

Precedence for a thrown error:

1. the API envelope's message (`error.message` / `error.details`) — **kept
   verbatim** when it is something a person can act on, because the server owns
   the business rule ("A student with this admission number already exists.",
   "Run overlaps the 07:10 window", the four 403 reasons, a plan limit);
2. otherwise the status-based copy: 400 _check the information_, 401 _invalid
   email or password_ on a credential form / _session expired_ elsewhere, 403
   _no permission_, 404 _not found_, 409 _conflicts with the current data_,
   422 _check the entered information_, 429 _too many attempts_, 5xx
   _something went wrong, try again later_, no network _check your connection_;
3. otherwise the screen's own fallback sentence (also sanitised).

Server-side **field** validation messages (`error.details` on a 422) keep their
specific text; a field whose message is a diagnostic is dropped so it can
never render under an input.

The guard rails: `src/lib/error-messages.spec.ts` pins the mapping and the
classification, and it also scans the display tree (`app/`, `src/components/`,
`src/features/`) plus all three dictionaries for hardcoded status codes or the
client's diagnostic prefix — so the rule cannot be reintroduced by the next
screen.

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

## Language & Voice Settings

Support-facing notes for the localisation layer (Phase 3). Full design map:
`docs/mobile-ux.md` → "Phase 3 — localisation & voice".

### Language

- **Three languages (batch 1 of the regional rollout)**: English (source of
  truth), Hindi and Marathi. More regional languages are additive — each is a
  typed dictionary plus one row in `SUPPORTED_LOCALES`, nothing else.
- **Where the switch is**: **login screen** (a row of self-naming pills above
  the sign-in card) _and_ crew app → **Help & support** (reached from the
  trip screen) → _Language_ / _भाषा_ / _भाषा_ → tap **English**, **हिन्दी**
  or **मराठी**. Each option names itself in its own script, so a crew member
  who cannot read English can still find मराठी while the app is showing
  English.
- **It applies instantly** — no restart, no re-login, nothing is lost on
  screen. If someone reports "I changed it and nothing happened", the app is
  on a build without Phase 3, not misconfigured.
- **It persists** in AsyncStorage under `sbt.mobile.locale`. Clearing app data
  (or a reinstall) resets it to the default.
- **Default**: everyone → **English** (owner decision, 2026-09 — including
  crew, who used to default to Hindi). `SCHOOL_ADMIN`/`PARENT` follow the
  device language (a Marathi-locale parent gets Marathi). The saved choice
  always beats the default, and the switch is one tap away on the login
  screen and on the Help screen.
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

### Voice

Shipped in Phase 3b. The crew app speaks a short confirmation — first name,
what happened, and the time ("_Ramesh ka boarding ho gaya, 7:42 subah_") — and
buzzes, so a driver holding a phone at arm's length in a noisy bus does not
have to read the screen to know the tap registered.

**Where the switches are**: Help & support → **Sound & vibration**, right under
the language switch. Two independent switches, **Voice** and **Vibration**.
They are separate on purpose — a phone with no speech engine still buzzes
correctly, and a driver in a quiet zone may want the buzz without the talking.
Each choice is saved on the device (`sbt.mobile.sound`) and survives a restart.
Defaults: `DRIVER`/`CONDUCTOR` get **both on**; `SCHOOL_ADMIN`/`PARENT` get
**voice off, vibration on** — an office phone should not start talking.

**"It doesn't speak."** Work down this list:

1. **Voice switch off** — Help → Sound & vibration → Voice. The most common
   cause by a distance, because it is one tap to turn off by accident.
2. **No TTS engine on the device** — `expo-speech` drives the phone's own
   engine and installs nothing. Budget Androids are sometimes shipped with
   Google Text-to-Speech removed. Check **Settings → Accessibility →
   Text-to-speech output** and press _Play_; if the phone is silent there, it
   will be silent in the app. Installing "Speech Recognition & Synthesis" from
   the Play Store fixes it. The card on the Help screen says as much in the
   app's own words.
3. **Phone is on silent / media volume at zero** — TTS plays on the media
   stream. Silent mode and a muted media slider both mute it.
4. **The action did not actually succeed.** The app only speaks what the
   server accepted — a board that failed is a buzz and a red line, never a
   spoken confirmation. If there is no voice _and_ no confirmation on screen,
   this is a sync problem, not a voice problem: go to the offline-queue
   section above.

**"It speaks Hinglish, not Hindi."** Working as designed, not a bug to file.
The Hindi voice lines are written in **Latin script** ("_Ramesh ka boarding ho
gaya_") because many budget Androids in service have an English TTS voice and
no `hi-IN` one; Devanagari text sent to an English voice is read as gibberish
or skipped entirely. Latin-script Hinglish read by the English voice is
understood by Hindi-speaking crew. The **screen** stays in proper Devanagari —
the two channels are deliberately different. Marathi follows the same design:
screen in Devanagari (Marathi), voice in **Latin-script Marathi**
("_Ramesh bas madhe aaun gele_") read by the `en-IN` voice, because an
`mr-IN` voice pack is even less commonly installed than `hi-IN`.

**"It talks too much."** It should not: rapid taps collapse. Boarding forty
students back to back produces **three** announcements, not forty — the first
name, then running counts ("_24 bachche chadh gaye_"). Announcements never
queue up, so the voice can never fall behind the screen and start naming a
student tapped half a minute ago. If a phone really is announcing every single
row, that is a bug worth reporting with the device model.

**"It doesn't vibrate."** Check the Vibration switch first, then the phone's
own haptics setting (Settings → Sound & vibration → **Vibration & haptics**,
sometimes "Touch vibration"), which overrides the app. A few very low-end
devices have no haptic motor at all — those never buzz, and the app carries on
silently rather than failing. SOS is worth knowing in detail: a **short tick**
the moment the finger lands on the hold button, and a **distinct double-buzz**
when the alert is actually delivered. If you feel the tick but never the
second pattern, the alert did not leave the phone — check the SOS section
above.

**What is never spoken**, by design and enforced by a test: medical notes,
phone numbers, guardian names and contacts, the emergency detail text, and a
full name with admission number. Voice carries a first name and nothing more —
a bus is a public place and anyone within earshot hears it.

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
  - **Tunnelled Metro is the exception.** `expo start --tunnel` (and manual
    ngrok / cloudflared / localtunnel hosts) forwards the dev-server port
    only, so a derived `http://<tunnel>:3001/…` can never answer. The resolver
    (`isTunnelHost` in `services/api.ts`) refuses to derive it and the sign-in
    screen shows the configuration error naming the tunnel host and the fix
    (set `EXPO_PUBLIC_API_URL` to the LAN address, or to a second tunnel in
    front of port 3001). `mobile/README.md` → "Unable to connect" walks
    through the LAN/firewall checks for the non-tunnel case.
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

Symptom when it is missing from a dev-client / APK / AAB build: the map area
on the parent Track screen and the driver Trip screen renders as a blank
(beige or grey) canvas while the bus marker, stops and the freshness banner
still draw — the position data is fine, only the tiles are absent. It looks
like a tracking bug but is a build-configuration gap; `app.config.js` prints a
warning naming the variable at `expo start` / `expo prebuild` / `eas build`
so it is caught before the build ships. The key is read at build time only:
adding it to `.env` afterwards needs a new native build, a JS reload is not
enough.

Both variables can be set via a local `.env`, the shell environment, or the
`env` block of an `eas.json` build profile. See `mobile/.env.example`.

### EAS profiles

`eas.json` already defines the three profiles used for testing:
`development` (dev-client APK), `preview` (internal APK) and `production`
(AAB, `autoIncrement`). The project id, owner and Android package are pinned
in `app.json`.
