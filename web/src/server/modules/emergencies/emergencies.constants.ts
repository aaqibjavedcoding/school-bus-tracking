/**
 * Injection tokens and user-facing messages for the emergency / SOS feature
 * (Task 44).
 *
 * Model classes are injected behind tokens (instead of
 * `SequelizeModule.forFeature`) so the application still boots while
 * `DB_AUTO_CONNECT=false` and unit tests can substitute in-memory stubs —
 * the same pattern used by every other feature module.
 */
export const EMERGENCIES_REPOSITORY = 'EMERGENCIES_REPOSITORY';
export const EMERGENCIES_TRIP_REPOSITORY = 'EMERGENCIES_TRIP_REPOSITORY';
export const EMERGENCIES_BUS_REPOSITORY = 'EMERGENCIES_BUS_REPOSITORY';
export const EMERGENCIES_ROUTE_REPOSITORY = 'EMERGENCIES_ROUTE_REPOSITORY';
export const EMERGENCIES_USER_REPOSITORY = 'EMERGENCIES_USER_REPOSITORY';

/** Default page size and hard bound of the emergency list endpoints. */
export const DEFAULT_EMERGENCY_LIMIT = 20;
export const MAX_EMERGENCY_LIMIT = 100;

/**
 * Generic not-found message for an emergency event.
 *
 * Deliberately identical for an unknown id and an event of another tenant, so
 * probing ids can never confirm that an incident exists.
 */
export const EMERGENCY_NOT_FOUND_MESSAGE = 'Emergency event not found';

/** Raised when the crew member references a trip they are not rostered on. */
export const EMERGENCY_TRIP_NOT_FOUND_MESSAGE = 'Trip not found';

/** Raised when a lifecycle transition is not allowed by the state machine. */
export const EMERGENCY_STATUS_TRANSITION_MESSAGE =
  'This emergency status transition is not allowed';

/** Raised when the caller may not change an event's status. */
export const EMERGENCY_STATUS_FORBIDDEN_MESSAGE =
  'You are not allowed to change the status of this emergency event';

/** Raised when a half coordinate pair is supplied. */
export const EMERGENCY_COORDINATES_PAIR_MESSAGE =
  'latitude and longitude must be supplied together';
