# Import / Export / Reports

Bulk data operations for the School Admin console: Excel/CSV import with
validation-first safety, filtered business exports, and an operational
reporting area. Everything runs on free/open-source libraries
(`exceljs`, `multer` memory storage) — no paid service, no object storage,
no Redis.

---

## 1. Audit of the existing architecture (pre-implementation)

| Area                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Models**                  | `School`, `User` (role = SCHOOL_ADMIN/DRIVER/CONDUCTOR/PARENT), `Bus`, `Route`, `Stop`, `Student`, `StudentGuardian`, `RouteAssignment`, `Trip`, `TripStudentAttendance`, `TripStopArrival`, `TripLocation`, `Notification`, `BusDocument`, `DriverDocument`, `DocumentRequirement`, `EmergencyEvent`, `AuditLog`, `Plan`, `SchoolSubscription`, `IdempotencyKey`. Every tenant entity carries `school_id` and most tenant references are pinned by composite FKs `(school_id, x_id) → x(school_id, id)`. |
| **Validation**              | Two consistent layers: `class-validator` DTOs in `apps/api/src/modules/*/dto` (request shape) and Zod schemas in `packages/validation` (shared with web/mobile: `studentCreateSchema`, `busCreateSchema`, `routeCreateSchema`, `stopCreateSchema`, `staffCreateSchema`, `parentCreateSchema`, `studentGuardianCreateSchema`, `routeAssignmentCreateSchema`, …).                                                                                                                                           |
| **Tenant isolation**        | `school_id` is always taken from verified JWT claims via `@CurrentUser('school_id')`; services pin `where: { school_id }` and return generic 404s for cross-tenant probes. No endpoint accepts a client-supplied `school_id`.                                                                                                                                                                                                                                                                             |
| **AuthZ**                   | `JwtAuthGuard` + `RolesGuard` + `@Roles(UserRole.SCHOOL_ADMIN)` on every school-admin controller; `RateLimitGuard` opt-in via `@RateLimit(policy)`; CSRF double-submit for cookie-authenticated browsers (bearer calls are exempt).                                                                                                                                                                                                                                                                       |
| **Lists/UI**                | Next.js App Router, `usePagedResource` / `useLoad` hooks, `components/ui` primitives (`PageHeader`, `Modal`, `Button`, `Badge`, `Pagination`, `useToast`), `apiClient` from `packages/api-client` behind a same-origin `/api/v1` rewrite.                                                                                                                                                                                                                                                                 |
| **Documents/reports today** | `DocumentsModule` (bus/driver compliance + derived expiry engine + `/documents/overview`); `AdminDashboardService` (platform-level aggregates) — no school-level reporting area existed.                                                                                                                                                                                                                                                                                                                  |
| **File handling**           | `LocalStorageProvider` (dev-only document storage abstraction). No multipart pipeline, no Excel dependency.                                                                                                                                                                                                                                                                                                                                                                                               |
| **Audit**                   | `AuditService.log()` (fire-and-forget, redacting) + `audit_logs` table + `/audit-logs` read endpoint.                                                                                                                                                                                                                                                                                                                                                                                                     |

### Decisions taken from the audit

- **Import** is offered where a school genuinely onboards data in bulk:
  students, parents/guardians, student↔guardian links, buses, routes, stops,
  drivers, conductors, route/bus/crew assignments. Operational data produced by
  devices or workflows (trips, attendance, notifications, emergencies,
  documents with binary files) is **not** importable.
- **Export** is offered on every admin list plus operational history: students,
  parents, buses, routes, stops, drivers, conductors, assignments, trips,
  attendance, notifications, bus documents, driver documents.
- **Reports** only use data that actually exists: student/route/bus/stop
  distribution, unassigned students, bus utilisation, crew assignments, trips,
  attendance, notifications (including the stored delivery-status columns) and
  document compliance.
- **Schema change**: one new table, `import_jobs` (history/audit of every
  validation and import run, plus the stored per-row errors used to regenerate
  the error workbook). Uploaded files are never persisted.

---

## 2. Import flow

```
Download template → Upload file → Validate (dry run) → Review results → Import
```

1. `GET /api/v1/imports/:module/template?format=xlsx|csv` — column headers,
   a documented notes row, an example row and an `Instructions` sheet.
2. `POST /api/v1/imports/:module/validate` (multipart `file`, `mode`) — parses,
   validates every row and returns totals + the first errors. **Nothing is
   written to the domain tables.** An `import_jobs` row is recorded with
   `dry_run = true` so the error workbook stays downloadable.
3. `POST /api/v1/imports/:module/commit` (multipart `file`, `mode`) — the file
   is re-uploaded and **re-validated server-side** (the client's preview is
   never trusted), then valid rows are written inside a single transaction.
4. `GET /api/v1/imports/history` / `:id` / `:id/error-file` — audit trail and
   the `<module>_import_errors.xlsx` download.

Why re-upload instead of a server-side staging area? It keeps the MVP free of
temporary file storage, guarantees the imported bytes are the bytes the admin
approved, and makes the commit path validate exactly like the preview path.

### Modes

- `create` — insert new rows; rows whose natural key already exists are
  reported as duplicates and skipped.
- `upsert` — insert new rows and update existing ones matched by natural key.

Natural keys: student `admission_number`, parent/driver/conductor `email`,
bus `registration_number`, route `code`, stop `route_code + name`,
guardian link `admission_number + parent_email`,
assignment `route_code + user_email + role + effective_from`.

### Safety properties

- `school_id` always comes from the JWT — a file can never target another school.
- Every row is validated with the **shared Zod schemas** already used by the web
  and mobile clients, plus reference/duplicate checks against tenant-scoped
  lookups.
- All writes happen inside one Sequelize transaction; any failure rolls the
  whole import back (`status = FAILED`, nothing partially written).
- Plan limits are enforced for the _whole batch_ before writing
  (`PlanLimitsService.runWithinBulkLimit`, advisory-locked like single creates).
- Row caps per file (`5 000` for plain records, `500` for account-creating
  imports because bcrypt hashing is deliberately expensive) and a 5 MB upload cap.
- Every validation and import is written to `audit_logs` (`import.validate`,
  `import.commit`) and to `import_jobs`.

---

## 3. Export

`GET /api/v1/exports/:dataset?format=xlsx|csv&…filters` streams the file
directly to the response (chunked page-by-page reads, never the whole table in
memory). Filters mirror the list screens (search, status, route, bus, stop,
driver, parent, trip status, attendance status, date ranges) so **the export
always matches what the admin sees**.

Exports contain business columns only — no password hashes, refresh tokens,
CSRF material or internal implementation fields. Medical notes are excluded
from the student export because they are classified as sensitive by the audit
redaction policy.

---

## 4. Reports

`GET /api/v1/reports/overview` — real summary cards (students, assignment
coverage, fleet, today's trips and attendance, document compliance).

`GET /api/v1/reports/:report` — a uniform
`{ summary, columns, rows, meta, filters_applied }` payload for:
`students_by_route`, `students_by_bus`, `students_by_stop`,
`students_unassigned`, `student_roster`, `bus_utilization`, `crew_assignments`,
`trips`, `attendance`, `notifications`, `documents`.

`GET /api/v1/reports/:report/export?format=xlsx|csv` re-runs the _same_ query
with the _same_ filters and streams the full result, so the screen and the file
can never disagree.

All report queries are tenant-pinned and `SCHOOL_ADMIN`-only.

---

## 5. Where the code lives

```
apps/api/src/modules/data-transfer/
  excel/excel.util.ts             # workbook build/stream/parse + CSV helpers
  import/import.service.ts        # parse → validate → preview / commit
  import/import-history.service.ts# import_jobs + error workbook
  import/import-template.service.ts
  import/definitions/*.ts         # per-module columns, validation, persistence
  export/export.service.ts        # dataset registry + streaming writers
apps/api/src/modules/reports/     # report registry + controller
apps/api/src/database/models/import-job.model.ts
apps/api/src/database/migrations/20260902120000-create-import-jobs.ts
packages/shared-types             # ImportModule / ExportDataset / ReportType contracts
packages/validation               # shared import/export/report query schemas
packages/api-client               # typed upload + blob download methods
apps/web/src/features/data-transfer/  # ImportDialog, ExportMenu
apps/web/src/app/(authenticated)/imports/   # import history
apps/web/src/app/(authenticated)/reports/   # reports area
```

Mobile is intentionally untouched by this feature: bulk import/export, the
import-job history, and reporting are back-office desktop workflows and stay
**web-only**. The mobile app already provides school-admin CRUD for students,
buses, routes & stops, staff, guardians, assignments, and documents (see
`docs/architecture.md` §5 and `docs/mobile-operations.md`); it simply does not
expose the bulk Excel or reporting surfaces.
