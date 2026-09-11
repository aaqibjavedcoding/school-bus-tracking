import { createApiClient, type ApiClient } from '@school-bus-tracking/api-client';
import type { ApiResponse } from '@school-bus-tracking/shared-types';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { getAccessToken, notifyUnauthorized, setAccessToken } from './session.ts';
import { apiCache, cacheKey, isCacheableGet } from './api-cache.ts';

/**
 * The one API client for the whole mobile app — the exact same
 * `@school-bus-tracking/api-client` the web app uses, pointed at the same
 * REST API. No mobile-specific backend logic exists anywhere in this app.
 *
 * This module is deliberately free of native imports (expo-constants,
 * react-native) so it stays loadable in the plain-Node unit tests. The
 * native runtime facts (platform, Metro dev-server host) are registered once
 * at app startup by `./api-env.ts` through `registerApiEnv`; until then (and
 * in tests) a localhost default is used **in dev runtimes only**.
 *
 * The base URL (`<origin>/api/v1`) is resolved in priority order:
 *
 * 1. `EXPO_PUBLIC_API_URL` — explicit override for any environment
 *    (e.g. `http://192.168.1.20:3001/api/v1`). Use it when the API runs on a
 *    different machine, behind a tunnel, or in a production build. It is the
 *    ONLY source a standalone (release) build accepts: an APK has no Metro
 *    host to derive from, and `localhost` on a phone is the phone itself, so
 *    silently defaulting to it can never work. A release build without the
 *    variable therefore fails fast with an {@link ApiConfigurationError}
 *    that names the missing variable instead of firing requests at the
 *    device itself.
 * 2. The Metro dev-server host (`Constants.expoConfig.hostUri`, registered by
 *    `api-env.ts`) — in Expo Go and development builds this is the machine
 *    running `expo start` (its LAN IP in most setups), so a physical phone on
 *    the same WiFi reaches the API automatically: no env var and no manual IP
 *    editing required. The dev server's port is swapped for the API port
 *    (`EXPO_PUBLIC_API_PORT` to override the default 3001).
 * 3. Platform defaults **for dev runtimes only**: the Android emulator
 *    reaches the host machine via `10.0.2.2`; the iOS simulator and web share
 *    the host's `localhost`.
 *
 * Production note: the API issues its refresh cookie with `Secure;
 * SameSite=None`. Cookie-aware HTTP clients (a device's cookie jar) never
 * send a `Secure` cookie over plain `http://`, so an `EXPO_PUBLIC_API_URL`
 * that is HTTP only works against a development API. Against an API running
 * with `NODE_ENV=production` the session can never refresh — the URL must be
 * HTTPS there. This is loudly warned about at registration time.
 */

/** Raised when a release build runs without a usable API base URL. */
export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigurationError';
  }
}

/** Message naming the missing production configuration shown in release builds. */
export const API_URL_NOT_CONFIGURED_MESSAGE =
  'API URL is not configured for this build. Set EXPO_PUBLIC_API_URL to the deployed API base URL ' +
  '(e.g. https://api.your-domain.example/api/v1) via the EAS build profile env or an .env file, then rebuild.';

export interface ApiEnv {
  /** True when running against a local Metro dev server (`__DEV__`). */
  dev: boolean;
  /** `android` / `ios` / `web` — or null when unknown (e.g. plain Node). */
  platform: string | null;
  /** `<host>:<port>` of the Metro dev server, e.g. `192.168.1.20:8081`. */
  devHost: string | null;
}

/** Native-free fallback used by Node tests and any pre-registration runtime. */
const DEFAULT_ENV: ApiEnv = { dev: false, platform: null, devHost: null };

/** Registers the native runtime environment; recomputes the base URL. */
export function registerApiEnv(env: ApiEnv): void {
  const next = resolveApiBaseUrlSafe(env);
  if (next.ok) {
    if (next.url !== API_BASE_URL || activeClient === null) {
      API_BASE_URL = next.url;
      configError = null;
      activeClient = buildClient(API_BASE_URL);
    }
  } else {
    // A release build without the variable never silently targets localhost:
    // the failure is stored and every client/socket use fails with the
    // configuration error instead.
    API_BASE_URL = null;
    configError = next.error;
    activeClient = null;
  }
}

type UrlResolution = { ok: true; url: string } | { ok: false; error: ApiConfigurationError };

/**
 * Resolve the base URL without throwing: callers keep running so the app can
 * surface the configuration error at first API use (login screen) rather than
 * crashing during module evaluation.
 */
function resolveApiBaseUrlSafe(env: ApiEnv): UrlResolution {
  try {
    return { ok: true, url: resolveApiBaseUrl(env) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ApiConfigurationError
          ? error
          : new ApiConfigurationError(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function resolveApiBaseUrl(env: ApiEnv): string {
  const apiPort =
    process.env.EXPO_PUBLIC_API_PORT?.trim() || String(APP_CONFIG.defaultApiPort);

  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    const url = fromEnv.replace(/\/+$/, '');
    const host = hostFromUri(url);
    if (!env.dev && isLoopbackHost(host)) {
      // A standalone build that bakes in a loopback API URL can only ever
      // reach the phone it runs on — that is a build misconfiguration, never
      // a usable API. Say so instead of "Network request failed".
      throw new ApiConfigurationError(
        `EXPO_PUBLIC_API_URL ("${url}") points at localhost, which a standalone build can never reach. ` +
          API_URL_NOT_CONFIGURED_MESSAGE,
      );
    }
    warnIfHttpReleaseUrl(env, url);
    return url;
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

  if (env.dev) {
    return `http://localhost:${apiPort}/${APP_CONFIG.apiPrefix}`;
  }

  throw new ApiConfigurationError(API_URL_NOT_CONFIGURED_MESSAGE);
}

function warnIfHttpReleaseUrl(env: ApiEnv, url: string): void {
  if (env.dev) {
    return;
  }
  const host = hostFromUri(url);
  if (url.startsWith('http://') && !isLoopbackHost(host) && host !== '10.0.2.2') {
    // eslint-disable-next-line no-console
    console.warn(
      '[api] EXPO_PUBLIC_API_URL is plain http://. An API running with NODE_ENV=production issues ' +
        'its refresh cookie with the Secure attribute, which no device cookie jar sends over HTTP — ' +
        'sessions would expire (and sign out) on every token refresh. Serve the API over HTTPS.',
    );
  }
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

/**
 * Builds a client instance against `baseUrl` with the app's session wiring.
 * The response cache is applied exactly once per instance.
 */
function buildClient(baseUrl: string): ApiClient {
  return applyResponseCache(
    createApiClient({
      baseUrl,
      getAccessToken,
      setAccessToken,
      onUnauthorized: notifyUnauthorized,
    }),
  );
}

/**
 * Mutable client state. `activeClient` is the instance every call is
 * delegated to; `configError` is set when a release build has no usable API
 * URL, in which case any client use throws that error instead of networking.
 */
let activeClient: ApiClient | null = null;
let configError: ApiConfigurationError | null = null;
export let API_BASE_URL: string | null = null;

const initialResolution = resolveApiBaseUrlSafe(DEFAULT_ENV);
if (initialResolution.ok) {
  API_BASE_URL = initialResolution.url;
  activeClient = buildClient(API_BASE_URL);
} else {
  configError = initialResolution.error;
}

function requireApiClient(): ApiClient {
  if (activeClient) {
    return activeClient;
  }
  throw (configError ?? new ApiConfigurationError(API_URL_NOT_CONFIGURED_MESSAGE));
}

/**
 * The active configuration error, if any. A non-null value means no API call
 * can possibly succeed (release build without a reachable `EXPO_PUBLIC_API_URL`),
 * and callers should surface it upfront instead of letting users attempt
 * requests that can only fail.
 */
export function getApiConfigurationError(): ApiConfigurationError | null {
  return activeClient ? null : (configError ?? new ApiConfigurationError(API_URL_NOT_CONFIGURED_MESSAGE));
}

/**
 * The app-wide API client. A transparent delegate in front of the (re)built
 * instance: `registerApiEnv` swaps the instance underneath it at startup, and
 * a release build missing `EXPO_PUBLIC_API_URL` fails every call with the
 * precise configuration error — visible on the login screen — rather than a
 * silent request against the phone's own localhost.
 */
export const apiClient: ApiClient = new Proxy({} as ApiClient, {
  get(_target, prop) {
    const client = requireApiClient() as unknown as Record<PropertyKey, unknown>;
    const member = client[prop];
    return typeof member === 'function' ? (member as (...a: unknown[]) => unknown).bind(client) : member;
  },
  set(_target, prop, value) {
    (requireApiClient() as unknown as Record<PropertyKey, unknown>)[prop] = value;
    return true;
  },
});

/** Signature of the client's GET convenience method. */
type GetFn = <T>(endpoint: string, options?: RequestInit) => Promise<ApiResponse<T>>;
/** Signature of the client's body-carrying mutating convenience methods. */
type MutateFn = <T>(
  endpoint: string,
  body?: unknown,
  options?: RequestInit,
) => Promise<ApiResponse<T>>;
/** Signature of the client's DELETE convenience method. */
type DeleteFn = <T>(endpoint: string, options?: RequestInit) => Promise<ApiResponse<T>>;

/**
 * Installs the 30s in-memory response cache (see `./api-cache.ts`) on a
 * client instance — the mobile twin of the web app's `applyResponseCache`.
 *
 * Every list GET is cache-keyed by endpoint + query: a screen re-visit
 * renders instantly from the cache (fresh within 30s, stale-while-revalidate
 * for two minutes) instead of waiting on the network. Mutating verbs drop
 * the whole cache on completion so a create/update/delete can never leave a
 * stale list behind. The wrapper is idempotent per instance.
 */
export function applyResponseCache(client: ApiClient): ApiClient {
  const originalGet: GetFn = client.get.bind(client);

  client.get = async <T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> => {
    // Only bare GETs (every list helper) are cached; anything with request
    // options keeps its exact per-call behaviour.
    if (options || !isCacheableGet(endpoint)) {
      return originalGet<T>(endpoint, options);
    }
    const key = cacheKey('GET', endpoint);
    const cached = apiCache.peek<ApiResponse<T>>(key);
    if (cached.value !== null) {
      const cachedValue: ApiResponse<T> = cached.value;
      if (cached.isStale && !apiCache.inflightFor<ApiResponse<T>>(key)) {
        // Stale-while-revalidate: the caller already got the cached value
        // above; refresh in the background for the next visit.
        apiCache.trackInflight<ApiResponse<T>>(
          key,
          originalGet<T>(endpoint).then((response) => {
            apiCache.set(key, response);
            return response;
          }),
        );
      }
      return cachedValue;
    }
    const shared = apiCache.inflightFor<ApiResponse<T>>(key);
    if (shared) {
      return shared;
    }
    const promise = originalGet<T>(endpoint).then((response) => {
      apiCache.set(key, response);
      return response;
    });
    return apiCache.trackInflight<ApiResponse<T>>(key, promise);
  };

  const originalPost: MutateFn = client.post.bind(client);
  const originalPatch: MutateFn = client.patch.bind(client);
  const originalPut: MutateFn = client.put.bind(client);
  const originalDelete: DeleteFn = client.delete.bind(client);

  const invalidateAfter = async <T>(
    run: () => Promise<ApiResponse<T>>,
  ): Promise<ApiResponse<T>> => {
    try {
      return await run();
    } finally {
      // Even a failed mutation clears the cache: an extra refetch is cheap,
      // a stale row after a retried write is not.
      apiCache.clear();
    }
  };

  client.post = (async <T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalPost<T>(endpoint, body, options))) as MutateFn;

  client.patch = (async <T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalPatch<T>(endpoint, body, options))) as MutateFn;

  client.put = (async <T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalPut<T>(endpoint, body, options))) as MutateFn;

  client.delete = (async <T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> =>
    invalidateAfter(() => originalDelete<T>(endpoint, options))) as DeleteFn;

  return client;
}

/**
 * Socket.IO origin for the same API server. The client strips the REST prefix
 * (`/api/v1`) so the engine.io endpoint is `<origin>/socket.io` — identical
 * to what the API serves and the web app proxies.
 *
 * Throws the shared {@link ApiConfigurationError} when a release build has no
 * configured API base URL: a socket must never fall back to localhost either.
 */
export function socketOrigin(apiBaseUrl: string | null = API_BASE_URL): string {
  if (!apiBaseUrl) {
    throw (configError ?? new ApiConfigurationError(API_URL_NOT_CONFIGURED_MESSAGE));
  }
  const withoutTrailingSlash = apiBaseUrl.replace(/\/+$/, '');
  return withoutTrailingSlash.replace(/\/api\/v1$/, '');
}
