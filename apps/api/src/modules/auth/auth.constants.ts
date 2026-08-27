/**
 * Injection token for the tenant-scoped user lookup used by AuthService.
 * Bound to the `User` sequelize-typescript model in AuthModule; replaced by a
 * stub in unit tests so login logic can be tested without a database.
 */
export const USERS_REPOSITORY = 'AUTH_USERS_REPOSITORY';

/**
 * Single generic message for every credential failure (unknown school,
 * unknown email, wrong password, inactive account). A single message avoids
 * leaking which part of the credentials was wrong (account enumeration).
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
