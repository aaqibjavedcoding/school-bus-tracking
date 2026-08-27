import { UserRole } from '@school-bus-tracking/shared-types';

/**
 * Injection tokens and user-facing messages for route assignment management.
 *
 * Repository classes are injected behind tokens instead of using
 * `SequelizeModule.forFeature`, matching the existing feature modules. This
 * keeps the API bootable with `DB_AUTO_CONNECT=false` and makes the service
 * straightforward to unit test with in-memory repositories.
 */
export const ROUTE_ASSIGNMENTS_REPOSITORY = 'ROUTE_ASSIGNMENTS_REPOSITORY';
export const ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY = 'ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY';
export const ROUTE_ASSIGNMENTS_BUSES_REPOSITORY = 'ROUTE_ASSIGNMENTS_BUSES_REPOSITORY';
export const ROUTE_ASSIGNMENTS_USERS_REPOSITORY = 'ROUTE_ASSIGNMENTS_USERS_REPOSITORY';

/** Short aliases for consumers that refer to the feature as assignments. */
export const ASSIGNMENTS_REPOSITORY = ROUTE_ASSIGNMENTS_REPOSITORY;
export const ASSIGNMENTS_ROUTES_REPOSITORY = ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY;
export const ASSIGNMENTS_BUSES_REPOSITORY = ROUTE_ASSIGNMENTS_BUSES_REPOSITORY;
export const ASSIGNMENTS_USERS_REPOSITORY = ROUTE_ASSIGNMENTS_USERS_REPOSITORY;

/**
 * Generic not-found message. It deliberately does not distinguish an unknown
 * id from an assignment belonging to another school.
 */
export const ROUTE_ASSIGNMENT_NOT_FOUND_MESSAGE = 'Route assignment not found';
export const ASSIGNMENT_NOT_FOUND_MESSAGE = ROUTE_ASSIGNMENT_NOT_FOUND_MESSAGE;

/** Messages for invalid or cross-tenant related resources. */
export const ROUTE_ASSIGNMENT_ROUTE_INVALID_MESSAGE =
  'Referenced route does not belong to this school';
export const ROUTE_ASSIGNMENT_BUS_INVALID_MESSAGE = 'Referenced bus does not belong to this school';
export const ROUTE_ASSIGNMENT_USER_INVALID_MESSAGE =
  'Referenced staff member does not belong to this school';
export const ROUTE_ASSIGNMENT_ROLE_MISMATCH_MESSAGE =
  'The assigned user does not have the selected staff role';
export const ROUTE_ASSIGNMENT_ROLE_INVALID_MESSAGE = `role must be ${UserRole.DRIVER} or ${UserRole.CONDUCTOR}`;
export const ROUTE_ASSIGNMENT_INACTIVE_RESOURCE_MESSAGE =
  'Route, bus and staff member must all be active for an active assignment';

/** Date validation messages. */
export const ROUTE_ASSIGNMENT_DATE_INVALID_MESSAGE =
  'effective_from and effective_to must be valid calendar dates in YYYY-MM-DD format';
export const ROUTE_ASSIGNMENT_DATE_RANGE_MESSAGE =
  'effective_to must be on or after effective_from';

/** Conflict messages. */
export const ROUTE_ASSIGNMENT_CONFLICT_MESSAGE =
  'The assignment conflicts with an existing active assignment';
export const ASSIGNMENT_CONFLICT_MESSAGE = ROUTE_ASSIGNMENT_CONFLICT_MESSAGE;
export const ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE =
  'This route already has an active assignment for this role during the selected period';
export const ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE =
  'This route already uses another bus during the selected period';
export const ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE =
  'This bus is already assigned to another route during the selected period';

/** Confirmation returned after a soft delete. */
export const ROUTE_ASSIGNMENT_DELETED_MESSAGE = 'Route assignment deleted successfully';
export const ASSIGNMENT_DELETED_MESSAGE = ROUTE_ASSIGNMENT_DELETED_MESSAGE;
