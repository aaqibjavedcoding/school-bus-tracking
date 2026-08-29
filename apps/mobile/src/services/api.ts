import { createApiClient, type ApiClient } from '@school-bus-tracking/api-client';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { getAccessToken, notifyUnauthorized, setAccessToken } from './session.ts';

/**
 * The one API client for the whole mobile app — the exact same
 * `@school-bus-tracking/api-client` the web app uses, pointed at the same
 * REST API. No mobile-specific backend logic exists anywhere in this app.
 *
 * `EXPO_PUBLIC_API_URL` (e.g. `http://192.168.1.20:3001/api/v1`) selects the
 * API origin for a device build; the default matches local development.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || `http://localhost:3001/${APP_CONFIG.apiPrefix}`;

export const apiClient: ApiClient = createApiClient({
  baseUrl: API_BASE_URL,
  getAccessToken,
  setAccessToken,
  onUnauthorized: notifyUnauthorized,
});

/**
 * Socket.IO origin for the same API server. The client strips the REST prefix
 * (`/api/v1`) so the engine.io endpoint is `<origin>/socket.io` — identical
 * to what the API serves and the web app proxies.
 */
export function socketOrigin(apiBaseUrl: string = API_BASE_URL): string {
  const withoutTrailingSlash = apiBaseUrl.replace(/\/+$/, '');
  return withoutTrailingSlash.replace(/\/api\/v1$/, '');
}
