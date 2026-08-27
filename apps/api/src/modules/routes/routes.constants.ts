/**
 * Injection tokens and user-facing messages for the route management module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern used by AuthModule,
 * StudentsModule and ParentsModule.
 */
export const ROUTES_REPOSITORY = 'ROUTES_REPOSITORY';

/** Token for the stop repository used by the route stop manifest endpoints. */
export const ROUTES_STOPS_REPOSITORY = 'ROUTES_STOPS_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish "does not
 * exist" from "exists in another tenant" so cross-tenant probes cannot learn
 * anything about other schools' routes.
 */
export const ROUTE_NOT_FOUND_MESSAGE = 'Route not found';

/** Message returned when a route code conflicts inside one school. */
export const ROUTE_CODE_TAKEN_MESSAGE = 'A route with this code already exists in this school';

/** Confirmation message returned by soft delete. */
export const ROUTE_DELETED_MESSAGE = 'Route deleted successfully';

/** Message returned when a stop in the order payload is duplicated. */
export const ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE =
  'Each stop id must appear exactly once in stop_ids';

/** Message returned when the order payload does not list every route stop. */
export const ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE = 'stop_ids must contain every stop of the route';

/** Message returned when a stop id in the payload is not on this route. */
export const ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE =
  'One or more stop ids do not belong to this route';
