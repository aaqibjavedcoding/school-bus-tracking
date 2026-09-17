/**
 * The **user-facing error boundary**: the one place where a technical failure
 * becomes a sentence a parent, driver or school admin can act on.
 *
 * Why this module exists (and is dependency-free):
 *
 * - the API client builds its `ApiClientError.message` from the transport
 *   details it happens to have — `Request failed with status 401`, and for a
 *   non-JSON body `Request failed with status 500: <!DOCTYPE html>…`. Those
 *   strings are *diagnostics*. Rendering them was the reported bug: a parent
 *   typing the wrong password was told "Request failed with status 401".
 * - the same class of leak arrives through other channels: a Nest default body
 *   (`{"statusCode":403,"message":"Forbidden"}`), a proxy's HTML page, a raw
 *   Postgres error on a 500, an axios `Network Error`, a React Native
 *   `TypeError: Network request failed`, a stack trace, a request id.
 * - every one of those must be *classified*, never printed. This module owns
 *   the classification: what counts as technical text, what a status means to
 *   a human, and what a safe fallback looks like.
 *
 * Deliberately imports **nothing** (no api-client, no i18n, no React Native),
 * so the pure decision modules that need it — `features/crew/offline/queue-core`
 * for the offline banner, `lib/i18n` for the localised twin — can use it while
 * staying loadable under plain `node --test` and without pulling a dependency
 * into the background sync path.
 *
 * Relationship to `lib/errors.ts` / `lib/i18n.ts`:
 *
 * - `errors.ts`  — the adapter over this module for thrown errors (the API
 *   client's, fetch's, anything caught in a screen).
 * - `i18n.ts`    — the localised twin: the same classification, but the copy
 *   comes from the active dictionary (en / hi / mr) instead of the English
 *   constants below.
 *
 * Nothing here may ever contain an HTTP status code, a stack frame, a driver
 * name or a request id — the constants below are the app's own copy, and the
 * `*_spec` files assert that no technical string survives classification.
 */

/** Which sentence set to use when the status alone has to speak. */
export type ErrorMessageContext =
  /**
   * Default: the caller is (or was) signed in. A 401 therefore means the
   * session went away, not a bad password.
   */
  | 'session'
  /** A credential form is asking for a password — a 401 means wrong password. */
  | 'login';

/**
 * The app's own error copy (English). The localised equivalents for the crew
 * surfaces live in `i18n.en/hi/mr.ts` under the `error.*` keys.
 *
 * Written as complete, actionable sentences: what happened, what the person
 * can do next. No codes, no "request", no "server responded".
 */
export const USER_MESSAGES = {
  /** Nothing reached the API: offline, DNS, TLS, timeout, captive portal. */
  network: 'Unable to connect. Please check your internet connection and try again.',
  /** 400 — the request itself was not acceptable. */
  badRequest: 'Please check the information and try again.',
  /**
   * 401 on a credential form. (A generic "Invalid credentials" sentence is
   * deliberately *not* used: the form knows what it asked for, so it can name
   * it — email/password here, the PIN pad's own copy on the crew path.)
   */
  loginCredentials: 'Invalid email or password. Please check your credentials and try again.',
  /** 401 while signed in — the refresh cookie is gone or was revoked. */
  sessionExpired: 'Your session has expired. Please sign in again.',
  /** 403 — role / account / school inactive. */
  forbidden: "You don't have permission to perform this action.",
  /** 404 — the row was deleted, or moved out of this school's scope. */
  notFound: 'The requested information was not found.',
  /** 409 — the row changed underneath the action (already done, plan limit…). */
  conflict: 'This action conflicts with the current data. Please try again.',
  /** 422 — field-level validation the server rejected. */
  validation: 'Please check the entered information.',
  /** 429 — rate limit / lockout. */
  tooManyAttempts: 'Too many attempts. Please try again later.',
  /** 5xx — the API failed, not the user. */
  server: 'Something went wrong. Please try again later.',
  /** Last resort, no status and no usable message. */
  unknown: 'Something went wrong',
} as const;

/**
 * True for a response body that is a *document*, not a message: a framework or
 * proxy HTML/XML error page, or a captive-portal login screen. Such a body
 * must never be rendered verbatim as error text.
 */
export function isRawDocumentBody(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const head = value.trimStart().slice(0, 256).toLowerCase();
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<?xml') ||
    /^<[a-z][\s\S]*>/.test(head)
  );
}

/**
 * HTTP reason phrases: what a framework's *default* exception body puts in
 * `message` and what a proxy puts in its plain-text body. They carry no
 * information a user can act on ("Forbidden" ≠ "your school is inactive"), so
 * they are classified as technical and replaced with the app's own copy.
 */
const REASON_PHRASES = new Set([
  'bad request',
  'bad gateway',
  'conflict',
  'forbidden',
  'gateway timeout',
  'internal server error',
  'method not allowed',
  'not acceptable',
  'not found',
  'not implemented',
  'payload too large',
  'request timeout',
  'service unavailable',
  'too many requests',
  'unauthorized',
  'unavailable',
  'unprocessable content',
  'unprocessable entity',
  'unsupported media type',
]);

/** Transport-layer failures (axios / fetch / React Native / Node). */
const NETWORK_PATTERNS: RegExp[] = [
  /\bnetwork request failed\b/i, // React Native fetch
  /^network error$/i, // axios
  /^failed to fetch$/i, // browser fetch
  /^fetch failed$/i, // Node 18+ fetch
  /^load failed$/i, // Safari
  /\bsocket hang up\b/i,
  /\brequest aborted\b/i,
  /^aborted$/i,
  /^timeout of \d+\s*ms exceeded/i, // axios timeout
  /^timeout exceeded$/i,
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH)\b/,
  /\b(ERR_NETWORK|ERR_CONNECTION_\w+|ERR_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED)\b/,
];

/** Everything else that must never reach a screen. */
const TECHNICAL_PATTERNS: RegExp[] = [
  // 1. The API client's own message — the bug this module exists for.
  /request failed with status/i,
  /\bhttp\s*\/?\s*[1-5]\d{2}\b/i,
  /\bstatus(?:\s+code)?\s*[:=]?\s*[1-5]\d{2}\b/i,
  // 2. Runtime exception text (JS engines, Node, React Native).
  /^(type|reference|range|syntax|eval|uri)error\b/i,
  /\bundefined is not (a function|an object)\b/i,
  /\bis not a function\b/i,
  /cannot read propert/i,
  /body stream already read/i,
  /unexpected token .*(in json|is not valid json)/i,
  /unexpected end of (json|input)/i,
  /\bjson\.parse\b/i,
  /\bunhandled (promise )?rejection\b/i,
  /\bmaximum call stack\b/i,
  /\bout of memory\b/i,
  /(^|\n)\s*at\s+[\w$.<>[\](),:\s/-]+/, // a stack frame
  // 3. Request / trace identifiers — diagnostics for support, not for users.
  /\b(request|trace|correlation)\s*[-_]?\s*id\b/i,
  /\bx-request-id\b/i,
  // 4. Persistence leaks. (`sequelize` without a trailing boundary: the
  //    driver's own class is `SequelizeUniqueConstraintError`.)
  /\bsequelize/i,
  /\bqueryfailederror\b/i,
  /\bduplicate key value violates unique constraint\b/i,
  /\bER_[A-Z0-9_]+\b/,
  /\bSQLSTATE\b/,
  /relation "[^"]*" does not exist/i,
  /column "[^"]*" does not exist/i,
  /\bORA-\d{4,5}\b/,
  /\bmongo(server)?error\b/i,
  /\bprismaclient\b/i,
  // 5. Raw server error objects / framework defaults.
  /^\s*[{[]/, // a serialised object or array is never a message
  /\bstack\s*[:=]/i,
  /\btraceback\b/i,
];

/**
 * True when a string is a **technical diagnostic** rather than something to
 * show a user: the API client's own message, a transport/framework error, a
 * stack trace, a raw document, a bare HTTP reason phrase, a request id or a
 * database error.
 *
 * A safe server message — "You've reached your plan limit of 50 buses.", "A
 * student with this admission number already exists.", "Run overlaps the 07:10
 * window" — deliberately returns `false`: it is the most specific, most useful
 * text available and `getApiErrorMessage` shows it verbatim.
 */
export function isTechnicalMessage(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }
  const text = value.trim();
  if (text.length === 0) {
    return true;
  }
  if (isRawDocumentBody(text)) {
    return true;
  }
  const lower = text.toLowerCase();
  if (REASON_PHRASES.has(lower)) {
    return true;
  }
  return [/^unknown (network )?error$/i, ...TECHNICAL_PATTERNS, ...NETWORK_PATTERNS].some(
    (pattern) => pattern.test(text),
  );
}

/** True when a message describes a failure to *reach* the API. */
export function isNetworkFailureMessage(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const text = value.trim();
  return NETWORK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The sanitised form of a candidate message: the trimmed text when it is safe
 * to show, `null` when it is technical, empty or not a string at all.
 *
 * Callers use it as `sanitizeUserFacingMessage(candidate) ?? theirFallback`,
 * so a bad candidate can never fall through to the raw value.
 */
export function sanitizeUserFacingMessage(value: unknown): string | null {
  if (typeof value !== 'string' || isTechnicalMessage(value)) {
    return null;
  }
  return value.trim();
}

/**
 * User-facing text for an error the API did not describe itself.
 *
 * `status` is the HTTP status the client saw (`0` when the request never
 * reached the API). `fallback` is the calling screen's own sentence — used for
 * the statuses that need no special wording, and only when it is itself safe.
 */
export function statusFallbackMessage(
  status: number,
  fallback?: string,
  context: ErrorMessageContext = 'session',
): string {
  if (status === 0 || status === 408) {
    return USER_MESSAGES.network;
  }
  if (status === 400) {
    return USER_MESSAGES.badRequest;
  }
  if (status === 401) {
    return context === 'login' ? USER_MESSAGES.loginCredentials : USER_MESSAGES.sessionExpired;
  }
  if (status === 403) {
    return USER_MESSAGES.forbidden;
  }
  if (status === 404) {
    return USER_MESSAGES.notFound;
  }
  if (status === 409) {
    return USER_MESSAGES.conflict;
  }
  if (status === 422) {
    return USER_MESSAGES.validation;
  }
  if (status === 429) {
    return USER_MESSAGES.tooManyAttempts;
  }
  if (status >= 500) {
    return USER_MESSAGES.server;
  }
  return sanitizeUserFacingMessage(fallback) ?? USER_MESSAGES.unknown;
}
