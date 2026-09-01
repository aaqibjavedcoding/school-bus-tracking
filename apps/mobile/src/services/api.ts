import { createApiClient, type ApiClient } from '@school-bus-tracking/api-client';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { getAccessToken, notifyUnauthorized, setAccessToken } from './session.ts';

/**
 * The one API client for the whole mobile app — the exact same
 * `@school-bus-tracking/api-client` the web app uses, pointed at the same
 * REST API. No mobile-specific backend logic exists anywhere in this app.
 *
 * `EXPO_PUBLIC_API_URL` (e.g. `http://192.168.1.20:3001/api/v1`) selects the
 * API origin for a device build. Falls back to a development-friendly URL
 * that works for emulators and the web, but physical devices on the same
 * WiFi network must set `EXPO_PUBLIC_API_URL` to the machine's local IP.
 */
const localApiUrl = process.env.EXPO_PUBLIC_API_URL;
if (localApiUrl) {
  API_BASE_URL = localApiUrl;
} else {
  // Default: works for web and emulators (10.0.2.2 maps to host localhost).
  // Physical devices must set EXPO_PUBLIC_API_URL to their machine's
  // local IP on the WiFi network (e.g. http://192.168.1.20:3001/api/v1).
  API_BASE_URL = `http://10.0.2.2:3001/${APP_CONFIG.apiPrefix}`;
}

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
