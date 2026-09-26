# KidBus

A production-grade, **multi-tenant school bus tracking platform**: real-time GPS bus tracking,
student boarding/dropping verification, dynamic ETA, geofenced stop arrivals, compliance-document
tracking, SOS/emergency handling, bulk Excel import/export/reporting and per-school subscription
plan limits — delivered as **one web console (Next.js) that also hosts the entire backend API**,
plus **one Expo/React Native app** shared by drivers, conductors, parents and school admins.

> **This README is intentionally exhaustive.** It is the single file to hand to an AI coding tool
> (or a new engineer) so it can understand the whole application — product, architecture, data
> model, API surface, conventions, commands and known limitations — without reading the source.
> Every claim below is verified against the code in this repository at the time of writing.
> Deeper per-topic detail lives in [`docs/`](./docs) (index at the bottom).

---

## 1. At a glance

|                   |                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo layout       | npm workspaces monorepo: `web/`, `mobile/`, `packages/*`                                                                                                                                  |
| Runtime           | Node.js **22** (`.nvmrc`), TypeScript **5.7** (`strict`), npm workspaces                                                                                                                  |
| Web app + API     | **Next.js 14.2 App Router** + React **18.3.1**; the backend runs _inside_ the same Next.js server (custom `web/server.js`), API prefix `/api/v1`                                          |
| Mobile app        | **Expo SDK 57** (`expo ~57.0.21`), React Native **0.86.3**, React **19.2.3**, `expo-router`                                                                                               |
| Database          | **PostgreSQL 16 + PostGIS 3.4** (parity image `postgis/postgis:16-3.4`), **Sequelize 6 + sequelize-typescript**, paranoid (soft) deletes, migrations only                                 |
| Realtime          | Self-hosted **Socket.IO 4.8** on the same port: namespaces `/live-tracking`, `/notifications`, `/emergencies`                                                                             |
| Push              | **FCM** via `firebase-admin` (free); `NoOpPushProvider` when unconfigured. Email/SMS providers exist as no-op seams only                                                                  |
| Validation        | Two layers: `class-validator` DTOs (server) + **Zod** schemas in `packages/validation` (shared by server, web, mobile)                                                                    |
| Auth              | JWT access token (default 15 m, in memory) + rotating httpOnly refresh cookie (default 7 d) + CSRF double-submit cookie; bcrypt cost 12                                                   |
| Tenancy           | Shared database, row-level: every tenant row carries `school_id`; **composite FKs `(school_id, id)`** make cross-tenant references impossible at the DB level                             |
| Tests             | `node:test` only (no Jest/Vitest): 195 `*.spec.ts` files — unit, real-PostgreSQL integration, real-HTTP E2E, mobile unit + simulation suites                                              |
| CI                | GitHub Actions `.github/workflows/ci.yml` — 11 independent jobs (lint, 2 typechecks, 3 unit suites, simulations, DB integration/E2E, prod build, Android Expo export, Docker image build) |
| Deployment        | Single instance by design. `infrastructure/Dockerfile` + `docker-compose.prod.yml` prepared (not deployed)                                                                                |
| Hard prohibitions | **No Prisma**, **no `sequelize.sync()`**, **no paid third-party service** in this phase (no Redis, no S3, no SMS/email gateway, no payment provider)                                      |
| Scale             | ~117k lines of application TS/TSX (excluding spec files); 28 database tables; 39 migrations; 159 API route files; 187 typed api-client methods                                            |

---

## 2. Roles, personas and which surface each one uses

`UserRole` (`packages/shared-types`) is the canonical role enum: `SUPER_ADMIN`, `SCHOOL_ADMIN`,
`DRIVER`, `CONDUCTOR`, `PARENT`. `SUPER_ADMIN` is platform-level and owns **no** `school_id`;
every other role is scoped to exactly one school tenant.

| Role           | Web surface                   | Mobile surface                                          | What they do                                                                                                                                                                           |
| -------------- | ----------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPER_ADMIN`  | `/admin/*` platform console   | `/platform` notice screen only (console is web-only)    | Onboard/suspend schools, manage school admins, define plans, assign/extend/cancel subscriptions, revenue estimates, audit log, and **"Manage data"** assisted sessions inside a tenant |
| `SCHOOL_ADMIN` | `/dashboard` + 14 nav entries | `(admin)` 6 tabs + hidden CRUD screens                  | Full fleet/route/people/trip/attendance/tracking/documents/emergency management, reports, Excel import/export                                                                          |
| `DRIVER`       | `/crew`                       | `(crew)` — Trip tab leads with navigation + GPS sharing | Start/close the trip, share GPS (foreground + background), manifest, stop ETA, SOS                                                                                                     |
| `CONDUCTOR`    | `/crew`                       | `(crew)` — Manifest leads                               | Same crew surface; emphasis on boarding/dropping children, SOS                                                                                                                         |
| `PARENT`       | `/parent/*`                   | `(parent)` — Home / Track / Alerts                      | See children + exact bus/driver, live map + ETA + next stop, notification centre with unread badge                                                                                     |

The public `/` page introduces the platform, links to `/login`, and includes an interactive,
read-only sample trip at `/#demo`. This demo uses fictional data; it never exposes real trips,
locations, or student information. After signing in, each role is sent to its own workspace.

Web nav per role (source of truth: `web/src/lib/roles.ts`, mirrored client-side by `canAccessPath()`
and server-side by `@Roles(...)` on every endpoint):

- **SCHOOL_ADMIN**: `/dashboard` Dashboard, `/students`, `/buses`, `/routes`, `/staff`, `/assignments`,
  `/shifts` (Shifts & runs), `/documents`, `/emergencies`, `/trips`, `/tracking`, `/attendance`,
  `/reports`, `/imports` — plus the detail deep links the guard grants
  (`/students/:studentId` — which owns the guardians panel —, `/buses/:busId/documents`,
  `/drivers/:driverId/documents`, `/conductors/:id/documents`, `/routes/:id`, `/trips/:tripId`).
  Note: the standalone `/parents` page is currently granted to the **managed** SUPER_ADMIN sidebar
  only, so a school admin edits guardian links from the student detail screen.
- **PARENT**: `/parent` dashboard, `/parent/children`, `/parent/tracking`,
  `/parent/notifications` (+ `/children` and `/children/:id`, granted as extra prefixes).
- **DRIVER / CONDUCTOR**: `/crew` (today's trip) and `/tracking` (live map).
- **SUPER_ADMIN**: `/admin` (dashboard), `/admin/schools` (+ `/new`, `/:id`), `/admin/subscriptions`,
  `/admin/plans` (+ `/new`, `/:id`), `/admin/revenue`; `/admin/audit-logs` exists but is not in the
  sidebar. Inside an active assisted-management session the sidebar becomes the tenant allowlist
  (`/students`, `/parents`, `/buses`, `/routes`, `/staff`, `/assignments`, `/shifts`, `/reports`,
  `/imports`).

Mobile route groups (`mobile/app/`): `(crew)/trip|manifest|stops|sos`,
`(parent)/home|tracking|notifications|children/[id]`,
`(admin)/dashboard|trips|trips/[id]|tracking|attendance|reports|reports/[report]|emergencies|manage/*`,
plus `login`, `index` (role redirect gate), `platform`.

---

## 3. Feature inventory (everything currently in the app)

### 3.1 Multi-tenancy & school onboarding

- Tenant root is `schools`; every tenant-owned table carries `school_id` and a non-partial
  `UNIQUE (school_id, id)` index, which is what allows **composite foreign keys**
  `(school_id, x_id) → x(school_id, id)`. A row can never combine two schools' resources.
- `school_id` is **always** derived from the verified JWT — never from a body field or header.
- Tenant may be addressed by human `code` (e.g. `green-valley`) or UUID.
- Email uniqueness is per tenant (`uq_users_school_email`); a separate partial unique index
  (`uq_users_super_admin_email`) guards platform-admin logins.
- School onboarding (`POST /api/v1/schools`) atomically creates the tenant **and** its first
  `SCHOOL_ADMIN`; activate/deactivate is soft (deactivation revokes open refresh tokens, deletes
  nothing) and inactive tenants are blocked centrally.
- Cross-tenant probing returns a generic `404`/`403` with identical messages so ids cannot be enumerated.

### 3.2 Fleet & network

- **Buses**: code/registration number, capacity, model, `VehicleStatus`, CRUD + soft delete.
- **Routes**: name, code, direction-agnostic path, `is_active`; detail endpoint returns stops.
- **Stops**: ordered `sequence_number` per route, `latitude`/`longitude`,
  `geofence_radius_meters`, optional scheduled arrival time. `PUT /routes/:id/stops` reorders a
  route's stop manifest with an ordered id list.
- **Plan-limit aware**: students / buses / routes / stops / drivers / conductors / staff / parents /
  trips / runs are all quota-counted per plan (see §11).

### 3.3 Operating model — shifts, runs, run crew (the important one)

Documented in `docs/operating-model.md`; it deliberately replaces "1 route = 1 bus = 1 crew".

- **`routes`** = geometry (an ordered set of stops). It no longer owns vehicles or crew.
- **`runs`** = one vehicle's _timed pass_ over a route: `route_id` + optional `shift_id` +
  optional `bus_id` + parent-facing `code` (e.g. `R-02`) + `is_default`.
- **`shifts`** = bell windows (`time` columns, not timestamps) that make two runs on one bus legal
  because they are disjoint in time.
- **`run_crew`** = per-run roster of `DRIVER` / `CONDUCTOR` (role enum `RunCrewRole`), with a
  dedicated `enum_run_crew_role` DB type so it can grow (attendant/escort) without touching the
  frozen legacy table.
- **Conflict engine** (`web/src/server/modules/runs/run-conflicts.ts`, pure + unit-tested):
  `RUN_ROLE`, `BUS`, `CREW_RUN` compared on **shift windows**; a `NULL` shift means "whole day" and
  therefore conflicts with everything. Admission is serialized with a PostgreSQL advisory lock
  inside the same transaction.
- **`route_assignments`** (the old date-range roster) is **deprecated**: reads still work, writes
  return `410 Gone` with `Deprecation` / `Sunset` / `Link` headers, and until retirement every write
  was mirrored into `run_crew`.
- **Back-compat invariant**: every route always has exactly **one** default run
  (`uq_runs_route_default`); `provisionDefaultRun` creates it for pre-existing routes and for each
  new route. `runs.shift_id` stays nullable on purpose.
- `students.run_id` and `trips.run_id` pin _who rides which bus_ and _which execution a trip is_,
  so a parent is told an exact bus code/driver instead of an inference from their stop.
- Bulk import is intentionally **not** offered for shifts/runs (it would resurrect the retired
  `route_assignments` write path); exports **are** (`ExportDataset.SHIFTS`, `.RUNS`).

### 3.4 People

- **Students**: admission number, name, gender, class/section, DOB, `home_stop_id`, `run_id`,
  emergency contact, medical notes (classified sensitive: excluded from exports and audit payloads).
- **Parents / guardians**: user accounts with the `PARENT` role plus `student_guardians` links
  (relationship, pickup authorization flag) — manageable from both sides (`/parents/:id/students`
  and `/students/:id/guardians`).
- **Staff**: drivers and conductors are `users` rows with role `DRIVER`/`CONDUCTOR`; shared
  `StaffResponse<R>` contract with generic list/detail/dto typing.
- Paged, searchable, sortable list endpoints for every entity (`page`, `limit`, `search`, `sort`,
  `order`, plus entity filters); `include=minimal|full` on routes/students for pickers.

### 3.5 Trips

- Status machine (`TRIP_STATUS_TRANSITIONS` in `packages/validation`):
  `SCHEDULED → BOARDING → IN_PROGRESS → COMPLETED`, with `CANCELLED` reachable while not terminal;
  `COMPLETED`/`CANCELLED` are terminal (`[]`). Enforced in the service layer, not the DB.
- `PATCH /trips/:id/status` (crew + admin), `POST /trips/:id/cancel`, `POST /trips` (admin),
  reschedule only while `SCHEDULED`.
- A trip may be created for a route **or** a run; when created for a run the bus/driver/conductor
  are **derived from the run's crew** rather than typed in.
- Trip cockpit (web `/trips/:id`, mobile `trips/[id]`): lifecycle actions, live map, ETA, stop
  arrivals, manifest — one screen for dispatching a trip end to end.
- Every status transition writes an audit row with `{from, to}` metadata and notifies the linked
  parents **after** the transaction commits.

### 3.6 Attendance (boarding / dropping)

- Body-less, idempotent endpoints: `POST /trips/:tripId/students/:studentId/board` and `/drop`.
- One-way progression `PENDING → BOARDED → DROPPED`; boarding twice, dropping before boarding and
  dropping twice are all rejected (`409` with a specific message).
- **Manifest endpoints** give per-trip rosters ordered by stop sequence, with a `summary` of
  `total` / `pending` / `boarded` / `dropped` counts over the whole visible manifest.
- Each write is scoped to the caller's own trips for crew, and to the tenant for admins.
- Parents get a notification per board/drop (see §3.9).

### 3.6a Crew stop marking (Arrived / Skip)

- A stop used to become "reached" **only** through the GPS geofence (100 m). With location off,
  the signal weak or the bus parked across the road the run stuck: `next_stop` never advanced and
  parents further down the route were never alerted. Two crew endpoints are the manual fallback:
  - `POST /trips/:tripId/stops/:stopId/arrive` — body-less;
  - `POST /trips/:tripId/stops/:stopId/skip` — `{ "reason": "…" }`, **required**, at least 3
    characters after trimming (`isValidStopSkipReason` in `@school-bus-tracking/validation`, used by
    both the server DTO and the mobile button).
- **Crew of that trip only** (`DRIVER` / `CONDUCTOR`) — proven by the trip's dispatch snapshot or an
  active `RouteAssignment` effective on the trip date; a `SCHOOL_ADMIN` is deliberately excluded,
  because marking a stop is testimony about where a bus physically was. Everything a caller may not
  see is the same generic `404`. Open trips only (the attendance window) — otherwise `409`.
- **Idempotent** in the same way board/drop are: the `x-idempotency-key` header (scopes
  `crew-stops.arrive` / `crew-stops.skip`) plus the `(school_id, trip_id, stop_id)` unique index. A
  stop already recorded — by the geofence, or by a replay of the same offline-queue item — answers
  `200` with the existing row and `created: false`. Never a second row, notification or broadcast.
- Both writes land in the **same** `trip_stop_arrivals` table as the geofence pipeline, so the
  progress frontier, `next_stop` and `GET /trips/:tripId/arrivals` keep one source of truth. New
  columns: `source` (`geofence` | `crew`, defaulting to `geofence` so every existing row keeps its
  meaning), `skip_reason` (non-null only on a skip) and `recorded_by`. A crew mark stores **no**
  coordinates — nothing was measured — so `latitude` / `longitude` / `distance_meters` are now
  nullable and the response types read `number | null`.
- A crew-marked **arrival** notifies parents and broadcasts `trip:stop:arrived` exactly like a
  geofence arrival. A **skip** does neither — nobody's child was served — but it is visible to the
  school on the trip detail through the arrivals read, carrying its reason. Every call writes an
  audit row (`stop.crew_arrive` / `stop.crew_skip`).
- Mobile: the buttons go through the crew offline queue, so a tap with no coverage is saved and
  replayed with its own idempotency key. The written confirmation and the spoken line ("Stop 3
  recorded, 5 children board here") fire **only** once the server has answered, and read their
  numbers off that answer — the queued path stays silent and says "saved on this phone".

### 3.7 Live tracking & GPS

- Crew publishes fixes over **Socket.IO `/live-tracking`** as `trip:location:update`, validated
  client-side **and** server-side with the same Zod `GpsLocationFix` contract (lat/lng, accuracy,
  km/h speed, normalized heading, device `recorded_at`).
- Malformed/stale/offline fixes are **dropped, never queued or fabricated**.
- Server persists to `trip_locations` and broadcasts to the trip room `trip:<tripId>`; joining a
  room requires a verified JWT and an authorized relationship to that trip (`tracking:join`
  returns an ack with a denial reason otherwise). A client can never name another school's room.
- REST fallback/history: `POST|GET /trips/:id/location`, `GET /trips/:id/location/history`.
- `trip:tracking:started` / `trip:tracking:stopped` bracket the live window; sharing auto-stops on
  terminal trip states and on sign-out.
- **When sharing starts (driver)**: the driver's own **server-confirmed** lifecycle tap — "Start
  boarding" (`BOARDING`) or "Depart & drive" (`IN_PROGRESS`) on the mobile trip screen — starts
  GPS sharing for that trip immediately (the OS location prompt appears there if not yet granted).
  The GPS strip's **Share GPS** button is the fallback for a refused/stopped start; after a failed
  run it reads the failing cause's own repair — **Open location settings** (services off /
  permanently denied), **Ask for location permission** (refused but askable), or **Retry** for the
  rest — with the reason on a second line (`gps-strip-action.ts`, spec-pinned). Conductor taps,
  admin transitions and the offline-queued path never start GPS; a permission granted on the Help
  screen never does either. A trip that is only `SCHEDULED` cannot share (the server rejects fixes
  with `trip_not_open`).
- Maps: **MapLibre** on both surfaces — **web** `maplibre-gl` v5 (`web/src/features/map`)
  and **mobile** `@maplibre/maplibre-react-native` (`BusMap.tsx` + `BusMap.web.tsx`) —
  over **OpenFreeMap**'s public instance (`https://tiles.openfreemap.org/styles/bright`,
  OpenStreetMap data), breadcrumbs + marker + heading. Both maps are open source with
  **no key, no account, no billing** (product rule — `docs/live-tracking-map.md` →
  "Map provider policy"). The mobile map engine is a custom native module the Expo Go
  shell does not carry on any platform, so the mobile map surfaces in Expo Go show a
  labelled "needs a development build" panel instead of a blank canvas
  (`src/features/map/map-surface-mode.ts`); a development build renders it everywhere.
  Web self-host path: set `NEXT_PUBLIC_MAP_STYLE_URL` / `EXPO_PUBLIC_MAP_STYLE_URL` to a
  self-hosted OpenFreeMap style URL (https-only, one variable, no code change).

### 3.8 ETA & geofence stop arrivals

- `web/src/server/modules/eta/`: **approximate, GPS-derived ETA** per remaining stop
  (`GET /trips/:id/eta`) using reported speed, falling back to `ETA_FALLBACK_SPEED_KMH` (25) and
  clamped into `[ETA_MIN_SPEED_KMH, ETA_MAX_SPEED_KMH]` (5–90 km/h). Haversine math in `geo.util.ts`.
- `StopArrivalsService` marks a stop **arrived** when an accepted fix falls inside the stop's
  `geofence_radius_meters` and no arrival is recorded yet → inserts `trip_stop_arrivals`, emits
  `trip:stop:arrived`, creates a `STOP_ARRIVED` notification.
- `GET /trips/:id/progress` = ETA + arrivals + next stop in one payload (drives both client trackers).
- Recomputed ETA is broadcast as `trip:eta:update`.

### 3.9 Notifications

- `NotificationsService` is invoked **only after** the domain transaction commits — a delivery
  failure can never corrupt a boarding, a trip transition or an SOS.
- Persistent rows in `notifications` (one per recipient per event) with delivery bookkeeping:
  `push_status` (`pending → sent | failed | not_configured`), `delivery_retry_count`,
  `last_delivery_attempt_at`, `delivery_failure_reason`.
- Types: `STUDENT_BOARDED`, `STUDENT_DROPPED`, `TRIP_BOARDING`, `TRIP_IN_PROGRESS`,
  `TRIP_COMPLETED`, `TRIP_CANCELLED`, `STOP_ARRIVED`.
- Realtime: `/notifications` namespace → private room `notification:user:<userId>`, event
  `notification:new`. Room membership assigned server-side from the verified JWT.
- Parent REST: `GET /parent/notifications` (`read`/`unread` filter, paging),
  `POST /parent/notifications/:id/read`, `POST /parent/notifications/read-all`.
- **OS push (FCM)**: `PushNotificationProvider` interface with `FcmPushProvider`
  (`firebase-admin`, `sendEachForMulticast`) selected by env — used when
  `FIREBASE_SERVICE_ACCOUNT_JSON` is set, otherwise `NoOpPushProvider`. Notification message (title/body)
  so the OS renders it when the app is killed, plus string-only `data` for future deep links.
  `UNREGISTERED`/`INVALID_REGISTRATION` deactivate the offending `device_tokens` row.
- Device registration: `POST /api/v1/notifications/devices` (idempotent upsert, moves ownership if
  the device signed in as another user) and `DELETE /api/v1/notifications/devices/:token`. Any
  school role except `SUPER_ADMIN`; rate-limited (`device_register`, 30/min).
- Mobile: `expo-notifications` channel `notifications`, Android 13+ `POST_NOTIFICATIONS` and iOS
  provisional permission handling, `getDevicePushTokenAsync()` on login/session-restore, token
  listener re-registers refreshed tokens, unregister on logout (fire-and-forget, never blocks).
  **Remote push does not work in Expo Go** — needs an EAS dev/production build.

### 3.10 Emergencies / SOS

- Crew raises an alarm via `POST /api/v1/emergencies/sos` — `type` is one of `ACCIDENT`,
  `BREAKDOWN`, `MEDICAL`, `STUDENT_INCIDENT`, `SECURITY`, `OTHER`; optional trip / bus / stop and an
  optional coordinate pair (both or neither). Idempotent through `x-idempotency-key`, rate-limited by
  the `sos_create` policy.
- Status machine `OPEN → ACKNOWLEDGED → RESOLVED`, `OPEN/ACKNOWLEDGED → CANCELLED`, enforced by
  `EMERGENCY_STATUS_TRANSITIONS`; only school admins change status; `POST /emergencies/:id/cancel`.
- Broadcast on `/emergencies` (`emergency:new`, `emergency:updated`) to the owning school's room;
  `GET /emergencies`, `/emergencies/active`, `/emergencies/mine` (the raising crew member).
- **Web admin siren** (`web/src/features/emergencies/emergency-alarm.ts`): a Web-Audio synthesised
  repeating alarm on any admin screen — no audio asset, no dependency, a pure policy module ensures
  nothing but `emergency:new` can make sound (autoplay queueing, mute, repeat cap and degradation
  are unit-tested). Bell UI + `/emergencies` screen + mobile `emergencies` screen and `SosPanel`.
- Open/acknowledged emergencies are never deleted by retention.

### 3.11 Compliance documents

- Two owners: **bus** (`REGISTRATION_CERTIFICATE`, `INSURANCE`, `FITNESS_CERTIFICATE`, `PERMIT`,
  `POLLUTION_CERTIFICATE`, `OTHER`) and **driver/conductor** (`DRIVING_LICENSE`,
  `MEDICAL_CERTIFICATE`, `POLICE_VERIFICATION`, `TRAINING_CERTIFICATE`, `ID_PROOF`, `OTHER`).
- `document_requirements` lets each school mark a type required/optional per owner; defaults in
  `DEFAULT_BUS_DOCUMENT_REQUIREMENTS` / `DEFAULT_DRIVER_DOCUMENT_REQUIREMENTS`.
- Status is **derived** from the expiry date (`VALID` / `EXPIRING_SOON` within
  `DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS` = 30 / `EXPIRED`), never stored as truth. Compliance
  endpoints per owner (`.../documents/compliance`) plus a school-wide `GET /documents/overview`.
- Uploads: `LocalStorageProvider` (dev-only) under `.document-storage/` (git-ignored), allowed
  `.pdf .jpg .jpeg .png .doc .docx .xls .xlsx`, 10 MB cap, random-UUID filenames, path-traversal
  guarded. The provider interface is the seam for S3/GCS later.

### 3.12 Bulk import / export / reports (web-only back office)

- **Import** wizard flow: template → upload → **validate (dry run)** → review → **commit**. The
  file is re-uploaded and re-validated on commit (the client's preview is never trusted); all writes
  happen in one transaction (any failure rolls the whole import back, `status = FAILED`).
  Modules: `students`, `parents`, `student-guardians`, `buses`, `routes`, `stops`, `drivers`,
  `conductors`, `route-assignments`. Modes `create` | `upsert` matched on natural keys
  (admission number, email, registration number, route code, `route code + stop name`, …).
  Caps: 5 000 rows (500 for account-creating modules because bcrypt is deliberately expensive) and
  5 MB (`MAX_IMPORT_FILE_BYTES`). `import_jobs` history + a downloadable
  `<module>_import_errors.xlsx` error workbook; uploaded files are never persisted.
- **Export** datasets: students, parents, student-guardians, buses, routes, stops, drivers,
  conductors, route-assignments, trips, attendance, notifications, bus-documents,
  driver-documents, shifts, runs — `xlsx` or `csv`, streamed page-by-page with the same filters as
  the screen, so the file and the UI can never disagree (`X-Total-Records` header). Business columns only (no hashes/tokens/CSRF material, no
  medical notes).
- **Reports**: `GET /reports/overview` plus 15 report types — `students-by-route`,
  `students-by-bus`, `students-by-stop`, `students-unassigned`, `student-roster`, `bus-utilization`,
  `crew-assignments`, `trips`, `attendance`, `notifications`, `documents`, `run-utilization`,
  `bus-day-tiering`, `crew-load`, `deadhead-runs` — uniform
  `{ summary, columns, rows, meta, filters_applied }` payload, each exportable through the same query.
- Excel on `exceljs` only; multipart parsed from `request.formData()` (no `multer` dependency);
  audit-logged as `import.validate` / `import.commit`.

### 3.13 Super Admin platform console

- **Dashboard** with real aggregates + dependency-free inline SVG/CSS charts (no chart library in
  the bundle): KPIs, plan distribution, subscription health, school/user counts.
- **Schools**: paged/searchable list, "School 360" detail (profile edit, admins CRUD +
  activate/deactivate + password reset, subscription panel, usage-vs-limit rows, lifecycle actions),
  create-school wizard (school + first admin in one call).
- **Plans** (`/admin/plans`): billing period (`monthly|yearly`), price, feature flags
  (`PlanFeature`: live tracking, ETA, geofence arrivals, attendance, notifications, parent portal,
  advanced reports, analytics) and JSON limits per `PlanLimitResource`; activate/deactivate.
- **Subscriptions**: assign/change plan, set lifecycle status, extend period, cancel, per-school and
  global history tables. All money is labelled **estimate** — derived from plan list prices; there
  is no payment provider, invoicing or cash ledger anywhere in the repo.
- **Audit logs** (`/admin/audit-logs`): filterable view over the append-only `audit_logs` table.

### 3.14 Assisted management ("Manage data")

- A `SUPER_ADMIN` opens a scoped session on one tenant
  (`POST /admin/schools/:id/manage/session`, `GET .../current`, `POST .../end`) recorded in
  `assisted_management_sessions` (actor, school, `started_at`/`ended_at`, `end_reason`
  `exit|superseded`, IP). No impersonation: the actor stays the platform admin.
- 17 allowlisted capabilities (students, parents, student_guardians, buses, routes, stops, drivers,
  conductors, route_assignments, shifts, runs, run_crew, imports, exports, import_templates,
  import_history, reports) mapped 1:1 to `/admin/schools/:schoolId/manage/*` endpoints guarded by
  `ManagedSchoolGuard`.
- The shared api-client transparently **remaps tenant paths** onto the managed surface while a
  session is active (`MANAGED_TENANT_PATH_RULES` + `resolveManagedSchoolId`), so the existing
  school-admin React screens work unchanged inside a managed session; the web guard
  (`canAccessPath(..., managed)`) allows exactly the same sections, and the client-side response
  cache is keyed per session scope so a managed read can never be served to a school user.
- `AssistedMutationAuditInterceptor` stamps every mutation with the session id so audit answers
  "actor: platform admin · school: X · context: assisted management".
- Explicitly **not** reachable through assisted management: trips, live tracking, attendance,
  documents, emergencies, parent portal, and all billing/subscription mutations.

### 3.15 Platform-grade cross-cutting behaviour

- **Audit logging**: append-only, redacting, fire-and-forget; covers school lifecycle, students,
  guardians, staff, buses, routes, trips, documents, emergencies, imports/exports/reports, auth
  events and trip transitions; `GET /api/v1/audit-logs`.
- **Request id + structured logging**: `x-request-id` (client-supplied or server UUID) echoed and
  stamped into JSON logs (`request_id, method, path, status, duration, user_id, school_id`);
  secrets/tokens never logged.
- **Idempotency** (`x-idempotency-key`, PostgreSQL `idempotency_keys`, TTL
  `IDEMPOTENCY_TTL_HOURS` = 24, scoped per tenant+user+endpoint): board, drop, trip status, trip
  cancel, SOS, emergency status, and socket GPS ingest (`live-tracking.location:<tripId`).
- **Rate limiting**: global guard, process-local bounded store; policies
  `auth_login` 10/min (also keyed per school+email identity), `auth_refresh` 60/min,
  `auth_logout` 30/min, `password_reset` 10/15 min, `sos_create` 12/min, `attendance_write`
  240/min, `location_read` 240/min, `read_heavy` 300/min, `device_register` 30/min,
  `data_import` 12/min, `data_export` 30/min, `report_read` 120/min — all env-tunable.
  `RATE_LIMIT_STORE=redis` **fails fast** by design (no silent degradation).
- **Health**: `GET /api/v1/health` (liveness) and `/api/v1/health/ready` (readiness, `503` with
  per-dependency detail) — unauthenticated, exercised E2E over the production chain.
- **Data retention worker**: scheduled **inside the API process** by `RetentionScheduler`, started by
  `server.js` after DB bootstrap and stopped on shutdown; first pass 30 s after boot, then every
  6 h; guarded against double starts; a failing pass is logged and retried; each pass takes a
  PostgreSQL **transaction-scoped advisory lock** so only one process cleans up. Deletes old GPS
  rows, notifications, expired refresh tokens, audit logs, **resolved/cancelled** emergencies and
  expired idempotency keys.
- **WebSocket session revalidation**: every 5 min sweeps all three namespaces and disconnects
  sockets whose access token expired, whose account was deactivated or whose school was deactivated
  (sending `session:revoked` first). Batched queries; DB errors fail safe (nothing disconnected).
  Clients reconnect and re-run their `auth` callback.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` → stop scheduler + revalidation → close Socket.IO → stop
  HTTP listener → close DB pool, bounded by a 10 s force-exit.
- **Compression + security headers**: gzip on the API chain (`COMPRESSION_ENABLED`,
  `COMPRESSION_THRESHOLD_BYTES`; explicit `0` compresses everything), `nosniff`, JSON-only CSP for
  API responses, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, HSTS in production.
- **Client resilience** (both clients): response cache with stale-while-revalidate, single-flight
  refresh, `401` → refresh-and-replay-once, paged-query hooks, offline banner (mobile), error
  mapping for `403/409/429/5xx` with the server's own reason surfaced.

---

## 4. Tech stack (exact, as pinned)

**Web + API (`web/`)**: next 14.2.35, react/react-dom 18.3.1, typescript 5.7.3,
sequelize 6.37.5 + sequelize-typescript 2.1.6, pg + pg-hstore, reflect-metadata, socket.io 4.8.3,
socket.io-client, class-validator + class-transformer, zod (via `packages/validation`), bcryptjs,
cookie-parser, cors, compression, helmet, exceljs, firebase-admin, maplibre-gl 5 (+ @types/geojson),
dotenv, cross-env, sequelize-cli, ts-node.

**Mobile (`mobile/`)**: expo ~57.0.21, react-native 0.86.3, react 19.2.3, expo-router ~57.0.20,
expo-location, expo-task-manager, expo-notifications, expo-dev-client, expo-constants, expo-linking,
expo-status-bar, @maplibre/maplibre-react-native 11.4.0 (+ @types/geojson), react-native-safe-area-context,
react-native-screens, react-native-web, @react-native-async-storage/async-storage,
@react-native-community/netinfo, @expo/vector-icons, socket.io-client, @expo/ngrok (dev),
babel-preset-expo.

**Shared**: zod (validation), typescript build per package with `declaration` + `declarationMap`.

**Tooling**: ESLint 9 flat config + typescript-eslint 8 + eslint-config-prettier, Prettier 3
(`singleQuote`, `printWidth 100`, `trailingComma all`), `npm run typecheck` as the compile gate,
test runner = **`node --test`** (some suites use `--experimental-strip-types` and
`--experimental-test-module-mocks`).

---

## 5. Repository structure

```
school-bus-tracking/
├── .nvmrc / .npmrc / .gitignore / .dockerignore / .prettierignore / .prettierrc
├── eslint.config.mjs                 # ESLint 9 flat config (root, all workspaces)
├── tsconfig.base.json                # ES2022, NodeNext, strict, declarations
├── tsconfig.json                     # root composite project references
├── package.json                      # workspaces: web, mobile, packages/*; orchestration scripts
├── README.md                         # ← this file
│
├── web/                              # Next.js App Router UI *and* the whole backend API
│   ├── server.js                     # custom Node server (the only entrypoint, dev + prod):
│   │                                 #  ensureServerBuild → bootstrapDatabase → /api/* middleware
│   │                                 #  chain + Socket.IO → retention scheduler → next({dev})
│   ├── instrumentation.ts             # attaches the 3 gateways inside Next's module graph
│   ├── next.config.js                # transpilePackages, server externals, headers(), images off
│   ├── security-headers.js            # shared HTTP security-header policy (CSP etc.)
│   ├── server-build-check.js          # verifies/repairs web/dist vs src/server (single model registry)
│   ├── .sequelizerc                   # Sequelize CLI → src/server/database
│   ├── .env.example                   # full documented env template
│   ├── tsconfig{,.build,.server}.json # client / compiled-server / typecheck-server configs
│   ├── scripts/
│   │   ├── sequelize-cli.js, make-migration.js, make-seeder.js
│   │   └── smoke/smoke-*.ts           # 8 DB-less smoke scripts (admin, parent, documents, emergency…)
│   ├── test/
│   │   ├── integration/*.integration.spec.ts   # real PostgreSQL
│   │   ├── e2e/*.e2e.spec.ts                   # real HTTP over the PRODUCTION middleware chain
│   │   └── support/{app,auth,database,env,fixtures,http,routes}.ts
│   └── src/
│       ├── app/
│       │   ├── layout.tsx, globals.css, login/page.tsx
│       │   ├── (authenticated)/       # 40 pages: admin/*, parent/*, students, buses, routes,
│       │   │                          # staff, assignments, shifts, trips, tracking, attendance,
│       │   │                          # documents, emergencies, reports, imports, parents,
│       │   │                          # children, crew, drivers/, buses/…  + layout.tsx guard
│       │   └── api/v1/**/route.ts      # 159 route files → createRouteHandler(endpointDefinition)
│       ├── components/                # AppShell, icons, ui/ primitives (Button, Modal, Badge,
│       │                              # Pagination, Field, Skeleton, useToast, ErrorBoundary…)
│       ├── features/                  # feature slices: admin (metrics, charts, KPI, schools,
│       │                              # school-admins, subscriptions), auth (AuthProvider,
│       │                              # RequireAuth), attendance, crew, data-transfer
│       │                              # (ImportWizard, ExportButton, ListActions), documents,
│       │                              # emergencies (siren engine), managed (assisted session),
│       │                              # map (MapView), notifications, parent, runs, tracking, trips
│       ├── hooks/                     # useLoad, usePagedResource
│       ├── lib/                       # roles.ts (nav + canAccessPath), api-cache, errors, format,
│       │                              # idempotency, socket-auth
│       ├── services/                  # api.ts (client instance), session.ts, socket registry +
│       │                              # live-tracking / notifications / emergencies socket wrappers
│       ├── types/
│       └── server/                    # ← backend engine (excluded from the webpack bundle)
│           ├── container.ts           # hand-rolled DI: one instance of every service, lazily
│           ├── config/                # app, database, jwt, security, rate-limit, eta, live-tracking,
│           │                          # notifications, retention, subscription, websocket configs
│           ├── framework/             # NestJS-parity runtime: ExecutionContext, HttpException,
│           │                          # ValidationPipe, ParseUUIDPipe, JwtService, Logger,
│           │                          # ConfigService, decorators metadata
│           ├── http/                  # request-adapter (Next Request ⇄ Express-like),
│           │                          # api-middleware-chain (SHARED with the E2E harness),
│           │                          # route-runtime (guard pipeline), response-envelope,
│           │                          # cookies, file-response (streaming + multipart),
│           │                          # deprecation headers, test-server
│           ├── auth/                  # token.util (access/refresh), password.util (bcrypt 12)
│           ├── common/
│           │   ├── access/            # SchoolAccessService (tenant activation + membership)
│           │   ├── guards/            # JwtAuthGuard, RolesGuard
│           │   ├── decorators/        # @Roles, @CurrentUser, …
│           │   ├── idempotency/       # IdempotencyService + endpoint scopes
│           │   ├── plan-limits/       # PlanLimitsService, PlanLimitReachedException
│           │   ├── rate-limit/        # policies, guard, bounded store + fail-fast factory
│           │   ├── security/          # CSRF (double-submit), CORS resolver, security headers
│           │   ├── subscriptions/     # resolveSubscriptionEntitlement (access truth), lapse exc.
│           │   ├── websocket/         # session revalidation sweeper
│           │   ├── middleware/        # compression, request-id
│           │   └── interceptors/      # structured logging
│           ├── database/
│           │   ├── bootstrap.ts       # addModels + authenticate (must resolve before anything)
│           │   ├── models/            # 31 model files (28 tables) + enums.ts + base.model.ts
│           │   ├── migrations/        # 39 timestamped migrations (schema is migrations-only)
│           │   ├── seeders/           # demo core data, platform super admin, four dummy schools
│           │   └── templates/         # migration/seeder skeletons used by scripts/make-*.js
│           ├── api/*.ts               # endpoint definitions (1 per module) — roles, rate policy,
│           │                          # status, DTOs, idempotency, audit + handler
│           ├── modules/<name>/        # service + controller-parity + DTOs + constants (+ specs)
│           │   ├── admin/             # dashboard, schools, school admins, plans, subscriptions,
│           │   │                      # global subscriptions + manage/ (assisted sessions, guard,
│           │   │                      # audit interceptor, managed CRUD)
│           │   ├── assignments/, stops/, routes/, buses/, students/, parents/, staff/,
│           │   ├── shifts/, runs/, run-crew/, trips/, trip-attendance/, live-tracking/, eta/,
│           │   ├── notifications/ (+ providers/, device tokens), parent-portal/, emergencies/,
│           │   ├── documents/ (+ storage/), data-transfer/ (excel, import/definitions,
│           │   │   │                  export/definitions), reports/ (definitions/),
│           │   ├── dashboard/, schools/, audit/, auth/, auth-test/, health/
│           ├── realtime/index.ts      # wires the 3 gateways to the shared container + revalidation
│           └── workers/               # retention.worker.ts + retention.scheduler.ts
│
├── mobile/                           # Expo app for DRIVER, CONDUCTOR, PARENT, SCHOOL_ADMIN
│   ├── app.json / app.config.js      # plugins (expo-location, expo-notifications, plus the
│   │                                 # MapLibre plugin appended by app.config.js), permissions,
│   │                                 # google-services.json wiring
│   ├── eas.json                      # development / preview / production build profiles
│   ├── google-services.json          # Firebase (Android) config
│   ├── metro.config.js               # monorepo resolver: watchFolders = repo root
│   ├── babel.config.js               # babel-preset-expo + reanimated-free config
│   ├── .env.example                  # EXPO_PUBLIC_API_URL, optional EXPO_PUBLIC_MAP_STYLE_URL
│   ├── scripts/
│   │   ├── expo-start.mjs            # runs `expo start --go` with EXPO_NO_REDIRECT_PAGE=1
│   │   ├── expo-start.spec.ts        # …and its unit test
│   │   ├── verify-expo-sdk.mjs       # SDK-line guardrail (runs in prestart/preandroid/preios)
│   │   ├── generate-assets.mjs       # rasterises logo/school_bus_logo.svg into icon/splash slots
│   │   └── test-loaders/*.mjs        # native-module stub loader for push simulation tests
│   ├── app/                          # expo-router file routes
│   │   ├── _layout.tsx               # root: providers, api-env registration, splash/status bar
│   │   ├── index.tsx / login.tsx / platform.tsx
│   │   ├── (crew)/   trip, manifest, stops, sos, help (hidden — telemetry/support)
│   │   ├── (parent)/ home, tracking, notifications, children/[id]
│   │   └── (admin)/  dashboard, trips, trips/[id], tracking, attendance, reports,
│   │                 reports/[report], emergencies, manage/{students,students/[id],buses,
│   │                 routes,routes/[id],routes/[id]/runs,shifts,staff,guardians,assignments,
│   │                 documents,documents/requirements,documents/bus/[id],documents/driver/[id]}
│   └── src/
│       ├── components/               # Card, forms, list-screen, SegmentedControl, StatusBadge(s),
│       │                             # Toast, DateTimeField, LogoutButton, LanguageSwitcher, ui.tsx
│       ├── features/
│       │   ├── auth/                 # AuthProvider (memory token + cookie refresh), RoleGate
│       │   ├── crew/                 # crew-trip.ts, navigation-stop.ts, location-task.ts,
│       │   │                         # useCrewToday, useCrewLocationSharing, GpsPermissionRecovery,
│       │   │                         # GpsSharePanel, GpsShareStrip, ManifestList, StatusCard,
│       │   │                         # TripNavigationCard, TripStatusActions, SosPanel,
│       │   │                         # HoldToConfirmButton, crew-copy, trip-status-style,
│       │   │                         # hold-to-confirm, sos-flow, manifest-row (+ guard specs),
│       │   │                         # offline/ (queue-core, attendance-queue, attendance-sync,
│       │   │                         #         useOfflineAction, OfflineSyncBanner)
│       │   ├── driver/ conductor/    # thin re-exports of the same crew slice
│       │   ├── parent/               # NotificationsProvider, notifications-state, run-summary
│       │   ├── admin/                # documents (form sheet, compliance card, helpers),
│       │   │                         # emergencies helpers, reports StatGrid
│       │   ├── map/                  # BusMap (native, MapLibre) + BusMap.web (list fallback),
│       │   │                         # follow-camera, bus-motion, map-style
│       │   ├── notifications/        # push-registration (pure), push-notifications(.native),
│       │   │                         # push-routing, push lifecycle simulation
│       │   └── tracking/             # useLiveTripTracking, EtaViews, ConnectionIndicator
│       ├── hooks/                    # useLoad, usePagedResource, useActiveFilter, useNetworkStatus,
│       │                             # refresh-progress
│       ├── lib/                      # geo, format, datetime, errors, idempotency, ids,
│       │                             # active-filter, keyboard-aware, navigation, paged-query,
│       │                             # reports, roles (homeRoute/RoleGroup), runs, trips-list,
│       │                             # i18n (+ i18n.en/i18n.hi dictionaries, i18n-budget,
│       │                             #   i18n-provider, i18n-preferences + 4 guard specs)
│       ├── services/                 # api.ts (base-URL resolution), api-cache, api-env, session,
│       │                             # socket-auth, socket-options, 3 socket wrappers
│       ├── theme/                    # tokens, layout (bottom-bar metrics), index
│       └── types/
│
├── packages/                         # built once (`npm run build:packages`) by the root postinstall
│   ├── shared-types/src/index.ts      # 4 k lines: EVERY API contract, enum, state machine,
│   │                                 # socket namespace/event/room helper
│   ├── validation/src/index.ts        # 2.5 k lines: Zod schemas for both API and clients +
│   │                                 # transition tables (trip status, attendance, emergency…)
│   ├── api-client/src/index.ts        # 2.5 k lines: fetch wrapper, CSRF bootstrap, single-flight
│   │                                 # refresh, 187 typed methods, managed-path remapping,
│   │                                 # multipart upload + blob download
│   ├── design-tokens/src/index.ts     # colors (amber 500 = #f59e0b bus yellow, slate neutrals,
│   │                                 # status colors), spacing, typography, radii, shadows
│   └── config/src/index.ts            # APP_CONFIG (name, ports 3001/3000/8081, api prefix),
│                                     # environment enum, default DB config
│
├── infrastructure/
│   ├── docker-compose.yml            # dev: postgis/postgis:16-3.4 + healthcheck + init.sql
│   ├── docker-compose.prod.yml       # prod: app + one-shot migrate + db (prepared, not deployed)
│   ├── Dockerfile                    # multi-stage prod image for web (build:packages → build:server
│   │                                 # → next build → slim runtime)
│   ├── .env.production.example       # placeholders only (real .env.production is git-ignored)
│   ├── postgres/init.sql             # CREATE EXTENSION postgis, uuid-ossp
│   └── README.md
│
├── scripts/
│   ├── backup-restore.sh             # local pg_dump/pg_restore: backup | restore | verify | list
│   ├── logo-assets.mjs               # sliver cleanup + 4x-supersampled renders of every logo PNG
│   └── ci-enable-postgis.mjs         # installs postgis + uuid-ossp into template1 for CI
│
├── .github/
│   ├── workflows/ci.yml              # 11 jobs, all required-gate-shaped
│   └── actions/setup-node-deps/      # composite: nvm + setup-node + npm ci with cache
│                                    # ⚠ every job must check out first (see comment in ci.yml)
└── docs/                             # 13 deep-dive documents (index in §22)
```

---

## 6. How a request flows (the architecture invariants)

```
Browser / phone
   │  http://host:3001            ← ONE origin: UI, /api/v1 and Socket.IO share the port
   ▼
web/server.js  (custom Node server — the only entrypoint, dev and prod alike)
   ├─ ensureServerBuild()          # verify/repair web/dist against src/server (or fail loudly)
   ├─ await bootstrapDatabase()    # addModels(...) + authenticate(); nothing may query before this
   ├─ resolveCorsPolicy(CORS_ORIGIN)
   ├─ next({ dev }) + app.prepare()
   ├─ createApiMiddlewareChain()   # CORS → compression → security headers → cookies → request-id
   │                               #   applied to /api/v1/* only; every other path → Next handle()
   ├─ new SocketIoServer(httpServer) → globalThis.__socketIoServer
   │                               # gateways are attached to it from instrumentation.ts, so they
   │                               # share the service singletons the route handlers use
   ├─ fail fast if any Sequelize model class is still detached
   ├─ startRetentionScheduler()    # one per process; stopped on SIGTERM/SIGINT
   └─ server.listen(port, hostname)

web/src/app/api/v1/<…>/route.ts    → export const GET = createRouteHandler(getXyz)
web/src/server/api/<module>.ts     → EndpointDefinition { roles, status, bodyType, queryType,
                                                        idempotency, rateLimit, handler }
web/src/server/http/route-runtime.ts  pipeline, in exactly this order:
   CSRF guard → RateLimit guard → JwtAuthGuard → RolesGuard
   → (ManagedSchoolGuard for /manage/*) → ValidationPipe(whitelist + transform, body & query)
   → DTO / uuid parsing → handler → audit → notifications & broadcasts → success envelope
web/src/server/modules/<x>/*.service.ts   # business rules, tenant-pinned queries, transactions
web/src/server/database/models/*.ts       # Sequelize models (paranoid, composite FKs)
```

Things that are load-bearing and easy to break (do **not** "simplify" these):

1. **One server, one port, one model registry.** The backend is not a separate app. `src/server` is
   compiled separately to CommonJS (`npm run build:server` → `web/dist`) and marked external in
   webpack, because decorator-driven Sequelize models have circular imports that webpack's ESM
   interop turns into TDZ errors. `next.config.js`, `server.js` and `instrumentation.ts` must keep
   pointing at that one output.
2. **Gateways are wired from `instrumentation.ts`**, not `server.js` — they must attach to the _same_
   service singletons the route handlers use, otherwise every REST-triggered broadcast silently goes
   nowhere. `globalThis` flags make dev hot-reload idempotent.
3. **`bootstrapDatabase()` must resolve before any handler or gateway runs** (model classes are
   static; until `addModels` runs every query throws `Model not initialized`). Hence the fail-fast
   check at boot.
4. **`api-middleware-chain.ts` is shared by production and the E2E harness** — so E2E can never
   drift from what actually ships.
5. **Rate limiting runs before authentication**, so it keys on IP (and on school+email for login),
   never on `request.user`.
6. **`CORS_ORIGIN` doubles as the CSRF origin allowlist**: a state-changing request whose `Origin`
   is not listed is `403`. It must match how you actually open the app (add your LAN IP for mobile).

---

## 7. Data model (PostgreSQL)

28 tables. Every tenant table: `id uuid` PK (v4), `created_at`, `updated_at`, `deleted_at`
(paranoid soft delete) from `BaseModel`, plus `school_id` and `UNIQUE (school_id, id)`.

| Group              | Tables                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| Tenancy & identity | `schools`, `users`, `refresh_tokens`, `device_tokens`                           |
| Transport network  | `buses`, `routes`, `stops`                                                      |
| Operating model    | `shifts`, `runs`, `run_crew`, `route_assignments` (frozen/deprecated writes)    |
| People             | `students`, `student_guardians`                                                 |
| Execution          | `trips`, `trip_student_attendance`, `trip_locations`, `trip_stop_arrivals`      |
| Comms & safety     | `notifications`, `emergency_events`                                             |
| Compliance         | `bus_documents`, `driver_documents`, `document_requirements`                    |
| Commercial         | `plans`, `school_subscriptions`                                                 |
| Platform ops       | `audit_logs`, `idempotency_keys`, `import_jobs`, `assisted_management_sessions` |

Key relationships: `schools 1—N` (almost everything); `routes 1—N stops` (ordered) and `1—N runs`;
`runs 1—N run_crew`, `1—N trips`, `1—N students`; `students N—1 stops` (`home_stop_id`) and
`N—N users` via `student_guardians`; `buses 1—N bus_documents`, `users 1—N driver_documents`;
`trips 1—N trip_locations / trip_student_attendance / trip_stop_arrivals`;
`schools 1—0..1 school_subscriptions N—1 plans`.

Notable constraints (all enforced in SQL, not only in code): composite `(school_id, x_id)` FKs;
`uq_users_school_email`; `uq_trips_run_scheduled_start` and `uq_trips_route_scheduled_start`
(partial, `deleted_at IS NULL`); `uq_runs_route_default`; `uq_runs_school_code`;
`uq_shifts_school_name`; `ck_shifts_window (end_time > start_time)`; `uq_route_assignments_route_user_role`.
`ON DELETE` is `CASCADE` for owned children, `SET NULL` for optional references — and composite
`SET NULL` actions were deliberately relaxed to `NO ACTION` in
`20260906130000-composite-set-null-to-no-action.ts` for correctness.

Enums live in `@school-bus-tracking/shared-types` and are re-exported by
`web/src/server/database/models/enums.ts` — **the values are never re-declared**; the `*_VALUES`
arrays are the source of truth for the PostgreSQL enum types (migrations repeat the literals on
purpose, because a migration is an immutable record of a released schema).

---

## 8. API surface (`/api/v1`, 159 route files)

Response envelope everywhere JSON: `ApiResponse<T> = { success, message, data, meta?, timestamp }`;
errors use the same envelope with `error` + field `details`. File downloads bypass the envelope and
stream (`Content-Disposition`, `nosniff`, `no-store`, `X-Total-Records`).

| Area            | Endpoints (all under `/api/v1`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infra           | `GET /health` · `GET /health/ready`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Auth            | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/csrf` (plus dev-only `/auth-test/*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Tenancy         | `POST /schools` — atomic tenant + first-`SCHOOL_ADMIN` onboarding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Fleet           | `GET` / `POST` `/buses` · `GET` / `PATCH` / `DELETE` `/buses/:busId` · `GET /buses/:busId/runs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Network         | `GET` / `POST` `/routes` · `GET` / `PATCH` / `DELETE` `/routes/:id` · `GET /routes/:id/details` · `GET` / `PUT` `/routes/:id/stops` (ordered reorder) · `GET` / `POST` `/routes/:id/runs` · `GET` / `POST` `/stops` · `GET` / `PATCH` / `DELETE` `/stops/:id`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Operating model | `GET` / `POST` `/shifts` and `/shifts/:id` (+ PATCH, DELETE) · `GET` / `POST` `/runs` · `/runs/:id` (+ PATCH, DELETE) · `GET` / `POST` `/runs/:id/crew` · `GET` / `PATCH` / `DELETE` `/run-crew/:id` · `GET /users/:userId/run-crew` · `GET` / `PATCH` / `DELETE` `/route-assignments[/:id]` (declared writes respond `410 Gone` with `Deprecation` headers) · `GET` / `POST` `/assignments` · `GET` / `PATCH` / `DELETE` `/assignments/:id`                                                                                                                                                                                                                                    |
| People          | `GET` / `POST` `/students` · `GET` / `PATCH` / `DELETE` `/students/:studentId` · `GET` / `POST` / `PATCH` / `DELETE` `/students/:studentId/guardians[/:parentId]` · `GET` / `POST` `/parents` · `/parents/:parentId/students[/:studentId]` · `GET /parents/me/students` · `GET` / `POST` `/drivers` · `/drivers/:driverId` · `GET` / `POST` `/conductors` · `/conductors/:id`                                                                                                                                                                                                                                                                                                   |
| Trips           | `GET` / `POST` `/trips` · `GET` / `PATCH` / `DELETE` `/trips/:tripId` · `PATCH /trips/:tripId/status` · `POST /trips/:tripId/cancel` · `GET /trips/:tripId/students` (manifest + summary) · `GET /trips/:tripId/students/:studentId` · `POST .../board` · `POST .../drop`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tracking / ETA  | `POST` / `GET` `/trips/:tripId/location` · `GET /trips/:tripId/location/history` · `GET /trips/:tripId/eta` · `GET /trips/:tripId/arrivals` · `GET /trips/:tripId/progress` · `POST /trips/:tripId/stops/:stopId/arrive` · `POST /trips/:tripId/stops/:stopId/skip` (crew stop marking)                                                                                                                                                                                                                                                                                                                                                                                         |
| Parent portal   | `GET /parent/dashboard` · `GET /parent/children` · `GET /parent/children/:id` · `.../today` · `.../tracking` · `GET /parent/notifications` · `PATCH /parent/notifications/:id/read` · `PATCH /parent/notifications/read-all`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Notifications   | `POST /notifications/devices` · `DELETE /notifications/devices/:token`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Emergencies     | `POST /emergencies/sos` · `GET /emergencies` · `GET /emergencies/active` · `GET /emergencies/mine` · `GET /emergencies/:id` · `PATCH /emergencies/:id/status` · `POST /emergencies/:id/cancel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Documents       | `GET` / `POST` `/buses/:busId/documents` · `PATCH` / `DELETE` `.../documents/:id` · `GET .../documents/compliance` · the same three under `/drivers/:driverId` · `GET /documents/overview` · `GET` / `PUT` `/document-requirements`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Data transfer   | `GET /imports/modules` · `GET /imports/:module/template` · `POST /imports/:module/validate` · `POST /imports/:module/commit` · `GET /imports/history[/:id]` · `GET /imports/history/:id/error-file` · `GET /exports` · `GET /exports/:dataset` · `GET /reports` · `GET /reports/overview` · `GET /reports/:report` · `GET /reports/:report/export`                                                                                                                                                                                                                                                                                                                              |
| Audit           | `GET /audit-logs` (Super Admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Super Admin     | `GET /admin/dashboard` · `GET` / `POST` `/admin/schools` · `/admin/schools/:schoolId` (+ `/activate`, `/deactivate`, `/subscription`, `/subscription/cancel`, `/subscription/history`) · `/admin/schools/:schoolId/admins[/:adminId]` (+ `/activate`, `/deactivate`, `/reset-password`) · `GET` / `POST` `/admin/plans` · `/admin/plans/:id` (+ `/activate`, `/deactivate`) · `GET /admin/subscriptions` · `GET /audit-logs` · `/admin/schools/:schoolId/manage/**` — assisted management: `session` (+ `/current`, `/end`) and CRUD over students, parents, buses, routes, stops, drivers, conductors, route-assignments, shifts, runs, run-crew, imports, exports and reports |

AuthZ per endpoint is declared in `web/src/server/api/<module>.ts` (`roles: [...]`); `@Roles` is the
real boundary. Client-side nav guards are UX only.

---

## 9. Realtime contract

| Namespace        | Rooms (built server-side only) | Events                                                                                                                                                                                     |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/live-tracking` | `trip:<tripId>`                | `tracking:join` / `tracking:leave` (+ ack `denial_reason`), `trip:location:update` (crew → room), `trip:tracking:started`, `trip:tracking:stopped`, `trip:stop:arrived`, `trip:eta:update` |
| `/notifications` | `notification:user:<userId>`   | `notification:new`                                                                                                                                                                         |
| `/emergencies`   | school room for the tenant     | `emergency:new`, `emergency:updated`                                                                                                                                                       |
| all              | —                              | `session:revoked` (revalidation sweeper)                                                                                                                                                   |

Handshake runs the same JWT verification as HTTP (`web/src/services/socket-auth.ts`,
`mobile/src/services/socket-auth.ts`), plus tenant/user activation checks. Namespace + event + room
constants come from `packages/shared-types` (`LIVE_TRACKING_NAMESPACE`, `LIVE_TRACKING_EVENTS`,
`liveTrackingRoomName()`, `notificationRoomName()`, …) so client and server cannot drift.
Socket option builder: `mobile/src/services/socket-options.ts`, `web/src/services/socket-registry.ts`
(one shared socket per namespace, auto-reconnect + re-auth).

---

## 10. Auth, RBAC, tenancy and security

- **Access token**: JWT, default 15 m (`JWT_EXPIRES_IN`), claims `{ sub, school_id, role, exp }`,
  held in **memory only** on clients (never AsyncStorage/localStorage).
- **Refresh token**: opaque, hashed at rest in `refresh_tokens`, default 7 d (`JWT_REFRESH_EXPIRES_IN`),
  delivered as httpOnly cookie `refresh_token` scoped `Path=/api/v1/auth`, **rotated on every use**;
  a replayed/stale token is rejected with `401 revoked` even if the session is alive.
  A readable, secret-free `sb_session` marker cookie tells a fresh tab that a refresh is worth
  trying (it is _not_ cleared on a rotation conflict, which would log every tab out).
- **Single-flight refresh** in `packages/api-client`: StrictMode's double effect and every 401 retry
  share one in-flight `POST /auth/refresh`.
- **CSRF**: double-submit — `GET /auth/csrf` seeds readable `csrf_token`; unsafe, cookie-authenticated
  requests must echo it in `X-CSRF-Token`. Order in `evaluateCsrf`: safe method → allow; no `Origin`
  (native/curl) → allow; unknown `Origin` → 403; `Authorization: Bearer` → allow; ambient refresh
  cookie → token required. The client re-seeds **once** and replays on a 403.
- **Passwords**: bcrypt cost 12 (`BCRYPT_COST_FACTOR`), never serialized, never logged;
  `password_hash` excluded from every response contract.
- **RBAC** via `RolesGuard` + `@Roles(...)`; **tenant scoping** inside every service
  (`where: { school_id }` from the JWT); **plan-limit** and **subscription** checks in
  `PlanLimitsService` / `assertSubscriptionAllows`; **inactive tenant** blocked centrally.
- **Websocket security**: JWT handshake + periodic revalidation (§3.15).
- **CORS**: allowlist from `CORS_ORIGIN` (echoes the exact origin, `credentials: true`, no wildcard
  in production). `helmet`-style headers hand-built in `security-headers.js`; Next's `headers()` also
  applies to `/:path*` in production (layered, never weakened).
- **CSP & maps**: `next/image` is switched **off** (`images.unoptimized`) because the app renders
  none — that removes the whole `/_next/image` attack surface (Next 14.2.x cannot take the 15.5.21+/
  16.x image fixes without a React 19 migration). The map CSP pins `https://tiles.openfreemap.org`
  in both `img-src` and `connect-src` plus `worker-src blob:` for the MapLibre worker (see
  `web/security-headers.js` and `docs/deployment.md` → CSP). Extra origins go through
  `CSP_EXTRA_IMG_SRC` / `CSP_EXTRA_CONNECT_SRC`.
- **Data protection**: audit payloads and logs redact secrets; medical notes are treated as
  sensitive and excluded from exports; document files are served through the API (no public dir)
  with hard extension/size checks and UUID filenames.
- **Dependency security**: `package.json` `overrides` pin `lodash ^4.17.24` and `postcss 8.5.28`.
- **Crew mobile login** (DRIVER / CONDUCTOR): a **school code + 4-digit PIN** — no user id, no
  email, scanner, or pasted pairing code (`POST /auth/crew-login`). PIN is the only mobile crew
  login method. The server resolves which
  crew member a PIN belongs to, so PINs are **unique per school** (`setPin` refuses a duplicate
  with `CREW_PIN_DUPLICATE`; a login that still matches two accounts is rejected with
  `CREW_PIN_AMBIGUOUS` rather than guessed at). The PIN path is gated by a **school-wide** lockout
  (`crew-pin-attempts.ts`: 5 attempts per 15-minute window, 15-minute lockout, single-process
  counter — a per-user key cannot bound a sweep of distinct PINs now that the body names no user)
  layered under the `auth_crew_login` rate policy (10 req / 60 s per IP and per submitted school).
  Each attempt runs a **fixed 8 bcrypt comparisons** (`CREW_PIN_COMPARISON_COUNT`, padded with
  `PIN_TIMING_EQUALIZATION_HASH`) so response time cannot reveal whether a match was found.
  QR pairing remains a **dormant, optional admin capability**, not a driver-facing flow; the
  admin staff panel and server QR endpoints are retained. Pairing codes are PostgreSQL-backed,
  single-use and short-lived (5 min default TTL) and survive a restart. `pin_hash` is bcrypt cost 12 and **never returned by any API** — an administrator who
  has lost a PIN must set a new one. Setting, resetting or clearing any PIN at a school, or a
  successful QR login via the dormant server capability, **clears that school's lockout**.
  Mobile drivers wait for expiry or ask an admin to reset their PIN. Exact policy,
  and the **single-instance caveat** (effective allowance is `N × maxAttempts` per window behind a
  load balancer; a restart clears the counter mid-window), are documented rather than hidden — see
  `docs/security.md` → "Crew PIN Brute Force".
- Full details: `docs/security.md` (incl. the **move-to-multi-instance checklist**).

---

## 11. Subscriptions & plan limits

Two separate questions, deliberately not conflated (`docs/subscriptions.md`):

1. **Lifecycle status** stored in `school_subscriptions.status` — `trialing`, `active`, `past_due`,
   `cancelled`, `expired` (operator-set from the Super Admin console; no billing integration exists,
   and `none` is a projection for "no row", never a stored value).
2. **Access eligibility right now**, derived on every request by
   `resolveSubscriptionEntitlement(subscription, now)` in
   `web/src/server/common/subscriptions/subscription-access.ts` — the **single source of truth**,
   end-exclusive boundaries, compared on absolute epoch milliseconds (timezone-proof).
   `trialing` live until `trial_end`; `active` until `current_period_end`; `past_due` keeps access
   only inside a configurable grace window (`SUBSCRIPTION_PAST_DUE_GRACE_DAYS`, default 7 — `0`
   means no grace); `cancelled`/`expired` never do; a missing row is `none`.
   `SUBSCRIPTION_ENFORCE_LAPSED_ACCESS=false` is the migration escape hatch (lapse then only affects
   reporting) and defaults to enforced. Note the stale name `SUBSCRIPTION_GRACE_PERIOD_DAYS` in
   `web/.env.example` / `docs/deployment.md` is **not read by any code** — the two names above are.

At most **one live subscription per school** (`trialing`/`active`/`past_due`) is enforced by the
partial unique index `uq_school_subscriptions_live_school`, so two concurrent "assign plan" requests
cannot both win (`ck_school_subscriptions_status_not_none` also keeps `none` out of the column).
Changing plans closes the old row as `expired` and inserts a new one — history is never destroyed —
and `plan_id` is `ON DELETE RESTRICT`. The stored status is **repaired lazily** when
`AdminSubscriptionsService` reads an elapsed live row (best-effort write-back, which also frees the
single live slot); there is no cron for it.

**Plan limits** (`PlanLimitsService`): per-plan JSON `{ resource: { unlimited, value } }` over
`PlanLimitResource` (`students, buses, routes, stops, drivers, conductors, staff, parents, trips,
runs`), usage counted as active non-deleted rows. Exceeding a quota raises `409`
`PLAN_LIMIT_REACHED` with `{ resource, limit, usage }`; a lapsed window raises
`SubscriptionLapsedException` (also `409`) from `assertSubscriptionAllows` — never a generic 500.
Creation reserves the quota **inside the same transaction under a PostgreSQL advisory lock** so two
concurrent creates cannot both pass, and bulk imports pre-check the whole batch
(`runWithinBulkLimit`). Feature flags (`PlanFeature`) gate optional capabilities, stored as JSON so
adding one needs no migration.

---

## 12. Mobile app specifics

- **API base URL resolution** (`mobile/src/services/api.ts` + `api-env.ts`):
  `EXPO_PUBLIC_API_URL` (must include `/api/v1`) wins; in dev the host is derived from the Metro
  dev-server host so a phone on the same Wi-Fi needs zero config; Android emulator falls back to
  `10.0.2.2`, iOS sim/web to `localhost` (`EXPO_PUBLIC_API_PORT`, default 3001). A standalone build
  without the variable shows a configuration error on the login screen **by design** — no silent
  localhost fallback. Against a `NODE_ENV=production` API the URL must be **HTTPS** (the refresh
  cookie is `Secure; SameSite=None`).
- **GPS**: `expo-location` `watchPositionAsync` in foreground, plus an opt-in background task
  (`startLocationUpdatesAsync` + `expo-task-manager`, name persisted with the active trip id so a
  headless task knows which trip to stamp). Permissions and background location are declared in
  `app.json`. Fixes are validated with the shared Zod schema and emitted over `/live-tracking`;
  invalid ones are dropped. `GpsPermissionRecovery` explains and repairs denied/permanently-denied
  permission, disabled services, missing background permission and battery-optimisation cases.
  The trip screen's GPS strip makes a **refused start visible** — the reason on a second line and
  the tap becomes the failing cause's own repair (Open location settings / Ask for location
  permission / Retry; `gps-strip-action.ts`). Background sharing runs only in development builds —
  the background task cannot run in Expo Go, and the app says so instead of pretending.
- **Offline attendance** (`features/crew/offline/`): a durable local queue (AsyncStorage) keyed to
  the signed-in user id — one entry per action with its own idempotency key and captured timestamp,
  states `pending → syncing → success | failed`, exponential backoff on reconnect, and `409`
  (already boarded/dropped) treated as success. `OfflineSyncBanner` shows the queue depth; the sync
  manager lives exactly as long as the crew session (bound to the user id, so a second account on
  the same phone never submits another's pending actions). GPS is **never** queued or replayed.
  Covered by a real simulation suite (`test:offline-sim`).
- **Push**: see §3.9 — requires an EAS dev/production build, not Expo Go; `google-services.json` +
  `eas.json` profiles are in the repo.
- **Expo Go compatibility**: `scripts/verify-expo-sdk.mjs` (run by `prestart`/`preandroid`/`preios`)
  fails loudly if the project's SDK line and the version policy diverge — Expo Go only opens
  projects on its own SDK line. `npm --prefix mobile start` therefore execs
  `expo start --go` with `EXPO_NO_REDIRECT_PAGE=1` (the workspace installs `expo-dev-client`, which
  otherwise changes what the QR code encodes). Policy + verified matrix: `docs/mobile-expo-sdk.md`.
  Expo Go's other limits are runtime facts the app detects
  (`src/lib/runtime-environment.ts`): it cannot run the background location task (background
  sharing is gated with a one-line explanation) and it does not carry the custom MapLibre map
  engine on any platform (the map surfaces show a labelled development-build panel instead of a
  blank map). The build-time warning for `google-services.json` is aimed at the same boundary —
  it prints only for native Android builds, exactly once (`app.config.js` →
  `isNativeAndroidBuild` / `warnOnce`, spec-pinned).
- **UX contracts**: `loading` vs `refreshing` are separate signals — background revalidation and
  token refresh must **never** show a spinner over a working screen; safe-area-aware bottom bar
  metrics computed in `src/theme/bottom-bar-metrics.ts`; keyboard-aware form scrolling
  (`lib/keyboard-aware.ts`); pull-to-refresh on every list; server reasons surfaced for
  `401/403/409/429/5xx`; `RoleGate` mirrors the API guards.
- **Legibility system** (driver/conductor-first): mobile-only semantic aliases over the shared
  design tokens live in `mobile/src/theme/tokens.ts` — 16px body floor, 24–28px bold numerics,
  56/64px touch targets, and WCAG-AA action surfaces (e.g. white on `primary[700]` = 5.02:1).
  The ratios are pinned by `src/theme/contrast.spec.ts` and the "no text under 16px on crew
  surfaces / 14px anywhere" rule by `src/theme/legibility.spec.ts`, both under
  `npm --prefix mobile test`. Details + the measured contrast table: `docs/mobile-ux.md`.
- **Crew screens are "one job, one screen" (Phase 2)**: the trip tab leads with a giant status
  card whose background colour _is_ the state (BOARDING green / ON THE ROAD amber / settled grey,
  mapping pinned by `trip-status-style.spec.ts`), shows next stop + ETA at 24px and exactly one
  64px primary action; metadata hides in a collapsible "More details". The driver's GPS row is
  only `Sharing ✅/❌` + last update + one tap (Share GPS / Stop, or — after a refused start — the
  failing cause's own repair: Open location settings / Ask for location permission / Retry, with
  the reason on a second line) — the telemetry counters live on the hidden **Help & support** tab
  (`app/(crew)/help.tsx`, move guarded by `help-routing.spec.ts`), below which an always-available
  **Diagnostics (for support)** card reports runtime, API host, socket, connection, permissions,
  what is sharing, last stop + recovery + last error, and the delivery counters (server words
  verbatim; no token can reach a row — spec-pinned). The crew tracking lifecycle publishes
  **only real changes** (no-op
  patches are silent) and `GpsPermissionRecovery` keys its OS check on primitives, never on the
  `sharing` binding — the "Maximum update depth exceeded" render loop on the Help screen is pinned
  closed by `gps-permission-recovery-wiring.spec.ts` + `tracking-recovery.sim.spec.ts` (#29).
  SOS is **hold-to-confirm** (~0.9s, single-fire, same idempotency key per alert, offline shows
  "queued ⏳" with an automatic same-key retry); manifest rows are full-row tap targets with a
  60px ✓/✕, a green success flash and an inline "Name ✓ time". All Phase-2 copy is centralized
  in `src/features/crew/crew-copy.ts` as the Phase-3 i18n plug point. Presentation only — API
  contracts, the offline queue, GPS sharing, sockets and session logic are untouched
  (full map: `docs/mobile-ux.md` → Phase 2).
- **Localisation (Phase 3a)**: a dependency-free typed i18n layer in `mobile/src/lib/i18n.ts` with
  `en` (source of truth) + `hi` + `mr` dictionaries — **423 keys**, key-set
  equality enforced at compile
  time _and_ by `i18n-parity.spec.ts` (**0 missing / 0 extra**, no empty values, identical
  `{placeholder}` sets). A key typo or a wrong interpolation param is a **compile error**
  (`ParamsFor` is inferred from each template's placeholders). Resolution order: **saved
  preference → role default (crew = English, admin/parent = device locale) → `en`**; the
  device locale is read from `Intl` / `NativeModules.I18nManager` (**no `expo-localization`,
  zero new dependencies**). The switch lives on the login screen (a row of self-naming pills)
  and the Help & support screen, applies instantly (no restart) and persists in AsyncStorage
  under `sbt.mobile.locale`.
  **Two classes of string are deliberately never translated**: data (student/route/stop/school
  names) and server-supplied English (API error messages, `EMERGENCY_TYPE_LABELS`, the GPS support
  counters and the diagnostics counter words — `LOCALE_INVARIANT_KEYS`). A **known** server error
  code maps to local copy via `localizeApiError`; an
  **unknown** one is shown as-is with its raw code visible. Every locale's length is
  guarded by a per-key character budget (`i18n-budget.ts`, 46 keys) and hardcoded English UI
  copy on crew surfaces is
  blocked by a source-scanning spec (`i18n-literals.spec.ts`) — boundary + guards documented in
  `docs/mobile-ux.md` → Phase 3.
- **Voice feedback + haptics (Phase 3b)**: a confirmed action is reported on a fourth channel —
  the phone **speaks it and buzzes** — for the driver who is holding the phone at arm's length in
  a loud bus and cannot read the screen. Two dependencies only (`expo-speech`, `expo-haptics`, both
  `~57.0.2`, Expo-Go compatible, no `app.json` change). Every surface calls one entry point,
  `feedback.on({ type: … })`, and the dispatcher decides the phrase and the pattern; speech is
  **never awaited and never fails an action**, so a phone with no TTS engine records a boarding
  exactly like a healthy one. Voice lines are **Latin script in every locale** — Hinglish
  (_"Ramesh ka boarding ho gaya, 7:42 subah"_) and Marathi-in-Latin (_"Ramesh bas madhe aaun
  gele, 7:42 subah"_) — in their own `voice.*` namespace while the screen stays in native
  script (Devanagari for both Hindi and Marathi) — budget Androids often have no `hi-IN`/`mr-IN`
  voice, and native script sent to an English engine is noise.
  A latest-wins throttle collapses a burst (measured: **40 rapid boards → 3 announcements**, pending
  depth 1, never a queue), and a spec-enforced deny-list keeps medical notes, phone numbers,
  guardian contacts and admission numbers out of anything spoken aloud on a public bus. Voice and
  vibration are two independent switches on Help & support, persisted under `sbt.mobile.sound`,
  defaulting on for crew and voice-off for admin/parent. Full matrix: `docs/mobile-ux.md` → Phase 3b.
- **Metro monorepo resolution**: `watchFolders` = repo root, `nodeModulesPaths` =
  `mobile/node_modules` then root — nested `node_modules` lookup stays enabled on purpose (disabling
  it breaks transitive deps).

---

## 13. Running it locally

```bash
# 0. Node 22 (see .nvmrc), npm workspaces
nvm use

# 1. Database (PostgreSQL 16 + PostGIS 3.4)
cd infrastructure && docker compose up -d postgres && cd ..

# 2. Install (root `postinstall` builds every shared package)
npm install

# 3. Env
cp web/.env.example web/.env                # set JWT_SECRET, CORS_ORIGIN, DB_*

# 4. Schema + demo data
npm run db:setup                            # = web: db:migrate && db:seed
npm run db:refresh                          # undo:all then setup

# 5. Start the unified server → http://localhost:3001  (UI + /api/v1 + Socket.IO)
npm --prefix web run dev

# 6. Mobile (from repo root, with the API reachable from the phone)
npm --prefix mobile start                   # then scan with Expo Go
```

`CORS_ORIGIN` must equal the origin you open the app from (add your LAN IP, e.g.
`http://192.168.1.20:3001`, for the phone). Build the API bundle explicitly when you touch
`src/server` and run `next start`-style flows: `npm --prefix web run build:server`.

**Seeded demo logins** — school users sign in with their **school code** + email + password; the
platform admin leaves the school field blank. The four-school seeder uses _password = email_; the
older `demo-core-domain-data` seeder intentionally leaves `password_hash` null (those accounts
cannot log in).

| Role         | School code          | Email                        | Password               |
| ------------ | -------------------- | ---------------------------- | ---------------------- |
| SUPER_ADMIN  | _(blank)_            | `superadmin@gmail.com`       | `superadmin@gmail.com` |
| SCHOOL_ADMIN | `green-valley`       | `green@gmail.com`            | `green@gmail.com`      |
| SCHOOL_ADMIN | `riverside-public`   | `riverside@gmail.com`        | `riverside@gmail.com`  |
| SCHOOL_ADMIN | `oakwood-academy`    | `oakwood@gmail.com`          | `oakwood@gmail.com`    |
| SCHOOL_ADMIN | `maple-leaf-central` | `maple@gmail.com`            | `maple@gmail.com`      |
| DRIVER       | e.g. `green-valley`  | `driver1.green@gmail.com`    | same as email          |
| CONDUCTOR    | e.g. `green-valley`  | `conductor1.green@gmail.com` | same as email          |
| PARENT       | e.g. `green-valley`  | `parent1.green@gmail.com`    | same as email          |

(The `<slug>` in staff/parent emails is the first segment of the school code: `green`, `riverside`,
`oakwood`, `maple`.) Seeded graph per school: 3 buses, 3 routes (`<prefix>-R-01` "North Loop —
Morning Pickup", `<prefix>-R-02` "East Corridor — Afternoon Drop", `<prefix>-R-03`) with 5 stops
each, one default **run** per route carrying a shift, a bus and driver+conductor crew (the run code
matches the route code verbatim, so "bus `<code>`" means the same thing to a parent before and after
the operating-model migration), 52 students, 26 parents, 3 drivers, 3 conductors, a subscription on one of 4 plans
(`basic-monthly`, `growth-monthly`, `pro-monthly`, `enterprise-yearly`), shifts + runs + run crew,
today's trips in several states, attendance rows, GPS breadcrumbs, stop arrivals, bus/driver
documents + requirements, resolved/acknowledged emergencies, parent notifications and import-job
history. Seeders are idempotent (`ON CONFLICT DO NOTHING`), refuse to run in production, and use
deterministic **valid v4** UUIDs (`00000000-0000-4000-8000-<school><type><item>` — the variant
nibble matters, see the comment in the seeder).

---

## 14. Commands

Root (`package.json`):

| Command                                                      | What it does                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm run build:packages`                                     | Build `shared-types → design-tokens → config → validation → api-client` (order matters) |
| `npm run build:apps` / `npm run build`                       | Web (`build:server` + `next build`) and mobile typecheck bundle                         |
| `npm run typecheck`                                          | Build packages, then `tsc --noEmit` in every workspace that defines it                  |
| `npm test`                                                   | Build packages, then `web` + `mobile` unit suites                                       |
| `npm run lint` / `lint:fix`                                  | ESLint over the whole repo, `--max-warnings 0`                                          |
| `npm run format` / `format:check`                            | Prettier                                                                                |
| `npm run db:migrate` / `db:seed` / `db:setup` / `db:refresh` | Sequelize CLI via `web`                                                                 |
| `npm run clean`                                              | Remove `dist`, `.next`, `.expo`, package outputs                                        |

`web` (from repo root: `npm --prefix web run <script>`): `dev`, `build`, `start`,
`typecheck`, `typecheck:server`, `test`, `test:server`, `test:web`, `test:integration`, `test:e2e`,
`test:db`, `test:documents`, `test:emergency`, `db:migrate[:status|:undo[:all]]`, `db:seed[:undo]`,
`migration:create NAME`, `seeder:create NAME`, `build:server`, `smoke:admin`, `smoke:parent`,
`smoke:documents`, `smoke:emergency`, `smoke:notifications`, `smoke:eta`, `smoke:manage-data`,
`smoke:seed-uuids`.

`mobile`: `start`, `start:go`, `start:tunnel`, `start:dev-client`, `android`, `ios`, `web`,
`build` (typecheck), `typecheck`, `test`, `test:sim` (`test:offline-sim` + `test:push-sim`),
`prebuild`, `android:build`, `ios:build`, `doctor`, `verify:sdk`, `clean`.

Root helpers: `./scripts/backup-restore.sh backup|restore|verify|list` (see `docs/backup-restore.md`).

---

## 15. Environment variables (template: `web/.env.example`)

| Group                  | Variables                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App                    | `NODE_ENV`, `PORT` (3001), `HOST` (0.0.0.0), `API_PREFIX` (`api/v1`), `CORS_ORIGIN`                                                                                                                                                                                                             |
| Database               | `DB_DIALECT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_NAME_TEST`, `DB_USERNAME`, `DB_PASSWORD`, `DB_SSL`, `DB_LOGGING`, `DB_POOL_MAX/MIN/ACQUIRE/IDLE`, `DB_AUTO_CONNECT`, `DB_ALLOW_NO_CONNECT` (test/smoke only)                                                                                 |
| Auth                   | `JWT_SECRET` (required in prod), `JWT_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (7d), `REFRESH_TOKEN_COOKIE_NAME`                                                                                                                                                                             |
| Security               | `SECURITY_IS_PRODUCTION`, `SECURITY_HEADERS_ENABLED`, `SECURITY_HSTS_MAX_AGE`, `SECURITY_CSRF_ENABLED`/`CSRF_ENABLED`, `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME`, `CSP_EXTRA_IMG_SRC`, `CSP_EXTRA_CONNECT_SRC`                                                                                     |
| Rate limit             | `RATE_LIMIT_{AUTH_LOGIN,AUTH_REFRESH,READ_HEAVY,DEVICE_REGISTER,SOS_CREATE,ATTENDANCE_WRITE,LOCATION_READ,DATA_IMPORT,DATA_EXPORT,REPORT_READ,PASSWORD_RESET,AUTH_LOGOUT}_LIMIT` (+ `_WINDOW_MS`), `RATE_LIMIT_STORE` (`memory`; `redis` fails fast), `RATE_LIMIT_TRUST_PROXY`                  |
| Compression            | `COMPRESSION_ENABLED`, `COMPRESSION_THRESHOLD_BYTES`                                                                                                                                                                                                                                            |
| ETA                    | `ETA_FALLBACK_SPEED_KMH`, `ETA_MIN_SPEED_KMH`, `ETA_MAX_SPEED_KMH`                                                                                                                                                                                                                              |
| Retention              | `LOCATION_RETENTION_DAYS` 90, `NOTIFICATION_RETENTION_DAYS` 180, `REFRESH_TOKEN_RETENTION_DAYS` 30, `AUDIT_LOG_RETENTION_DAYS` 365, `EMERGENCY_RETENTION_DAYS` 730, `IDEMPOTENCY_KEY_RETENTION_DAYS` 7, `RETENTION_ENABLED`, `RETENTION_INTERVAL_MS` (6 h), `RETENTION_INITIAL_DELAY_MS` (30 s) |
| Idempotency / realtime | `IDEMPOTENCY_TTL_HOURS` 24, `WEBSOCKET_SESSION_REVALIDATION_ENABLED`, `WEBSOCKET_SESSION_REVALIDATION_INTERVAL_MS` 300000                                                                                                                                                                       |
| Subscriptions          | `SUBSCRIPTION_PAST_DUE_GRACE_DAYS` (7), `SUBSCRIPTION_ENFORCE_LAPSED_ACCESS` (true). `SUBSCRIPTION_GRACE_PERIOD_DAYS` appears in the env template but is dead — nothing reads it                                                                                                                |
| Push                   | `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` (both empty ⇒ no-op provider; never logged)                                                                                                                                                                                              |
| Future                 | `EMAIL_PROVIDER`, `SMS_PROVIDER` (noop)                                                                                                                                                                                                                                                         |
| Seeding                | `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (mandatory in production to seed the platform admin)                                                                                                                                                                                                |
| Mobile                 | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_API_PORT`, `EXPO_PUBLIC_MAP_STYLE_URL` (optional, https-only — a self-hosted OpenFreeMap style; the map needs no key)                                                                                                                                       |
| Web map                | `NEXT_PUBLIC_MAP_STYLE_URL` (optional, https-only — same contract as mobile; `web/src/features/map/map-style.ts` `resolveMapStyleUrl(env)` falls back to `https://tiles.openfreemap.org/styles/bright`)                                                                                         |

Production refuses to boot without `JWT_SECRET` and with `DB_SSL` unset (`docs/deployment.md`).
Real `.env`/`.env.production` files are git-ignored; only `.env.example` files are committed.

---

## 16. Testing

Runner is **`node --test`** everywhere (no Jest, no Vitest, no Cypress). Specs are colocated
(`*.spec.ts` next to the code) plus `web/test/integration` and `web/test/e2e`.

- **Server unit** — `npm --prefix web run test:server`: services, guards, DTOs, middleware, rate
  limiter, retention worker/scheduler, revalidation sweeper, gateways; run through
  `ts-node/register/transpile-only` with `tsconfig.server.json`.
- **Web unit** — `test:web`: pure client helpers (cache, CSRF, error mapping, metrics, nav,
  emergency alarm state machine) via `node --experimental-strip-types`.
- **Mobile unit** — `npm --prefix mobile test`: pure modules (geo, runs, reports, paged query,
  crew trip logic, notification state, push registration, socket auth, idempotency, theme metrics).
- **Mobile simulations** — `npm --prefix mobile run test:sim`: offline-queue replay and push
  lifecycle, using `--experimental-test-module-mocks` plus a custom native-stub loader.
- **Integration (real PostgreSQL)** — `web/test/integration`: migrations round-trip, tenant
  isolation, plan limits, subscriptions (+ edge cases), run conflicts, attendance, retention SQL,
  constraints, runs backfill, assisted management.
- **E2E (real HTTP, real PostgreSQL)** — `web/test/e2e`: starts `src/server/http/test-server.ts`
  which mounts **the same middleware chain `server.js` mounts**, so CORS/CSRF/security
  headers/compression/request-id/health/rate-limit/cross-tenant/multi-school behaviour is verified on
  the production pipeline.
- **Smoke scripts** (`web/scripts/smoke/smoke-*.ts`) — DB-less end-to-end checks of admin, parent,
  documents, emergency, notifications, ETA/arrivals, manage-data and seed UUID validity; they run
  with `DB_AUTO_CONNECT=false DB_ALLOW_NO_CONNECT=true`.
- DB suites need a running Postgres; they use `DB_NAME_TEST`/`TEST_DB_*`
  (`postgres://postgres:postgres@localhost:5432/school_bus_tracking_test`) and
  `--test-concurrency=1` on purpose.
- Test-support utilities: `web/test/support/{app,auth,database,env,fixtures,http,routes}.ts`
  (`prepareDatabase()`, `truncateAll()`, `startTestApp()`, `login(baseUrl, schoolCode, email)`,
  `httpRequest(...)`).

Conventions: `describe`/`it` with plain `node:assert`; contract specs assert **exact** response
keys and enum values; new endpoint ⇒ `api-client` + `shared-types` + Zod + service + spec together.

---

## 17. CI/CD (`.github/workflows/ci.yml`)

Triggers: `pull_request` and `push` to `main`; concurrency group cancels in-progress runs;
`permissions: contents: read`. Each gate is a **separate job** so it can be marked required.

| Job                  | Command                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                 | `npm run lint`                                                                                                                           |
| Workspace typecheck  | `npm run typecheck`                                                                                                                      |
| Server typecheck     | `npm --prefix web run typecheck:server`                                                                                                  |
| Server tests         | `npm --prefix web run test:server`                                                                                                       |
| Web tests            | `npm --prefix web run test:web`                                                                                                          |
| Mobile tests         | `npm --prefix mobile test`                                                                                                               |
| Mobile simulations   | `npm --prefix mobile run test:sim`                                                                                                       |
| DB integration / E2E | `npm --prefix web run test:db` on a `postgis/postgis:16-3.4` service container (extensions installed by `scripts/ci-enable-postgis.mjs`) |
| Web production build | `npm --prefix web run build`                                                                                                             |
| Android Expo export  | `cd mobile && npx expo export --platform android` (Metro bundles every route, no device)                                                 |
| Docker image build   | `docker build -f infrastructure/Dockerfile .` + validates `docker-compose.prod.yml`                                                      |

⚠️ Every job must run `actions/checkout` **before** the composite
`.github/actions/setup-node-deps` action (composite actions can't check the repo out themselves).
The workflow file says this inline — do not "streamline" it away.

---

## 18. Deployment & infrastructure

- **Supported topology: single instance.** One Node process (Next + API + Socket.IO + workers) and
  one PostgreSQL. Rate limiting, Socket.IO and the retention scheduler are process-local; a Redis
  adapter, distributed limiter and horizontal scaling are explicitly deferred (checklist in
  `docs/security.md`).
- **Dev**: `infrastructure/docker-compose.yml` → Postgres only.
- **Prod (prepared, not deployed)**: `infrastructure/Dockerfile` (multi-stage),
  `infrastructure/docker-compose.prod.yml` (app + one-shot `migrate` service + db),
  `infrastructure/.env.production.example` → copy to `.env.production`;
  `docker compose --env-file .env.production -f docker-compose.prod.yml build|run --rm migrate|up -d`.
  Migrations are a **separate one-shot step**, never an app-boot side effect; seeding is manual.
- `next start` is not used: production runs `node server.js` (`npm --prefix web run start`), so dev
  and prod share one boot path.
- Health checks: `/api/v1/health`, `/api/v1/health/ready`. Logs: JSON in production, with
  `request_id`.
- Backups: `scripts/backup-restore.sh` is a **local dev** convenience; production needs encrypted
  offsite backups + restore drills (`docs/backup-restore.md`).
- Documents: local disk is dev-only — attach an object-storage provider before production use.
- Full operator steps + production checklist: `docs/deployment.md`.

---

## 19. House conventions and hard rules

1. **ORM**: Sequelize + `sequelize-typescript` only. **Prisma is prohibited.** `sequelize.sync()` is
   prohibited. Schema changes = a new migration (`npm --prefix web run migration:create <name>`,
   generated from `web/src/server/database/templates/migration-skeleton.ts`), and every migration
   must have a working `down()`.
2. **Tenancy**: services take `school_id` from the verified JWT, never the request body. New
   tenant tables need `school_id`, `UNIQUE (school_id, id)` and composite FKs. Cross-tenant probes
   return the same generic message as "not found".
3. **Soft delete everywhere** (`deleted_at` + `paranoid: true`) — no application code hard-deletes
   business data. The only physical deletes are the retention worker aging out telemetry/history
   rows (and `down()` migrations).
4. **Contracts first**: new DTO/response/enum/socket names go in `packages/shared-types`,
   validation in `packages/validation`, typed methods in `packages/api-client`. Server and clients
   must share them — duplicating a literal is considered a bug.
5. **State machines are declared once** (`TRIP_STATUS_TRANSITIONS`,
   `TRIP_ATTENDANCE_STATUS_TRANSITIONS`, `EMERGENCY_STATUS_TRANSITIONS`) and enforced in services.
6. **Side effects after commit**: notifications, broadcasts and audit writes happen only after the
   domain transaction commits, and a delivery failure never fails the operation.
7. **Fail fast, never silently degrade**: unimplemented stores/providers throw
   (`RATE_LIMIT_STORE=redis`), the boot fails if models are detached, mobile release builds error on
   the login screen when `EXPO_PUBLIC_API_URL` is missing.
8. **Idempotency on safety-critical writes**: declare `idempotency` on the `EndpointDefinition`.
9. **New endpoint** = `EndpointDefinition` in `src/server/api/<module>.ts` + re-export from a
   `src/app/api/v1/**/route.ts` + roles + rate policy + audit + spec.
10. **Files are one-concern modules with heavy doc comments** explaining _why_; many comments encode
    deliberate decisions (e.g. "why is `shift_id` nullable", "why not `NOT NULL`"). Respect them —
    they are the repo's memory of trade-offs.
11. **No chart library, no audio assets**: admin charts are inline SVG/CSS, the siren is Web-Audio
    synthesised. Keep the bundle lean.
12. **Formatting/lint gates**: Prettier (`printWidth 100`, single quotes) + ESLint with zero warnings.
    Mobile `package.json` version changes must keep the whole Expo SDK line in lockstep
    (`docs/mobile-expo-sdk.md`).
13. **UI**: client components with `useLoad`/`usePagedResource`, `components/ui` primitives,
    design tokens from `@school-bus-tracking/design-tokens` (no ad-hoc colors), typed api-client
    calls only.
14. **Mobile UI copy comes from the i18n module** (`mobile/src/lib/i18n.ts`), never from a literal
    in a component. **Data and server-supplied strings are never translated** — student/route/stop/
    school names, API error messages, `*_LABELS` maps and the GPS support counters (plus the
    diagnostics counter words, `LOCALE_INVARIANT_KEYS`) render as the server sent them. A new UI string = a key in `i18n.en.ts` + its Hindi value in
    `i18n.hi.ts` + its Marathi value in `i18n.mr.ts`; the parity, clipping and grep-gate specs
    enforce the rest.
15. **Crew feedback is dispatched from one module** (`mobile/src/features/crew/crew-feedback.ts`):
    a surface reports _what happened_ with `feedback.on({ type: … })` and never picks a phrase or a
    haptic pattern itself. **Speech is never awaited and never fails an action** — no `await` on the
    speech path, every native call swallows its own throw, and voice copy lives in the `voice.*`
    namespace (Latin script in every locale — Hinglish / Marathi-in-Latin) so audio and
    screen text can be changed independently.

---

## 20. Known limitations & explicitly deferred work

- **Single instance only** (see §18). Effective rate limits scale ×N behind a load balancer;
  restarting resets brute-force windows.
- **Push/email/SMS**: FCM is real; email/SMS providers are no-ops. Nothing leaves the server for
  those channels.
- **Document storage** is local disk — container loss = file loss.
- **No payment provider**: subscription revenue figures are **estimates** from plan list prices.
- **No geofence computation in PostGIS**: geofencing is a radius check in JS over `stops`;
  PostGIS is installed and available but not used for spatial queries yet.
- **No Redis** (pub/sub, cache, distributed locks), no queue (BullMQ), no telemetry pipeline —
  `web/src/server/workers/` today holds the retention worker only.
- **`route_assignments`** still readable, writes retired with `410`; dedicated runs/shifts importer
  not built.
- **`runs.shift_id` stays nullable** (whole-day semantics are load-bearing); per-run time offsets,
  multi-stop students (join table) and a service calendar (holidays/half-days) are open questions.
- **GPS table growth**: no partitioning/cold-storage archival yet.
- **Mobile**: no device-farm E2E; Expo Go cannot receive remote push, cannot run the background
  location task, and does not carry the custom MapLibre map engine on any platform — the app
  detects the runtime and says so (gated background sharing, a labelled development-build map
  panel).
- **Security headers/CSP** are tuned for this app's exact needs; adding a third-party origin means
  updating `CSP_EXTRA_*`.

---

## 21. Quick orientation for an AI agent ("where do I change X?")

| Change                          | Start here                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New field on an existing entity | migration → model → DTO (`modules/<x>/dto`) → Zod (`packages/validation`) → `shared-types` response → `api-client` → service → page/screen                                     |
| New API endpoint                | `web/src/server/api/<module>.ts` (`EndpointDefinition`) + `web/src/app/api/v1/.../route.ts`                                                                                    |
| Business rule / validation      | `web/src/server/modules/<module>/<module>.service.ts` (+ its `.spec.ts`)                                                                                                       |
| Role/tenant access              | `roles: [...]` on the endpoint; `SchoolAccessService`; `web/src/lib/roles.ts` for the client guard                                                                             |
| New realtime event              | `packages/shared-types` event constant → gateway in `modules/<x>/*.gateway.ts` → wiring in `realtime/index.ts` → client socket wrapper                                         |
| Billing quota / feature gating  | `packages/shared-types` `PlanLimitResource`/`PlanFeature` → `PlanLimitsService` → `web/src/features/admin/metrics.ts` (exhaustive `Record`s will point you at every call site) |
| New web screen                  | `web/src/app/(authenticated)/<area>/page.tsx` + `web/src/features/<slice>/` + nav entry in `web/src/lib/roles.ts`                                                              |
| New mobile screen               | `mobile/app/(<group>)/<screen>.tsx` + register in the group `_layout.tsx` (use `href: null` for detail routes) + `mobile/src/features/<slice>/`                                |
| Import/export/report            | `web/src/server/modules/data-transfer/{import,export}/definitions/*.ts`, `modules/reports/definitions/*.ts`                                                                    |
| Env variable                    | `web/src/server/config/*.config.ts` (+ `docs/deployment.md` and `web/.env.example`)                                                                                            |
| Auth/session behaviour          | `web/src/server/{auth,common/security}`, `packages/api-client/src/index.ts`, `web/src/features/auth/`, `mobile/src/features/auth/`                                             |

---

## 22. Documentation index

| File                                                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md)                                                   | Full architecture blueprint (monorepo, web, backend, mobile, packages, DB, tenancy, realtime, quality gates)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [`docs/operating-model.md`](./docs/operating-model.md)                                             | **Routes/runs/shifts/crew refactor** — schema, conflict rules, migration/backfill, 4-session phase plan                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`docs/security.md`](./docs/security.md)                                                           | JWT/CSRF contract, RBAC, tenant isolation, CORS/headers, rate limits, WS security, multi-instance checklist                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`docs/subscriptions.md`](./docs/subscriptions.md)                                                 | Entitlement table, `past_due` policy decision, plan-limit reservation                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`docs/notifications.md`](./docs/notifications.md)                                                 | Notification pipeline, FCM, device tokens, admin siren, Firebase setup                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`docs/import-export-reports.md`](./docs/import-export-reports.md)                                 | Import safety model, natural keys, export datasets, report catalogue                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [`docs/data-retention.md`](./docs/data-retention.md)                                               | Retention policies, worker wiring, GPS growth, verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`docs/production-readiness.md`](./docs/production-readiness.md)                                   | Implemented vs tested vs wired — honest status matrix + limitations                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`docs/testing.md`](./docs/testing.md)                                                             | Test types, DB setup, CI job table, example specs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [`docs/deployment.md`](./docs/deployment.md)                                                       | Env vars, build, migrations, single-instance container, health checks, prod checklist                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`docs/mobile-operations.md`](./docs/mobile-operations.md)                                         | Offline attendance, background GPS, session/network UX, 403 taxonomy, **language, voice & vibration settings for support** (no-voice / no-TTS-engine / no-buzz triage), build config                                                                                                                                                                                                                                                                                                                                                   |
| [`docs/mobile-expo-sdk.md`](./docs/mobile-expo-sdk.md)                                             | Expo SDK pinning policy, verified version matrix, Expo Go vs dev builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`docs/mobile-ux.md`](./docs/mobile-ux.md)                                                         | Mobile legibility system (Phase 1) + Phase 2 crew screens: status→colour card, hold-to-confirm SOS, full-row board/drop, Help/Support telemetry move — measured contrast tables + guard specs. **+ Phase 3a localisation**: 314-key `en`/`hi` dictionaries, resolution order, the server-string boundary, clipping budgets, grep gate. **+ Phase 3b voice & haptics**: the spoken-line table, why the Hindi voice is Latin script, the latest-wins throttle (40 boards → 3 announcements), the privacy deny-list, the six wiring seams |
| [`docs/backup-restore.md`](./docs/backup-restore.md)                                               | Local backup/restore workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [`infrastructure/README.md`](./infrastructure/README.md), [`mobile/README.md`](./mobile/README.md) | Dev DB containers; mobile run/QR troubleshooting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 23. Glossary

| Term                          | Meaning in this codebase                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Tenant                        | One `schools` row; the isolation anchor for every query                                |
| Assisted management           | Time-boxed `SUPER_ADMIN` session operating inside a tenant's data, fully audited       |
| Route                         | Ordered list of stops (geometry); does **not** own a bus or crew                       |
| Run                           | One vehicle's timed pass over a route (`code` is the parent-facing bus number)         |
| Shift                         | Bell window (`time` → `time`) that makes bus tiering legal                             |
| Run crew                      | The `DRIVER`/`CONDUCTOR` rostered on a run                                             |
| Route assignment              | Deprecated date-range roster; read-only, mirrored historically                         |
| Trip                          | One execution of a run/route on a calendar day, with a 5-state machine                 |
| Manifest                      | The students on a trip, each `PENDING`/`BOARDED`/`DROPPED`                             |
| Fix                           | One GPS sample (`GpsLocationFix`) published over `/live-tracking`                      |
| Arrival                       | Proof a bus entered a stop's geofence (`trip_stop_arrivals`)                           |
| ETA                           | Approximate per-stop arrival estimate from GPS + speed, not a routing engine           |
| SOS                           | Crew-raised `emergency_events` row broadcast to the school's admins                    |
| Compliance document           | Bus/driver paperwork whose status is derived from its expiry date                      |
| Idempotency key               | Client header (`x-idempotency-key`) that makes a retry safe for safety-critical writes |
| Managed school / managed path | Tenant id + path remapping active while an assisted session is open                    |

---

_Maintain this file._ If you add a feature, change the API contract, the data model, a state machine,
or an operational guarantee, update the corresponding section here and the matching `docs/*.md`.
This README is the map people (and agents) use to understand the system — treat a stale map as a bug.
