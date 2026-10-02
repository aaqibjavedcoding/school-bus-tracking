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
 * Message returned when the school timezone is not a resolvable IANA name.
 * An unresolvable value would silently degrade trip day-math to UTC, so it is
 * rejected at write time instead of persisting a broken tenant.
 */
export const SCHOOL_TIMEZONE_INVALID_MESSAGE =
  'Please enter a valid IANA timezone, for example Asia/Kolkata';

/**
 * Message returned when the admin email already exists inside the target
 * school. Email uniqueness is tenant-scoped (`uq_users_school_email`), so an
 * email used by another school remains valid here.
 */
export const ADMIN_EMAIL_TAKEN_MESSAGE = 'A user with this email already exists in this school';

/** Generic message for any other tenant/identity uniqueness conflict. */
export const ONBOARDING_CONFLICT_MESSAGE = 'School or admin account already exists';
