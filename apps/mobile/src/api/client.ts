import { Platform } from 'react-native';
import { ApiClient, ApiClientConfig, createApiClient } from '@school-bus-tracking/api-client';

/**
 * Mobile REST transport.
 *
 * The app talks to the *existing* NestJS API (`apps/api`) through the shared
 * `@school-bus-tracking/api-client`; there is no mobile-only endpoint and no
 * duplicated business logic. The client is constructed with the session's
 * token accessors so:
 *
 * - every request attaches `Authorization: Bearer <access token>`;
 * - a 401 transparently triggers `POST /auth/refresh` (the mobile client
 *   replays the stored refresh token in the body — the documented fallback
 *   the auth controller offers to non-browser clients);
 * - refresh-token rotation is persisted back into device-protected storage.
 *
 * Base URL resolution:
 *
 * - `EXPO_PUBLIC_API_URL` (e.g. `http://192.168.1.10:3001/api/v1`) always
 *   wins — set it to the LAN address of the API when testing on a device.
 * - Android emulators cannot reach the host's `localhost`, so `10.0.2.2` is
 *   used as the development default there; iOS simulators and tooling run on
 *   the host itself and use `localhost`.
 */

const API_PATH_SUFFIX = '/api/v1';

export function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  const origin = configured
    ? configured.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:3001'
      : 'http://localhost:3001';
  return `${origin}${API_PATH_SUFFIX}`;
}

/** Origin (scheme://host[:port]) of the API — the Socket.IO servers share it. */
export function resolveSocketOrigin(): string {
  return resolveApiBaseUrl().slice(0, -API_PATH_SUFFIX.length);
}

export function createMobileApiClient(
  sessionAccessors: Pick<
    ApiClientConfig,
    'getAccessToken' | 'setAccessToken' | 'getRefreshToken' | 'setRefreshToken' | 'onUnauthorized'
  >,
): ApiClient {
  return createApiClient({
    baseUrl: resolveApiBaseUrl(),
    ...sessionAccessors,
  });
}
