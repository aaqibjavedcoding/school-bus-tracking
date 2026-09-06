import { UserRole } from '@school-bus-tracking/shared-types';
import {
  RUN_CREW_RUN_CONFLICT_MESSAGE,
  RUN_ROLE_CONFLICT_MESSAGE,
} from '../runs/runs.constants';

/**
 * Injection tokens and user-facing messages for the run-crew (per-run roster)
 * module. Repositories are injected behind tokens so the API boots with
 * `DB_AUTO_CONNECT=false` and unit tests can substitute in-memory stubs.
 */
export const RUN_CREW_REPOSITORY = 'RUN_CREW_REPOSITORY';
export const RUN_CREW_RUNS_REPOSITORY = 'RUN_CREW_RUNS_REPOSITORY';
export const RUN_CREW_ROUTES_REPOSITORY = 'RUN_CREW_ROUTES_REPOSITORY';
export const RUN_CREW_USERS_REPOSITORY = 'RUN_CREW_USERS_REPOSITORY';

/**
 * Generic not-found message. It deliberately does not distinguish an unknown
 * id from a roster row belonging to another school.
 */
export const RUN_CREW_NOT_FOUND_MESSAGE = 'Run crew entry not found';

/** Messages for invalid or cross-tenant related resources. */
export const RUN_CREW_RUN_INVALID_MESSAGE = 'Referenced run does not belong to this school';
export const RUN_CREW_USER_INVALID_MESSAGE =
  'Referenced staff member does not belong to this school';
export const RUN_CREW_ROLE_MISMATCH_MESSAGE =
  'The rostered user does not have the selected staff role';
export const RUN_CREW_ROLE_INVALID_MESSAGE = `role must be ${UserRole.DRIVER} or ${UserRole.CONDUCTOR}`;
export const RUN_CREW_INACTIVE_RESOURCE_MESSAGE =
  'Run and staff member must both be active for an active roster entry';

/** Date validation messages. */
export const RUN_CREW_DATE_INVALID_MESSAGE =
  'effective_from and effective_to must be valid calendar dates in YYYY-MM-DD format';
export const RUN_CREW_DATE_RANGE_MESSAGE = 'effective_to must be on or after effective_from';

/**
 * `uq_run_crew_run_user_role` — the same person cannot start the same role on
 * the same run twice on one day.
 */
export const RUN_CREW_DUPLICATE_MESSAGE =
  'This person already holds this role on this run from the same start date';

/**
 * `RUN_ROLE` (docs/operating-model.md §4.2): one run, one role, overlapping
 * roster windows. Enforced by the Session 2B conflict engine
 * (`modules/runs/run-conflicts`) together with `CREW_RUN`; the message lives
 * in `runs.constants` and is re-exported here so roster-feature consumers
 * keep importing from this module.
 */
export const RUN_CREW_ROLE_CONFLICT_MESSAGE = RUN_ROLE_CONFLICT_MESSAGE;

/**
 * `CREW_RUN` (§4.2): one person cannot cover two runs whose shift windows
 * overlap. Alias of the conflict-engine message.
 */
export const RUN_CREW_CREW_RUN_CONFLICT_MESSAGE = RUN_CREW_RUN_CONFLICT_MESSAGE;

/** Confirmation returned after a soft delete. */
export const RUN_CREW_DELETED_MESSAGE = 'Run crew entry deleted successfully';
