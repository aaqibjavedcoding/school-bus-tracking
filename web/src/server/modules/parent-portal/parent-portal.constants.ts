/**
 * DI tokens and user-facing messages for the parent portal feature.
 *
 * Every repository token points at a concrete Sequelize model registered by
 * `ParentPortalModule`, matching the migration-driven pattern used across the
 * rest of the API (token-backed repositories keep the module unit-testable
 * while `DB_AUTO_CONNECT=false`).
 */
export const PARENT_PORTAL_GUARDIANS_REPOSITORY = 'PARENT_PORTAL_GUARDIANS_REPOSITORY';
export const PARENT_PORTAL_STUDENTS_REPOSITORY = 'PARENT_PORTAL_STUDENTS_REPOSITORY';
export const PARENT_PORTAL_STOPS_REPOSITORY = 'PARENT_PORTAL_STOPS_REPOSITORY';
export const PARENT_PORTAL_ROUTES_REPOSITORY = 'PARENT_PORTAL_ROUTES_REPOSITORY';
export const PARENT_PORTAL_BUSES_REPOSITORY = 'PARENT_PORTAL_BUSES_REPOSITORY';
export const PARENT_PORTAL_TRIPS_REPOSITORY = 'PARENT_PORTAL_TRIPS_REPOSITORY';
export const PARENT_PORTAL_USERS_REPOSITORY = 'PARENT_PORTAL_USERS_REPOSITORY';
export const PARENT_PORTAL_SCHOOLS_REPOSITORY = 'PARENT_PORTAL_SCHOOLS_REPOSITORY';

/**
 * Generic 404 used whenever the requested child is not associated with the
 * authenticated parent (including a child in another school, a soft-deleted
 * link or an unknown id). Collapsing every failure into one message means the
 * API never reveals that a student exists under a different parent/school.
 */
export const PARENT_PORTAL_CHILD_NOT_FOUND_MESSAGE =
  'The requested child is not associated with this parent account.';

/** Detail shown when the parent has no active guardian links at all. */
export const PARENT_PORTAL_NO_CHILDREN_MESSAGE =
  "You don't have any children assigned to your account.";

/** Shown to a parent whose tenant school is not found (defensive). */
export const PARENT_PORTAL_SCHOOL_NOT_FOUND_MESSAGE =
  'Your school could not be found. Please contact the school.';
