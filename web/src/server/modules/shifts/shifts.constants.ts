/**
 * Injection tokens and user-facing messages for the shifts module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern every feature module uses.
 */
export const SHIFTS_REPOSITORY = 'SHIFTS_REPOSITORY';

/** Token for the run repository used by the delete guard and the run count. */
export const SHIFTS_RUNS_REPOSITORY = 'SHIFTS_RUNS_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish "does not
 * exist" from "exists in another tenant" so cross-tenant probes cannot learn
 * anything about other schools' shifts.
 */
export const SHIFT_NOT_FOUND_MESSAGE = 'Shift not found';

/** Message returned when a shift name conflicts inside one school. */
export const SHIFT_NAME_TAKEN_MESSAGE = 'A shift with this name already exists in this school';

/** Message returned when `end_time` is not later than `start_time`. */
export const SHIFT_WINDOW_INVALID_MESSAGE = 'end_time must be later than start_time';

/**
 * `DELETE /shifts/:id` refuses (409) while the shift still has live runs —
 * retiring a window that dispatches depend on is an operator error, not a
 * cascade (`docs/operating-model.md` §8.1).
 */
export const SHIFT_HAS_RUNS_MESSAGE =
  'This shift still has runs attached. Move or delete those runs before deleting the shift';

/** Confirmation message returned by soft delete. */
export const SHIFT_DELETED_MESSAGE = 'Shift deleted successfully';
