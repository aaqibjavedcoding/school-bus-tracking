/**
 * Injection tokens and user-facing messages for the Super Admin plan
 * catalog (`/api/v1/admin/plans`).
 *
 * The Plan model is injected behind a token so the app still boots with
 * `DB_AUTO_CONNECT=false` and unit tests can substitute stubs — same pattern
 * used by the schools, buses and admin-schools modules.
 */
export const ADMIN_PLANS_REPOSITORY = 'ADMIN_PLANS_REPOSITORY';

/** Generic message when a plan cannot be found. */
export const PLAN_NOT_FOUND_MESSAGE = 'Plan not found';

/** Plan code conflict. */
export const PLAN_CODE_TAKEN_MESSAGE = 'A plan with this code already exists';

/** Activation/deactivation confirmation messages. */
export const PLAN_ACTIVATED_MESSAGE = 'Plan activated';
export const PLAN_DEACTIVATED_MESSAGE = 'Plan deactivated';

/** Monetary conversion: dollars (decimal) ↔ integer cents. */
export const CENTS_PER_UNIT = 100;
