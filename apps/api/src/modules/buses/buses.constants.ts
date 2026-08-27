/**
 * Injection tokens and user-facing messages for the bus management module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern used by AuthModule,
 * StudentsModule and ParentsModule.
 */
export const BUSES_REPOSITORY = 'BUSES_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish "does not
 * exist" from "exists in another tenant" so cross-tenant probes cannot learn
 * anything about other schools' buses.
 */
export const BUS_NOT_FOUND_MESSAGE = 'Bus not found';

/** Message returned when a registration number conflicts inside one school. */
export const BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE =
  'A bus with this registration number already exists in this school';

/** Message returned when a fleet bus number conflicts inside one school. */
export const BUS_NUMBER_TAKEN_MESSAGE = 'A bus with this bus number already exists in this school';

/** Confirmation message returned by soft delete. */
export const BUS_DELETED_MESSAGE = 'Bus deleted successfully';
