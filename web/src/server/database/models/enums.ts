import {
  BusDocumentType,
  DocumentOwnerType,
  DriverDocumentType,
  EmergencyStatus,
  EmergencyType,
  RouteAssignmentRole,
  StudentGender,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';

/**
 * Enumerations persisted by the core domain models.
 *
 * The canonical role and student gender values live in
 * `@school-bus-tracking/shared-types` (Phase 1) and are re-exported here so
 * the API layer has a single import point — the values are never re-declared.
 * `SUPER_ADMIN` is a platform-level role; every other role is scoped to a
 * school (tenant).
 *
 * The `*_VALUES` arrays are the single source of truth for the PostgreSQL
 * enum types created by the migrations. Migrations intentionally repeat the
 * literal values: a migration is an immutable record of what a released
 * schema looked like and must not change meaning when a constant evolves.
 */
export { StudentGender, UserRole };

export const USER_ROLE_VALUES: UserRole[] = Object.values(UserRole);

export const STUDENT_GENDER_VALUES: StudentGender[] = Object.values(StudentGender);

/**
 * Operational role a user performs on a route within a {@link RouteAssignment}.
 *
 * Kept separate from `UserRole` on purpose: a person is hired once (`DRIVER`)
 * but can be assigned to several routes over time. The enum itself is shared
 * with API contracts so database, API and clients cannot drift.
 */
export { RouteAssignmentRole };

export const ROUTE_ASSIGNMENT_ROLE_VALUES: RouteAssignmentRole[] =
  Object.values(RouteAssignmentRole);

/**
 * Lifecycle of a single scheduled bus run.
 *
 * SCHEDULED  → trip exists on the calendar, nothing has happened yet
 * BOARDING   → crew is at the first stop and students are getting on
 * IN_PROGRESS→ bus departed the first stop and is driving the route
 * COMPLETED  → final stop reached and the run is closed
 * CANCELLED  → run will not happen (weather, vehicle fault, holiday, …)
 *
 * Terminal states are `COMPLETED` and `CANCELLED`. Live-location reporting
 * (Phase 3) will move trips between the non-terminal states; the state machine
 * itself is enforced in the service layer, not by the database.
 *
 * The enum is owned by `@school-bus-tracking/shared-types` so the database,
 * API contracts and clients can never drift; it is only re-exported here.
 */
export { TripStatus };

export const TRIP_STATUS_VALUES: TripStatus[] = Object.values(TripStatus);

/**
 * Attendance state of a student on a concrete trip
 * (`trip_student_attendance.status`).
 *
 * PENDING → on the manifest, not on the bus yet (the implicit state of a
 *           student without a stored attendance row)
 * BOARDED → the crew confirmed the student onto the bus
 * DROPPED → the student left the bus
 *
 * The progression is one-way; the service layer rejects boarding twice,
 * dropping before boarding and dropping twice. The enum is owned by
 * `@school-bus-tracking/shared-types` so database, API contracts and clients
 * can never drift; it is only re-exported here.
 */
export { TripAttendanceStatus };

export const TRIP_ATTENDANCE_STATUS_VALUES: TripAttendanceStatus[] =
  Object.values(TripAttendanceStatus);

/**
 * Task 44 — Compliance documents.
 *
 * The catalogue of document types is owned by
 * `@school-bus-tracking/shared-types` (like every other enum in this file) so
 * the database, the API and both clients can never drift; it is only
 * re-exported here. The `*_VALUES` arrays are the single source of truth for
 * the PostgreSQL enum types created by the migrations — migrations repeat the
 * literals on purpose because a migration is an immutable record of a released
 * schema.
 */
export { BusDocumentType, DriverDocumentType };

export const BUS_DOCUMENT_TYPE_VALUES: BusDocumentType[] = Object.values(BusDocumentType);

export const DRIVER_DOCUMENT_TYPE_VALUES: DriverDocumentType[] =
  Object.values(DriverDocumentType);

/**
 * The two resource kinds a compliance document can hang off
 * (`document_requirements.owner_type`).
 *
 * It is a plain string union rather than an enum because it is a *discriminator*
 * between two tables (`bus_documents` / `driver_documents`), not a domain value
 * of either of them.
 */
export type { DocumentOwnerType };

export const DOCUMENT_OWNER_TYPE_VALUES: readonly DocumentOwnerType[] = ['BUS', 'DRIVER'];

/**
 * Task 44 — Emergency / SOS.
 *
 * `type` answers *why* the crew raised the alarm, `status` tracks how the
 * school has handled it. The legal transitions live in the shared
 * `EMERGENCY_STATUS_TRANSITIONS` map and are enforced by the service layer,
 * not by the database — the database only guarantees the value set.
 */
export { EmergencyStatus, EmergencyType };

export const EMERGENCY_TYPE_VALUES: EmergencyType[] = Object.values(EmergencyType);

export const EMERGENCY_STATUS_VALUES: EmergencyStatus[] = Object.values(EmergencyStatus);
