import { createApiClient, type ApiClient } from '@school-bus-tracking/api-client';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { getAccessToken, notifyUnauthorized, setAccessToken } from './session.ts';

/**
 * The one API client for the whole mobile app — the exact same
 * `@school-bus-tracking/api-client` the web app uses, pointed at the same
 * REST API. No mobile-specific backend logic exists anywhere in this app.
 *
 * This module is deliberately free of native imports (expo-constants,
 * react-native) so it stays loadable in the plain-Node unit tests. The
 * native runtime facts (platform, Metro dev-server host) are registered once
 * at app startup by `./api-env.ts` through `registerApiEnv`; until then (and
 * in tests) a localhost default is used.
 *
 * The base URL (`<origin>/api/v1`) is resolved in priority order:
 *
 * 1. `EXPO_PUBLIC_API_URL` — explicit override for any environment
 *    (e.g. `http://192.168.1.20:3001/api/v1`). Use it when the API runs on a
 *    different machine, behind a tunnel, or in a production build.
 * 2. The Metro dev-server host (`Constants.expoConfig.hostUri`, registered by
 *    `api-env.ts`) — in Expo Go and development builds this is the machine
 *    running `expo start` (its LAN IP in most setups), so a physical phone on
 *    the same WiFi reaches the API automatically: no env var and no manual IP
 *    editing required. The dev server's port is swapped for the API port
 *    (`EXPO_PUBLIC_API_PORT` to override the default 3001).
 * 3. Platform defaults for emulators and web: the Android emulator reaches
 *    the host machine via `10.0.2.2`; the iOS simulator and web share the
 *    host's `localhost`.
 */

export interface ApiEnv {
  /** True when running against a local Metro dev server (`__DEV__`). */
  dev: boolean;
  /** `android` / `ios` / `web` — or null when unknown (e.g. plain Node). */
  platform: string | null;
  /** `<host>:<port>` of the Metro dev server, e.g. `192.168.1.20:8081`. */
  devHost: string | null;
}

/** Native-free fallback used by Node tests and any non-dev runtime. */
const DEFAULT_ENV: ApiEnv = { dev: false, platform: null, devHost: null };

/** Registers the native runtime environment; recomputes the base URL. */
export function registerApiEnv(env: ApiEnv): void {
  const next = resolveApiBaseUrl(env);
  if (next !== API_BASE_URL) {
    API_BASE_URL = next;
    apiClient = createApiClient({
      baseUrl: API_BASE_URL,
      getAccessToken,
      setAccessToken,
      onUnauthorized: notifyUnauthorized,
    });
  }
}

export function resolveApiBaseUrl(env: ApiEnv): string {
  const apiPort = process.env.EXPO_PUBLIC_API_PORT ?? String(APP_CONFIG.defaultApiPort);

  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }

  if (env.dev && env.devHost) {
    const host = hostFromUri(env.devHost);
    if (host && !isLoopbackHost(host)) {
      return `http://${host}:${apiPort}/${APP_CONFIG.apiPrefix}`;
    }
    if (env.platform === 'android') {
      // Metro reached the emulator through a loopback (e.g. adb reverse):
      // inside the emulator, 10.0.2.2 is the host machine's localhost.
      return `http://10.0.2.2:${apiPort}/${APP_CONFIG.apiPrefix}`;
    }
  }

  return `http://localhost:${apiPort}/${APP_CONFIG.apiPrefix}`;
}

/** Extracts the hostname out of `host:port`, `scheme://host:port` or `[::1]:8081`. */
function hostFromUri(uri: string): string {
  const withoutScheme = uri.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const withoutPath = withoutScheme.split('/')[0];
  const lastColon = withoutPath.lastIndexOf(':');
  return lastColon > 0 ? withoutPath.slice(0, lastColon) : withoutPath;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export let API_BASE_URL = resolveApiBaseUrl(DEFAULT_ENV);

export let apiClient: ApiClient = createApiClient({
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
