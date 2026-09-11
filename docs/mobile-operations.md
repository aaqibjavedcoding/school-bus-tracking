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

| Signal       | Drives                                        | When it is true                                  |
| ------------ | --------------------------------------------- | ------------------------------------------------ |
| `loading`    | `LoadingView` / skeleton (`loading && !data`) | Initial load & dependency-driven reloads         |
| `refreshing` | The pull-to-refresh spinner only              | User-initiated pull (`refresh()`)                |

Background work (stale-while-revalidate cache fetches, socket-triggered
reloads, retries after a token refresh) must **never** surface a visible
"refreshing" indicator on top of working screens.

### 403 Diagnosis (Server Taxonomy)

The API only ever issues four 403s; all are intentional security
enforcements, and the app must show the server's own message — never mask a
403 as success:

| Server message                 | Source                                                        | Mobile client behavior                                  |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------- |
| `Insufficient role permissions`| Roles guard                                                    | Show message (verify the account's role & screen)       |
| `User account is inactive`     | JWT guard / auth service                                       | Session ends → login (reactivation required)            |
| `School is inactive`           | JWT guard / auth service (incl. `/auth/refresh`)               | Session ends → login (school must be re-enabled)        |
| `Request origin is not allowed`| CSRF guard                                                     | Never reachable from the app — native requests send no  |
|                                |                                                               | `Origin` header; this only fires for browser-origin     |
|                                |                                                               | requests not in `CORS_ORIGIN`                           |

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
