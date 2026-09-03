# School Bus Tracking SaaS — Architecture Blueprint (Phase 1)

## 1. Executive Summary & Overview

The **School Bus Tracking SaaS** platform is an enterprise-grade, multi-tenant solution designed to provide real-time bus location tracking, automated student boarding/deboarding verification, dynamic ETA calculation, and safety communications across educational institutions.

The platform serves four primary stakeholder groups:

1. **School Administrators**: Fleet management, route optimization, driver/conductor assignment, student manifests, and safety audit logs.
2. **Drivers**: Turn-by-turn navigation, route compliance, stop checklists, and emergency broadcasting.
3. **Conductors**: Student boarding/deboarding verification via RFID/NFC/QR scanning, passenger headcount, and parent alert dispatch.
4. **Parents / Guardians**: Live GPS map tracking, real-time geofence proximity alerts, student boarding notifications, and direct school communication.

---

## 2. Monorepo Architecture & Workspace Structure

The project is structured as an **npm workspaces** monorepo running on **Node.js 22 LTS**. This design maximizes code reuse across web, backend, and mobile applications while ensuring strict separation of concerns and independent versioning.

### 2.1 Directory Tree

```
school-bus-tracking/
├── .nvmrc                          # Enforces Node.js 22 LTS
├── .gitignore                      # Standard repository ignore definitions
├── .prettierrc                     # Monorepo code formatting rules
├── .prettierignore                 # Prettier ignore paths
├── eslint.config.mjs               # Unified ESLint 9 configuration
├── package.json                    # Workspace root scripts & orchestrations
├── tsconfig.base.json              # Base TypeScript compiler settings
├── tsconfig.json                   # Root composite project references
│
├── apps/
│   ├── web/                        # Next.js 14+ App Router Web Application
│   │   ├── src/
│   │   │   ├── app/                # App Router layouts, pages, and API routes
│   │   │   ├── components/         # Reusable UI component library
│   │   │   ├── features/           # Domain feature slices (fleet, routes, admin)
│   │   │   ├── services/           # HTTP/WebSocket client wrappers
│   │   │   └── types/              # Web-specific presentation types
│   │   ├── next.config.js
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/                        # NestJS Backend API Gateway & Engine
│   │   ├── src/
│   │   │   ├── common/             # Cross-cutting HTTP filters, guards, pipes, interceptors
│   │   │   │   ├── decorators/     # Custom parameter and route decorators
│   │   │   │   ├── filters/        # Global exception handling & error standardization
│   │   │   │   ├── guards/         # RBAC and tenant authorization guards
│   │   │   │   ├── interceptors/   # Response formatting and latency logging
│   │   │   │   └── pipes/          # DTO transformation and validation pipes
│   │   │   ├── config/             # ConfigService schema & environment definitions
│   │   │   ├── database/           # Sequelize ORM infrastructure
│   │   │   │   ├── models/         # Sequelize-typescript model declarations
│   │   │   │   ├── migrations/     # Versioned SQL/Sequelize migrations
│   │   │   │   └── seeders/        # Test & environment seed data
│   │   │   ├── modules/            # Business & domain modules
│   │   │   │   └── health/         # System heartbeat & readiness module
│   │   │   ├── workers/            # BullMQ / telemetry queue background consumers
│   │   │   ├── app.module.ts       # Root NestJS application module
│   │   │   └── main.ts             # Application bootstrap & middleware pipeline
│   │   ├── .env.example            # Environment configuration template
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   │
│   └── mobile/                     # React Native Expo Mobile App (expo-router)
│       ├── app/                    # File-based navigation routes (_layout, index)
│       ├── src/
│       │   ├── components/         # Cross-platform native UI primitives
│       │   ├── features/           # Feature slices by persona
│       │   │   ├── driver/         # Telemetry broadcaster & turn guidance
│       │   │   ├── conductor/      # Student manifest & barcode scanner
│       │   │   └── parent/         # Live map tracking & push notifications
│       │   ├── services/           # Mobile API & WebSocket connectors
│       │   ├── theme/              # Mobile styling mapped to design tokens
│       │   └── types/              # Mobile-specific navigation & device types
│       ├── app.json
│       ├── babel.config.js
│       ├── metro.config.js
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── shared-types/               # Domain interfaces, enums, DTO contracts
│   ├── design-tokens/              # Colors, spacing, typography, breakpoints
│   ├── config/                     # Environment constants, default configs
│   ├── validation/                 # Zod validation schemas for API & clients
│   └── api-client/                 # Typed fetch client with error handling
│
├── infrastructure/
│   ├── docker-compose.yml          # PostgreSQL + PostGIS local container orchestration
│   ├── postgres/
│   │   └── init.sql                # PostGIS & UUID extension bootstrap
│   └── README.md
│
└── docs/
    └── architecture.md             # This comprehensive architecture document
```

---

## 3. Web Application (`apps/web`)

The web frontend is engineered with **Next.js 14+ (App Router)** in **TypeScript**:

- **App Router Paradigm**: Leverages React Server Components (RSC) for initial page loads and data caching, combined with client components for dynamic interactive widgets (e.g., live tracking maps).
- **Feature Slicing (`src/features`)**: Domain-specific logic is isolated into feature folders (`fleet`, `routes`, `students`, `settings`) containing local hooks, state stores, and sub-components.
- **Shared Design Token Integration**: UI components strictly consume `@school-bus-tracking/design-tokens` for standardized colors, typography, borders, and responsive breakpoints.
- **Resilient API Client**: Uses `@school-bus-tracking/api-client` for type-safe interaction with the backend API.
- **Super Admin platform console (`/admin/*`)**: a `SUPER_ADMIN`-only surface (`Dashboard`, `Schools`, `Subscriptions`, `Plans`, `Revenue`) guarded client-side by `canAccessPath()` and server-side by `@Roles(SUPER_ADMIN)` on every `/api/v1/admin/*` controller. Shared derivations (KPIs, distributions, estimated revenue, usage-vs-limit rows) live in `src/features/admin/metrics.ts` and are unit-tested; the charts in `src/features/admin/components` are dependency-free inline SVG/CSS, so the console adds no charting library to the bundle. All revenue figures are explicitly labelled **estimates** derived from plan list prices — the platform has no payment provider, invoicing or cash ledger.
- **Emergency alarm for school admins (`src/features/emergencies`)**: a crew SOS (`emergency:new` on the existing `/emergencies` namespace) plays a prominent, repeating siren in the admin's tab on any screen. The siren is synthesised with the Web Audio API — no audio asset and no new dependency — and is gated by a pure policy module so that no other realtime frame (a parent `notification:new` above all) can ever produce a sound. The engine is framework-free with an injected audio context and scheduler, which makes the whole state machine (autoplay queueing, mute, repeat cap, degradation) unit-testable on the plain Node test runner; see `docs/notifications.md`.

---

## 4. Backend API Application (`apps/api`)

The backend is built with **NestJS** and **TypeScript**, providing an enterprise-grade modular architecture:

- **Global Interceptor & Filter Pipeline**:
  - `HttpExceptionFilter`: Normalizes all HTTP exceptions into standard `ApiResponse<T>` envelopes.
  - `LoggingInterceptor`: Measures and logs execution latency for every incoming HTTP and WebSocket transaction.
  - `TransformInterceptor`: Automatically wraps handler return values into uniform response objects.
  - `ValidationPipe`: Validates incoming payload shapes using `class-validator` and `class-transformer`.
- **Health Subsystem (`/api/v1/health`)**: Exposes an unauthenticated endpoint reporting system operational status, uptime, service identifiers, and environment metadata.
- **Worker Infrastructure (`src/workers`)**: Prepared for asynchronous message processing (telemetry stream ingestion, bulk notifications, PDF report generation).

---

## 5. Mobile Application (`apps/mobile`)

The mobile client is a unified **React Native** application powered by **Expo (SDK 54)** and **expo-router**. It reuses the existing NestJS API, the shared `api-client`, `shared-types` and `validation` packages, and both Socket.IO namespaces (`/live-tracking`, `/notifications`) — it contains no backend logic of its own.

- **Role-based navigation** (`src/lib/roles.ts` + `RoleGate`): every route group is guarded client-side exactly like the API guards it server-side.
  - `(crew)` — **one shared Driver + Conductor experience**: today's trip (`BOARDING → IN_PROGRESS → COMPLETED` via `PATCH /trips/:id/status`), student manifest with body-less board/drop endpoints, stops & live ETA (`/trips/:id/eta`, `/progress`), and native GPS sharing. `src/features/driver` and `src/features/conductor` are thin re-exports of the same `src/features/crew` slice.
  - `(parent)` — dashboard/children (`/parent/dashboard`, `/parent/children*`), live bus tracking on a native map with the same trip rooms the web tracker joins, ETA/next-stop views, and the notification centre with an unread badge fed by the `/notifications` socket.
  - `(admin)` — the `SCHOOL_ADMIN` experience with feature parity for day-to-day management: operations dashboard, trip schedule and trip cockpit (dispatch lifecycle + live map + manifest), live tracking, attendance, emergencies, and a **Manage** hub exposing full CRUD (create / edit / delete) for students, buses, routes & stops, drivers & conductors, guardians, route assignments, and bus/driver compliance documents — all against the same API endpoints and shared Zod schemas the web console uses. **Web-only** back-office features are bulk Excel import/export, the import-job history, and the Reports area (see `docs/import-export-reports.md`). `SUPER_ADMIN` (platform console) still gets a "use the web console" notice screen.
- **Driver/Conductor GPS (real device data only)**: `expo-location` foreground `watchPositionAsync` plus an opt-in background task (`startLocationUpdatesAsync` + `expo-task-manager`) with the location plugin permissions configured in `app.json`. Every fix is mapped to the shared `trip:location:update` Zod contract (km/h speed, normalized heading, device `recorded_at`), validated client-side with the same schema, and emitted over the existing socket — malformed or offline fixes are dropped, never queued or fabricated. Sharing auto-stops on terminal trip states and sign-out.
- **Auth**: the same `/auth/login|refresh|logout` endpoints. The access token lives in JS memory only; the refresh cookie persists in the platform cookie jar so sessions survive app restarts.
- **Metro Monorepo Resolution**: Configured via `metro.config.js` to seamlessly resolve shared packages (`@school-bus-tracking/*`) directly from the workspace root.

---

## 6. Shared Packages Ecosystem (`packages/*`)

Shared packages ensure zero type divergence and unified styling across the platform:

1. **`@school-bus-tracking/shared-types`**:
   - Central source of truth for API response contracts, domain enums (`UserRole`, `VehicleStatus`, `StudentBoardingStatus`), coordinates, and tenant contexts.
2. **`@school-bus-tracking/design-tokens`**:
   - Central design repository defining the color palette (School Bus Yellow/Amber `#f59e0b`, Slate Neutrals, Safety Status Colors), spacing scales, typographic tokens, shadows, and grid breakpoints.
3. **`@school-bus-tracking/config`**:
   - Central constants, default port allocations, environment definitions, and database default options.
4. **`@school-bus-tracking/validation`**:
   - Reusable `zod` schemas for input sanitization, coordinates validation, tenant identifier formats, and pagination.
5. **`@school-bus-tracking/api-client`**:
   - Universal HTTP client wrapping `fetch` with typed error handling, header injection, and tenant context propagation.

---

## 7. Database & ORM Architecture (PostgreSQL & Sequelize)

- **PostgreSQL 16 + PostGIS**: PostgreSQL is selected as the primary relational database, enhanced with PostGIS for native spatial computation (geofence boundaries, route line strings, distance queries).
- **Sequelize ORM (`sequelize-typescript`)**:
  - Explicitly configured without `sequelize.sync()`.
  - Schema changes are managed exclusively through version-controlled database migrations in `apps/api/src/database/migrations`.
  - Strict connection pooling with configurable max/min limits, acquire timeout, and idle cleanup.
  - **Prisma is completely prohibited** from the project to maintain a unified Sequelize ORM foundation.

---

## 8. Multi-Tenancy Architecture (Implemented)

The School Bus Tracking platform is a shared-database, row-level multi-tenant SaaS: every tenant is a row in `schools` and every tenant-owned resource carries `school_id`, which is the isolation anchor throughout the API and database.

### 8.1 Tenancy Model

1. **`School` is the tenant root.** `schools.id` (opaque UUID) and `schools.code` (human-friendly, e.g. `lincoln-high`) both identify a tenant. Every child table (`users`, `students`, `buses`, `routes`, `stops`, `trips`, `route_assignments`, `school_subscriptions`, …) carries `school_id`.
2. **Composite foreign keys prevent cross-tenant references.** User, trip and assignment parents are referenced as `(school_id, id)` so no database row can point at a resource from another school.
3. **Tenant context comes from verified JWT claims, never from the client.** Normal school users authenticate with the tenant that owns their account; no tenant HTTP header or body `school_id` is trusted for scoping. `POST/PATCH GET` requests derive `school_id` from the authenticated user and every service layer query pins the tenant and role.
4. **Platform `SUPER_ADMIN` is tenant-less.** It owns no `school_id` and is explicitly a cross-tenant operator. Platform endpoints take the managed school id from the route and re-validate it server-side, so a platform operator can never accidentally address a tenant without its real UUID, and school users are rejected by role guards (401 / 403).
5. **Email uniqueness is per tenant.** `uq_users_school_email` allows the same address in two schools; a separate partial unique index (`uq_users_super_admin_email`) guards platform admin logins.

### 8.2 Isolation at the API Boundary

- Every feature controller is guarded by `JwtAuthGuard + RolesGuard`.
- Every school-scoped service derives `school_id` from the JWT and never accepts it from the request body.
- Super Admin routes are explicitly `@Roles(SUPER_ADMIN)`.
- Inactive tenants are blocked centrally; deactivation revokes open refresh tokens but never deletes data (audit-friendly soft lifecycle).

---

## 9. Real-Time Tracking & Telemetry Architecture (Implemented)

Real-time bus tracking is delivered by a self-hosted Socket.IO gateway (`@nestjs/platform-socket.io`) inside the API app, plus first-party database persistence. There is **no third-party push/paid service**: live maps, ETA updates and emergency/notification feeds all use the same Socket.IO namespaces.

```
+------------------+       GPS fix (HTTP) / live socket      +-----------------+
| Driver / Crew    |  =====================================> |  Nest API       |
| Mobile App       |                                          |  (JWT + tenant) |
+------------------+   trip:location:update, emergency:sos    +-------+---------+
                                                                     |
                                                        persist + tenant room
                                                                     v
                                                          +-----------------+
                                                          | Socket.IO       |
                                                          | /live-tracking  |
                                                          | /notifications  |
                                                          | /emergencies    |
                                                          +-------+---------+
                                                                     |
                          broadcast to verified school room          |
                                                                     v
+------------------+<--------------------------------------+-----------------+
| Parent / School  |   sub-second live map, ETA, emergency  | Web + Mobile    |
| Web / Mobile    |   and notification events               | Console         |
+------------------+                                         +-----------------+
```

### 9.1 Real-time Namespaces & Tenant Rooms

1. **`/live-tracking`** — live GPS updates and trip location history for school-admin / parent live map views. Sockets join tenant rooms derived from the verified JWT `school_id`; a client can never name or join another school's room.
2. **`/notifications`** — in-app notification events for school users and parents.
3. **`/emergencies`** — crew SOS (`emergency:new`) and status changes (`emergency:updated`) to the owning school's room.
4. **Authorization** — Handshakes use the same JWT strategy; tenant isolation is enforced server-side by room ownership, never by trusting a client-declared room or tenant id.
5. **Future work** — Redis Pub/Sub scaling, telemetry queue workers and PostGIS geofence computation remain future enhancements; the current architecture keeps every real-time event first-party and self-hosted.

---

## 10. Verification & Quality Gates

The monorepo enforces automated quality checks:

- `npm run typecheck`: Strict TypeScript typechecking across all apps and packages.
- `npm run lint`: ESLint rules enforcing code quality, no unused variables, and styling conventions.
- `npm run format:check`: Prettier verification for consistent styling.
- `npm run build`: Full compilation of all shared packages, backend NestJS app, and web application.
