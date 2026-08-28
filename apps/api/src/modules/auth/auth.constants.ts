/**
 * Injection token for the tenant-scoped user lookup used by AuthService.
 * Bound to the `User` sequelize-typescript model in AuthModule; replaced by a
 * stub in unit tests so login logic can be tested without a database.
 */
export const USERS_REPOSITORY = 'AUTH_USERS_REPOSITORY';

/**
 * Injection token for the refresh tokens repository used by AuthService.
 * Bound to the `RefreshToken` sequelize-typescript model in AuthModule;
 * replaced by a stub in unit tests so session management can be tested
 * without a database.
 */
export const REFRESH_TOKENS_REPOSITORY = 'AUTH_REFRESH_TOKENS_REPOSITORY';

/**
 * Injection token for the `School` model used to resolve a tenant `code`
 * supplied at login into its `school_id`. Bound to the `School`
 * sequelize-typescript model in AuthModule; optional in unit tests (a UUID
 * tenant id needs no school lookup).
 */
export const AUTH_SCHOOLS_REPOSITORY = 'AUTH_SCHOOLS_REPOSITORY';

/**
 * Single generic message for every credential failure (unknown school,
 * unknown email, wrong password, inactive account). A single message avoids
 * leaking which part of the credentials was wrong (account enumeration).
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

/**
 * Message returned when a refresh token is missing, malformed, or not found.
 */
export const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';

/**
 * Message returned when a revoked refresh token is presented.
 */
export const REVOKED_REFRESH_TOKEN_MESSAGE = 'Refresh token has been revoked';

/**
 * Message returned when an expired refresh token is presented.
 */
export const EXPIRED_REFRESH_TOKEN_MESSAGE = 'Refresh token has expired';

/**
 * Standard confirmation message returned upon successful logout.
 */
export const LOGOUT_SUCCESS_MESSAGE = 'Logged out successfully';

/**
 * Default name for the HTTP cookie carrying the refresh token.
 */
export const DEFAULT_REFRESH_COOKIE_NAME = 'refresh_token';
