/**
 * Injection tokens for the shared platform-access layer.
 *
 * The `School` model is provided behind a token (instead of
 * `SequelizeModule.forFeature`) so the application still boots while
 * `DB_AUTO_CONNECT=false` and unit tests can substitute stubs — the same
 * pattern used by AuthModule and the feature modules.
 */
export const SCHOOLS_PLATFORM_REPOSITORY = 'SCHOOLS_PLATFORM_REPOSITORY';
