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

// ── Crew PIN + QR login (Mobile-UX Phase 4) ─────────────────────────────────

/**
 * Single generic message for **every** crew credential failure: unknown user,
 * user in another tenant, account not a DRIVER/CONDUCTOR, deactivated account,
 * no PIN ever set, and wrong PIN.
 *
 * Reusing the email/password rule (`INVALID_CREDENTIALS_MESSAGE`) is deliberate
 * and load-bearing. The PIN branch takes a client-supplied `user_id`, so any
 * distinguishing message — "no PIN set", "not a crew account", "unknown user" —
 * would be an oracle that turns a list of UUIDs into a list of *drivers*. The
 * per-user lockout is keyed and incremented whether or not the account exists,
 * and exactly one bcrypt comparison runs either way (see
 * `PIN_TIMING_EQUALIZATION_HASH`), so neither the message, the attempt
 * countdown nor the response timing reveals which case applied.
 */
export const INVALID_CREW_CREDENTIALS_MESSAGE = INVALID_CREDENTIALS_MESSAGE;

/**
 * Message for every QR pairing failure: malformed, unknown, expired or already
 * consumed. One message for the same reason as above — a code is a secret, and
 * telling an attacker "expired" versus "never existed" narrows their search.
 */
export const INVALID_PAIRING_CODE_MESSAGE = 'Invalid or expired pairing code';

/**
 * Message returned while a crew account is inside its PIN lockout window.
 *
 * Unlike the credential failures this one is *specific on purpose*: the caller
 * has already proved they know which account they are attacking, the lockout is
 * a throttle the legitimate user needs explained to them ("wait, or ask your
 * administrator to reset the PIN"), and hiding it would leave a driver staring
 * at a generic error for a quarter of an hour.
 */
export const CREW_PIN_LOCKED_MESSAGE = 'Too many incorrect PIN attempts. Try again later.';

/** Error-envelope `code` for a PIN lockout (HTTP 429). */
export const CREW_PIN_LOCKED_CODE = 'CREW_PIN_LOCKED';

/** Error-envelope `code` for a rejected crew credential (HTTP 401). */
export const CREW_PIN_INVALID_CODE = 'CREW_PIN_INVALID';

/** Error-envelope `code` for a rejected QR pairing code (HTTP 401). */
export const CREW_PAIRING_INVALID_CODE = 'CREW_PAIRING_INVALID';

/**
 * Valid bcrypt digest of a random throwaway value, used on the crew PIN path for
 * the same reason `TIMING_EQUALIZATION_HASH` exists on the password path: when
 * the account does not exist, or exists but has no PIN, exactly one bcrypt
 * comparison still runs so response timing cannot reveal which.
 */
export const PIN_TIMING_EQUALIZATION_HASH =
  '$2b$12$haAsEdkQOODaSSistEENOOOlN7eXiw32QUlozHEFDAJ2ZNoHZ99DO';

/** Roles allowed to hold a crew PIN and to use `POST /auth/crew-login`. */
export const CREW_LOGIN_ROLES = ['DRIVER', 'CONDUCTOR'] as const;

export type CrewLoginRole = (typeof CREW_LOGIN_ROLES)[number];

/**
 * Injection token for the `CrewPairingToken` model used by `CrewAuthService`.
 * Bound in `AuthModule`/the container; replaced by a stub in unit tests so the
 * pairing flow can be exercised without a database.
 */
export const CREW_PAIRING_TOKENS_REPOSITORY = 'AUTH_CREW_PAIRING_TOKENS_REPOSITORY';
