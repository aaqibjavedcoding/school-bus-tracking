/**
 * Injection tokens and user-facing messages for the runs module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern every feature module uses.
 */
export const RUNS_REPOSITORY = 'RUNS_REPOSITORY';
export const RUNS_ROUTES_REPOSITORY = 'RUNS_ROUTES_REPOSITORY';
export const RUNS_SHIFTS_REPOSITORY = 'RUNS_SHIFTS_REPOSITORY';
export const RUNS_BUSES_REPOSITORY = 'RUNS_BUSES_REPOSITORY';
export const RUNS_RUN_CREW_REPOSITORY = 'RUNS_RUN_CREW_REPOSITORY';
export const RUNS_USERS_REPOSITORY = 'RUNS_USERS_REPOSITORY';
export const RUNS_STUDENTS_REPOSITORY = 'RUNS_STUDENTS_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish "does not
 * exist" from "exists in another tenant" so cross-tenant probes cannot learn
 * anything about other schools' runs.
 */
export const RUN_NOT_FOUND_MESSAGE = 'Run not found';

/** Messages for invalid or cross-tenant related resources (same generic 400). */
export const RUN_ROUTE_INVALID_MESSAGE = 'Referenced route does not belong to this school';
export const RUN_SHIFT_INVALID_MESSAGE = 'Referenced shift does not belong to this school';
export const RUN_BUS_INVALID_MESSAGE = 'Referenced bus does not belong to this school';
export const RUN_INACTIVE_RESOURCE_MESSAGE =
  'Route, shift and bus must all be active for an active run';

/** Message returned when a run code conflicts inside one school. */
export const RUN_CODE_TAKEN_MESSAGE = 'A run with this code already exists in this school';

/**
 * §4.2 conflict messages (the run-based engine, `run-conflicts.ts`). The old
 * `CREW_ROUTE` message in `modules/assignments/assignments.constants.ts` is
 * superseded by `RUN_CREW_RUN_CONFLICT_MESSAGE`; the rule no longer mentions
 * routes because it compares runs.
 */
export const RUN_ROLE_CONFLICT_MESSAGE =
  'This run already has an active crew member for this role during the selected period';
export const RUN_BUS_CONFLICT_MESSAGE =
  'This bus is already assigned to another run during an overlapping shift window';
export const RUN_CREW_RUN_CONFLICT_MESSAGE =
  'This driver or conductor is already assigned to another run during an overlapping shift window';

/**
 * Derived-code exhaustion. Only reachable when every `<route code>-N` suffix
 * up to {@link RUN_CODE_MAX_SUFFIX} is taken by a live run of the school.
 */
export const RUN_CODE_UNAVAILABLE_MESSAGE =
  'Could not derive a free run code from the route code; supply a code explicitly';

/** Upper bound for the auto-derived `<route code>-N` suffix search. */
export const RUN_CODE_MAX_SUFFIX = 99;

/**
 * The default run of a route cannot be deleted on its own: legacy read paths
 * resolve through it (`docs/operating-model.md` §6.1) and it goes away with
 * its route. Deactivating it hands the quota back instead.
 */
export const RUN_DEFAULT_UNDELETABLE_MESSAGE =
  'The default run of a route cannot be deleted; deactivate it or delete the route';

/** Confirmation message returned by soft delete. */
export const RUN_DELETED_MESSAGE = 'Run deleted successfully';
