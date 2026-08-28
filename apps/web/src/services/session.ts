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
