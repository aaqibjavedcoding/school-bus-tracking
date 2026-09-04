/**
 * Injection tokens and user-facing messages for the school onboarding module.
 *
 * Models are injected behind tokens (instead of `SequelizeModule.forFeature`)
 * so the application still boots while `DB_AUTO_CONNECT=false` and unit tests
 * can substitute in-memory stubs — the same pattern used by AuthModule.
 */
export const SCHOOLS_REPOSITORY = 'SCHOOLS_REPOSITORY';
export const SCHOOLS_USERS_REPOSITORY = 'SCHOOLS_USERS_REPOSITORY';

/** Message returned when `schools.code` conflicts with an existing tenant. */
export const SCHOOL_CODE_TAKEN_MESSAGE = 'A school with this code already exists';

/**
 * Message returned when the admin email already exists inside the target
 * school. Email uniqueness is tenant-scoped (`uq_users_school_email`), so an
 * email used by another school remains valid here.
 */
export const ADMIN_EMAIL_TAKEN_MESSAGE = 'A user with this email already exists in this school';

/** Generic message for any other tenant/identity uniqueness conflict. */
export const ONBOARDING_CONFLICT_MESSAGE = 'School or admin account already exists';
