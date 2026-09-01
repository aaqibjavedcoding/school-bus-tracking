/**
 * Injection tokens and user-facing messages for the Super Admin platform
 * module (`/api/v1/admin/*`).
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern used by every other
 * feature module.
 */
export const ADMIN_SCHOOLS_REPOSITORY = 'ADMIN_SCHOOLS_REPOSITORY';
export const ADMIN_USERS_REPOSITORY = 'ADMIN_USERS_REPOSITORY';
export const ADMIN_STUDENTS_REPOSITORY = 'ADMIN_STUDENTS_REPOSITORY';
export const ADMIN_BUSES_REPOSITORY = 'ADMIN_BUSES_REPOSITORY';
export const ADMIN_ROUTES_REPOSITORY = 'ADMIN_ROUTES_REPOSITORY';
export const ADMIN_STOPS_REPOSITORY = 'ADMIN_STOPS_REPOSITORY';
export const ADMIN_TRIPS_REPOSITORY = 'ADMIN_TRIPS_REPOSITORY';
export const ADMIN_REFRESH_TOKENS_REPOSITORY = 'ADMIN_REFRESH_TOKENS_REPOSITORY';

/** Generic message when a managed school cannot be found. */
export const SCHOOL_NOT_FOUND_MESSAGE = 'School not found';

/** Generic message when a school admin account cannot be found in the school. */
export const SCHOOL_ADMIN_NOT_FOUND_MESSAGE = 'School admin not found in this school';

/** Platform-wide message when a school code is already taken. */
export const ADMIN_SCHOOL_CODE_TAKEN_MESSAGE = 'A school with this code already exists';

/** Message when a subdomain is already assigned to another school. */
export const ADMIN_SCHOOL_SUBDOMAIN_TAKEN_MESSAGE = 'A school with this subdomain already exists';

/** Message when an admin email already exists inside the target school. */
export const ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE =
  'A user with this email already exists in this school';

/** Activation/deactivation confirmation messages. */
export const SCHOOL_ACTIVATED_MESSAGE = 'School activated';
export const SCHOOL_DEACTIVATED_MESSAGE = 'School deactivated';

/** Account lifecycle confirmation messages. */
export const SCHOOL_ADMIN_ACTIVATED_MESSAGE = 'School admin activated';
export const SCHOOL_ADMIN_DEACTIVATED_MESSAGE = 'School admin deactivated';
export const SCHOOL_ADMIN_PASSWORD_RESET_MESSAGE = 'Password updated successfully';

// Re-export plan-management constants from a single barrel so module wiring
// stays consistent.
export {
  ADMIN_PLANS_REPOSITORY,
  PLAN_NOT_FOUND_MESSAGE,
  PLAN_CODE_TAKEN_MESSAGE,
  PLAN_ACTIVATED_MESSAGE,
  PLAN_DEACTIVATED_MESSAGE,
  CENTS_PER_UNIT,
} from './admin-plans.constants';

// School subscription management constants (Task 42).
export {
  ADMIN_SUBSCRIPTIONS_REPOSITORY,
  NO_SUBSCRIPTION_INFO,
  SUBSCRIPTION_ALREADY_EXISTS_MESSAGE,
  SUBSCRIPTION_CANCELLED_MESSAGE,
  SUBSCRIPTION_NOT_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_CANCELLABLE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_PLAN_INACTIVE_MESSAGE,
} from './admin-subscriptions.constants';
