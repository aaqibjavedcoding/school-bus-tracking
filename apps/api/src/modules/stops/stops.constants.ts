/**
 * Injection tokens and user-facing messages for the stop management module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern used by AuthModule,
 * StudentsModule and ParentsModule.
 */
export const STOPS_REPOSITORY = 'STOPS_REPOSITORY';

/** Token for the route repository used to validate stop↔route assignment. */
export const STOPS_ROUTES_REPOSITORY = 'STOPS_ROUTES_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish "does not
 * exist" from "exists in another tenant" so cross-tenant probes cannot learn
 * anything about other schools' stops.
 */
export const STOP_NOT_FOUND_MESSAGE = 'Stop not found';

/**
 * Message returned when a referenced `route_id` does not belong to the
 * authenticated school. Also generic: a route of another tenant is reported
 * the same way as a route that does not exist at all.
 */
export const STOP_ROUTE_INVALID_MESSAGE = 'Referenced route does not belong to this school';

/**
 * Message returned when a stop already occupies the requested position on
 * the route (the database enforces a unique active (route_id,
 * sequence_number)).
 */
export const STOP_SEQUENCE_TAKEN_MESSAGE = 'A stop already exists at this position on the route';

/** Confirmation message returned by soft delete. */
export const STOP_DELETED_MESSAGE = 'Stop deleted successfully';
