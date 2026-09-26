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

// ── SCHOOL_ADMIN self-service password reset ────────────────────────────────

/**
 * The **one** response `POST /auth/forgot-password` ever gives.
 *
 * Identical for a matching SCHOOL_ADMIN, a matching account of any other
 * role, a matching-but-deactivated account, an unknown email, an unknown
 * school code and a deactivated school. Anything else — a different message,
 * a different status, a different response *shape*, even a reliably different
 * latency — turns the endpoint into a free directory of which schools use the
 * platform and who administers them.
 *
 * It is phrased so it is also the truthful thing to tell the one person who
 * legitimately sees it: it promises an email *if* an account exists, and does
 * not claim one was sent.
 */
export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for that school and email, a password reset email has been sent.';

/**
 * The **one** failure message `POST /auth/reset-password` gives for a token
 * that is unknown, expired, already used, or points at an account that may no
 * longer be reset.
 *
 * Same rule as above, one step later: "expired" versus "never existed" narrows
 * an attacker's search, and "this account can no longer be reset" would
 * confirm the account exists. The distinct reasons survive in
 * `inspectPasswordResetToken()` for logs and tests, never on the wire.
 */
export const INVALID_PASSWORD_RESET_TOKEN_MESSAGE =
  'This password reset link is invalid or has expired. Please request a new one.';

/** Confirmation returned by a successful `POST /auth/reset-password`. */
export const PASSWORD_RESET_SUCCESS_MESSAGE =
  'Your password has been updated. Please sign in with your new password.';

// ── Crew PIN + QR login (Mobile-UX Phase 4) ─────────────────────────────────

/**
 * Single generic message for **every** crew credential failure: unknown school
 * code, a school with no crew PINs at all, a deactivated account, and a wrong
 * PIN.
 *
 * Reusing the email/password rule (`INVALID_CREDENTIALS_MESSAGE`) is deliberate
 * and load-bearing. The PIN branch names a *tenant*, so any distinguishing
 * message — "no drivers here", "that school has no PINs set", "unknown code" —
 * would be an oracle that turns a list of school codes into a list of schools
 * that run buses with this app. The per-school lockout is keyed and incremented
 * whether or not the school resolves at all, and the same fixed number of
 * bcrypt comparisons runs either way (see `PIN_TIMING_EQUALIZATION_HASH`), so
 * neither the message, the attempt countdown nor the response timing reveals
 * which case applied.
 */
export const INVALID_CREW_CREDENTIALS_MESSAGE = INVALID_CREDENTIALS_MESSAGE;

/**
 * Error-envelope `code` for a PIN that matched **more than one** crew account
 * (HTTP 401), with {@link CREW_PIN_AMBIGUOUS_MESSAGE}.
 *
 * Reachable only by a PIN that genuinely verifies against two stored hashes at
 * the same school, which `CrewAuthService.setPin` refuses to create — so in a
 * healthy deployment this branch never fires, and it exists as defence in depth
 * for a database that was edited by hand or restored from a pre-uniqueness
 * backup. It leaks nothing a caller did not already earn: to reach it they had
 * to submit a PIN that is correct for two of that school's crew.
 */
export const CREW_PIN_AMBIGUOUS_CODE = 'CREW_PIN_AMBIGUOUS';

/**
 * Message for the ambiguous-PIN case. Unlike the credential failures this one
 * is *specific on purpose* — it is an instruction to a human ("tell your
 * admin"), and the situation it describes is an administrator's to fix, not a
 * secret to hide. No PIN value is ever interpolated into it.
 */
export const CREW_PIN_AMBIGUOUS_MESSAGE =
  'More than one crew member has this PIN. Ask your school admin to change it.';

/**
 * Error-envelope `code` for "another active crew member of this school already
 * has that PIN" (HTTP 409), with {@link CREW_PIN_DUPLICATE_MESSAGE}.
 */
export const CREW_PIN_DUPLICATE_CODE = 'CREW_PIN_DUPLICATE';

/**
 * Message an administrator sees when the PIN they are setting would collide
 * with another crew member's.
 *
 * Uniqueness is a *login* requirement, not a housekeeping preference: a PIN
 * login carries no user id, so the server resolves the account by finding which
 * crew member's hash the PIN verifies against. Two matches cannot be resolved,
 * and a PIN that was settable in one request must never make the login it
 * authorises unusable in the next.
 */
export const CREW_PIN_DUPLICATE_MESSAGE =
  'Another crew member at this school already uses that PIN. Choose a different one.';

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
 * Digest of a random throwaway value in the fast PBKDF2 format (see
 * `auth/password.util`), used on the crew PIN path for the same reason
 * `TIMING_EQUALIZATION_HASH` exists on the password path: when a school has no
 * crew PINs to compare against — or has fewer than `CREW_PIN_COMPARISON_COUNT`
 * of them — the missing comparisons still run, against this digest, so the
 * *number* of comparisons (and therefore the response time) says nothing about
 * whether a match was found or how many crew members a school has. The fast
 * format makes each padded comparison cost ~15 ms instead of ~250–300 ms of
 * pure-JS bcrypt, which is what keeps a driver/conductor login fast at a
 * school with few (or no) PINs set.
 */
export const PIN_TIMING_EQUALIZATION_HASH =
  '$2b$12$v..ZsEjUYb3zb7.Izh9iju$kWfPZdiXyVyhG9EsDmDaBYhayq9JrO';

/** Roles allowed to hold a crew PIN and to use `POST /auth/crew-login`. */
export const CREW_LOGIN_ROLES = ['DRIVER', 'CONDUCTOR'] as const;

export type CrewLoginRole = (typeof CREW_LOGIN_ROLES)[number];

/**
 * Injection token for the `CrewPairingToken` model used by `CrewAuthService`.
 * Bound in `AuthModule`/the container; replaced by a stub in unit tests so the
 * pairing flow can be exercised without a database.
 */
export const CREW_PAIRING_TOKENS_REPOSITORY = 'AUTH_CREW_PAIRING_TOKENS_REPOSITORY';
