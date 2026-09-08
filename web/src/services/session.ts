/**
 * In-memory access-token store.
 *
 * Refresh tokens live in an httpOnly cookie set by the API. The access token
 * is kept in process memory only — it is never written to localStorage, never
 * rendered, and never logged.
 */

let accessToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  accessToken = null;
  unauthorizedHandler?.();
}

/**
 * Readable session-presence marker cookie (`sb_session`), mirrored with the
 * API's `SESSION_PRESENT_COOKIE_NAME` in `server/api/auth.ts`.
 *
 * The real refresh token is httpOnly, so a freshly loaded tab cannot tell
 * whether a session may exist without asking the server. On every page load
 * the AuthProvider used to fire `GET /auth/csrf` **and** `POST /auth/refresh`
 * merely to learn "anonymous" — two round trips per visitor on `/login` and
 * on every anonymous hard reload. The marker is a non-sensitive `1` set
 * alongside the refresh cookie on login and on every successful refresh, and
 * cleared by the API on logout and on refresh failure; its presence tells the
 * provider that a refresh attempt is worth making.
 *
 * The marker carries no secret and grants nothing: an absent marker never
 * blocks a real login, and the server never trusts it for anything.
 */

export const SESSION_PRESENT_COOKIE_NAME = 'sb_session';

function browserCookieJar(): string | null {
  return typeof document === 'undefined' ? null : document.cookie;
}

/** True when a session may exist (a refresh attempt is worthwhile). */
export function hasSessionPresentCookie(): boolean {
  const jar = browserCookieJar();
  if (!jar) {
    return false;
  }
  const wanted = `${SESSION_PRESENT_COOKIE_NAME}=`;
  return jar.split(';').some((part) => part.trim().startsWith(wanted));
}

/**
 * Drops the marker from the browser jar (logout/unauthorized fallback when
 * the API could not be reached to clear it server-side).
 */
export function clearSessionPresentCookie(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${SESSION_PRESENT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
