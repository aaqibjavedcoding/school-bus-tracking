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

The mobile client is a unified **React Native** application powered by **Expo (SDK 51)** and **expo-router**. It reuses the existing NestJS API, the shared `api-client`, `shared-types` and `validation` packages, and both Socket.IO namespaces (`/live-tracking`, `/notifications`) — it contains no backend logic of its own.

- **Role-based navigation** (`src/lib/roles.ts` + `RoleGate`): every route group is guarded client-side exactly like the API guards it server-side.
  - `(crew)` — **one shared Driver + Conductor experience**: today's trip (`BOARDING → IN_PROGRESS → COMPLETED` via `PATCH /trips/:id/status`), student manifest with body-less board/drop endpoints, stops & live ETA (`/trips/:id/eta`, `/progress`), and native GPS sharing. `src/features/driver` and `src/features/conductor` are thin re-exports of the same `src/features/crew` slice.
  - `(parent)` — dashboard/children (`/parent/dashboard`, `/parent/children*`), live bus tracking on a native map with the same trip rooms the web tracker joins, ETA/next-stop views, and the notification centre with an unread badge fed by the `/notifications` socket.
  - `(admin)` — a mobile-first slice for `SCHOOL_ADMIN` (today's operations board, trip cockpit with dispatch lifecycle + live map + manifest, pocket student directory, dispatch-from-assignment operations). Full CRUD intentionally stays on the web console; `SUPER_ADMIN` gets a "use the web console" notice screen.
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

## 8. Multi-Tenancy Architecture (Future Phases)

The School Bus Tracking platform is designed for scalable multi-tenancy across thousands of schools and school districts.

### 8.1 Multi-Tenancy Model Comparison

| Strategy                                 | Isolation Level  | Complexity  | Resource Efficiency | Suitable Scale               |
| :--------------------------------------- | :--------------- | :---------- | :------------------ | :--------------------------- |
| **Row-Level Partitioning (`tenant_id`)** | Logical          | Low–Medium  | Highest             | 10,000+ Tenants              |
| **Schema-per-Tenant**                    | Logical/Physical | Medium–High | Medium              | 100–1,000 Large Districts    |
| **Database-per-Tenant**                  | Strict Physical  | Very High   | Lowest (High cost)  | Enterprise Isolated Installs |

### 8.2 Recommended Hybrid Architecture

1. **Default: Discriminator Column (`tenant_id`) with Row-Level Security (RLS)**:
   - All core tables (`schools`, `buses`, `routes`, `stops`, `students`, `guardians`) include an indexed `tenant_id: UUID` column.
   - Sequelize models utilize global default scopes (`where: { tenant_id: ... }`) and Sequelize hooks to automatically inject `tenant_id` on all create and find operations.
   - PostgreSQL Row Level Security (RLS) policies act as the ultimate safeguard at the database engine level:
     ```sql
     ALTER TABLE students ENABLE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation_policy ON students
       USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
     ```
2. **Tenant Context Resolution Middleware**:
   - Requests are resolved via:
     1. Custom subdomain (e.g., `lincolnhigh.schoolbustracking.com` → resolves to Lincoln High Tenant ID).
     2. `X-Tenant-ID` header (for mobile apps and internal microservice requests).
     3. Claims embedded within signed JWT tokens (`tenantId`).
   - A NestJS `TenantContextInterceptor` validates tenant validity, sets request-scoped context via `AsyncLocalStorage`, and configures the Sequelize transaction session.

---

## 9. Real-Time Tracking & Telemetry Architecture (Future Phases)

Real-time bus tracking requires handling high-frequency telemetry while delivering sub-second map updates to thousands of concurrent parents and dispatchers.

```
+----------------+      High-Frequency GPS      +-------------------+
|  Driver Mobile |  =========================>  |  API Gateway /    |
|  App / IoT Unit|     (MQTT / WebSockets)      |  Ingestion Cluster|
+----------------+                              +---------+---------+
                                                          |
                                           Publish Event  |
                                                          v
                                                +-------------------+
                                                | Redis Streams /   |
                                                | PubSub Cluster    |
                                                +----+--------+-----+
                                                     |        |
                         +---------------------------+        +---------------------------+
                         |                                                                |
                         v                                                                v
               +-------------------+                                            +-------------------+
               | Telemetry Worker  |                                            | Socket.io Gateway |
               | (BullMQ / Node)   |                                            | (Live WebSockets) |
               +---------+---------+                                            +---------+---------+
                         |                                                                |
         Persist History | Geofence Check                                Broadcast Stream | (Filtered by Tenant & Route)
                         v                                                                v
               +-------------------+                                            +-------------------+
               | PostgreSQL /      |                                            | Parent & Admin    |
               | PostGIS Database  |                                            | Apps (Live Map)   |
               +-------------------+                                            +-------------------+
```

### 9.1 Ingestion & Processing Pipeline

1. **Telemetry Capture**:
   - Driver mobile apps (or dedicated on-board OBD-II / GPS hardware) transmit location packets at 3–5 second intervals containing `{ latitude, longitude, speed, heading, accuracy, timestamp, routeId, busId, tenantId }`.
2. **Ingestion Layer**:
   - Location packets arrive over WebSocket connections or lightweight MQTT brokers, authenticated via ephemeral device tokens.
3. **Redis Real-Time Buffer & Pub/Sub**:
   - Location data is published directly to Redis Pub/Sub channels keyed by tenant and route (`tenant:{tenantId}:route:{routeId}`).
   - The latest bus position is cached in Redis with geospatial indexes (`GEOADD`) for ultra-low latency spatial lookups.
4. **Geofencing & Proximity Calculation**:
   - Telemetry workers evaluate proximity against the route's upcoming stops using PostGIS spatial functions (`ST_DWithin`, `ST_Distance`).
   - When a bus enters the 500m/2-minute radius of an active student stop, a `STOP_APPROACHING` event triggers push notifications via Apple APNs and Firebase Cloud Messaging (FCM).
5. **Conductor Boarding Flow**:
   - Conductors scan student QR codes or RFID cards upon boarding.
   - The event (`STUDENT_BOARDED`, `STUDENT_DEBOARDED`) is pushed to the server, verifying stop matching and notifying parents immediately.

---

## 10. Verification & Quality Gates

The monorepo enforces automated quality checks:

- `npm run typecheck`: Strict TypeScript typechecking across all apps and packages.
- `npm run lint`: ESLint rules enforcing code quality, no unused variables, and styling conventions.
- `npm run format:check`: Prettier verification for consistent styling.
- `npm run build`: Full compilation of all shared packages, backend NestJS app, and web application.
