import { TripStatus } from '@school-bus-tracking/shared-types';

/**
 * Injection tokens and user-facing messages for trip management.
 *
 * Repository classes are injected behind tokens instead of using
 * `SequelizeModule.forFeature`, matching every other feature module. This
 * keeps the API bootable with `DB_AUTO_CONNECT=false` and makes the service
 * straightforward to unit test with in-memory repositories.
 */
export const TRIPS_REPOSITORY = 'TRIPS_REPOSITORY';
export const TRIPS_ROUTE_ASSIGNMENTS_REPOSITORY = 'TRIPS_ROUTE_ASSIGNMENTS_REPOSITORY';
export const TRIPS_ROUTES_REPOSITORY = 'TRIPS_ROUTES_REPOSITORY';
export const TRIPS_BUSES_REPOSITORY = 'TRIPS_BUSES_REPOSITORY';
export const TRIPS_USERS_REPOSITORY = 'TRIPS_USERS_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish an unknown
 * id from a trip belonging to another school.
 */
export const TRIP_NOT_FOUND_MESSAGE = 'Trip not found';

/** Messages for invalid, cross-tenant or inactive related resources. */
export const TRIP_ASSIGNMENT_INVALID_MESSAGE =
  'Referenced route assignment does not belong to this school';
export const TRIP_ASSIGNMENT_INACTIVE_MESSAGE =
  'Referenced route assignment is not active and cannot be dispatched';
export const TRIP_ASSIGNMENT_PERIOD_MESSAGE =
  'Referenced route assignment is not effective on the scheduled trip date';
export const TRIP_ASSIGNMENT_BUS_MISSING_MESSAGE =
  'Referenced route assignment has no bus and cannot be dispatched';
export const TRIP_ROUTE_INVALID_MESSAGE = 'Referenced route does not belong to this school';
export const TRIP_BUS_INVALID_MESSAGE = 'Referenced bus does not belong to this school';
export const TRIP_DRIVER_INVALID_MESSAGE = 'Referenced driver does not belong to this school';
export const TRIP_CONDUCTOR_INVALID_MESSAGE = 'Referenced conductor does not belong to this school';
export const TRIP_DRIVER_MISSING_MESSAGE =
  'No active driver is rostered on this route for the scheduled trip date';
export const TRIP_INACTIVE_RESOURCE_MESSAGE =
  'Route, bus and crew must all be active to dispatch a trip';

/** Date and schedule validation messages. */
export const TRIP_DATE_INVALID_MESSAGE =
  'scheduled_start_at and scheduled_end_at must be valid ISO-8601 date-times';
export const TRIP_DATE_RANGE_MESSAGE = 'scheduled_end_at must be on or after scheduled_start_at';
export const TRIP_ACTUAL_RANGE_MESSAGE = 'actual_end_at must be on or after actual_start_at';
export const TRIP_QUERY_DATE_RANGE_MESSAGE = 'date_to must be on or after date_from';

/** Lifecycle messages. */
export const TRIP_INVALID_TRANSITION_MESSAGE = (from: TripStatus, to: TripStatus): string =>
  `Trip status cannot change from ${from} to ${to}`;
export const TRIP_NOT_EDITABLE_MESSAGE = `Only ${TripStatus.SCHEDULED} trips can be rescheduled`;
export const TRIP_ALREADY_TERMINAL_MESSAGE = 'Trip is already completed or cancelled';

/** Conflict message for the one-open-trip-per-route-and-departure rule. */
export const TRIP_CONFLICT_MESSAGE =
  'This route already has a trip scheduled at that departure time';

/** Confirmation returned after a soft delete. */
export const TRIP_DELETED_MESSAGE = 'Trip deleted successfully';
