/**
 * In-memory access-token store (mobile port of the web session service).
 *
 * Refresh tokens live in the httpOnly cookie set by the API; React Native's
 * networking stack persists that cookie in the platform cookie jar, so
 * `POST /auth/refresh` keeps working across app restarts without the app ever
 * reading the cookie. The access token itself is kept in JS memory only —
 * never written to storage, never rendered, never logged.
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
