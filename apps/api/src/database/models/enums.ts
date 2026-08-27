import { UserRole } from '@school-bus-tracking/shared-types';

/**
 * Enumerations persisted by the core domain models.
 *
 * The canonical list of user roles already lives in
 * `@school-bus-tracking/shared-types` (Phase 1) and is re-exported here so the
 * API layer has a single import point — the values are never re-declared.
 * `SUPER_ADMIN` is a platform-level role; every other role is scoped to a
 * school (tenant).
 *
 * The `*_VALUES` arrays are the single source of truth for the PostgreSQL
 * enum types created by the migrations. Migrations intentionally repeat the
 * literal values: a migration is an immutable record of what a released
 * schema looked like and must not change meaning when a constant evolves.
 */
export { UserRole };

export const USER_ROLE_VALUES: UserRole[] = Object.values(UserRole);

/**
 * Optional demographic field captured by schools for reporting.
 */
export enum StudentGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export const STUDENT_GENDER_VALUES: StudentGender[] = Object.values(StudentGender);

/**
 * Operational role a user performs on a route within a {@link RouteAssignment}.
 *
 * Kept separate from `UserRole` on purpose: a person is hired once (`DRIVER`)
 * but can be assigned to several routes over time.
 */
export enum RouteAssignmentRole {
  DRIVER = 'DRIVER',
  CONDUCTOR = 'CONDUCTOR',
}

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
 */
export enum TripStatus {
  SCHEDULED = 'SCHEDULED',
  BOARDING = 'BOARDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const TRIP_STATUS_VALUES: TripStatus[] = Object.values(TripStatus);
