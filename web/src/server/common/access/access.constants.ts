/**
 * Injection tokens for the shared platform-access layer.
 *
 * The `School` model is provided behind a token (instead of
 * `SequelizeModule.forFeature`) so the application still boots while
 * `DB_AUTO_CONNECT=false` and unit tests can substitute stubs — the same
 * pattern used by AuthModule and the feature modules.
 */
export const SCHOOLS_PLATFORM_REPOSITORY = 'SCHOOLS_PLATFORM_REPOSITORY';

/**
 * `User` model behind a token, used by the shared access layer to enforce the
 * account-lifecycle rule (a deactivated user's existing JWT must stop
 * working). Same rationale as `SCHOOLS_PLATFORM_REPOSITORY`.
 */
export const USERS_PLATFORM_REPOSITORY = 'USERS_PLATFORM_REPOSITORY';
