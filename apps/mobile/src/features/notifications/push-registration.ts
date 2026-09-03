import type { DevicePlatform, DeviceTokenRegisterRequest } from '@school-bus-tracking/shared-types';

/**
 * Pure device-push registration logic (no native imports — unit-testable in
 * plain Node, matching the repo's spec pattern).
 *
 * The native side (`./push-notifications.ts`) owns expo-notifications; this
 * module only decides permission/token facts and shapes the API request the
 * backend must receive, so both layers cannot drift from the server contract.
 */

/** Android channel all FCM messages target (must match the API's FCM payload). */
export const PUSH_CHANNEL_ID = 'notifications';

/**
 * iOS authorization status values (mirror of expo-notifications'
 * `IosAuthorizationStatus`). Kept as literals here so the pure decision
 * module stays unit-testable in plain Node without the native module; the
 * native wrapper feeds the real numeric enum through, and the string
 * spellings are accepted for robustness across SDK versions.
 */
export const IOS_AUTHORIZATION_STATUS = {
  NOT_DETERMINED: 0,
  DENIED: 1,
  AUTHORIZED: 2,
  PROVISIONAL: 3,
  EPHEMERAL: 4,
} as const;

/** Statuses that still allow non-interruptive / full delivery. */
export const IOS_GRANTED_STATUSES: ReadonlyArray<number | string> = [
  IOS_AUTHORIZATION_STATUS.AUTHORIZED,
  IOS_AUTHORIZATION_STATUS.PROVISIONAL,
  IOS_AUTHORIZATION_STATUS.EPHEMERAL,
  'AUTHORIZED',
  'PROVISIONAL',
  'EPHEMERAL',
];

/**
 * Maps the runtime platform to the API's `DevicePlatform`.
 * Web (and unknown platforms) return `null` — push is not supported there.
 */
export function mapDevicePlatform(platform: string | null | undefined): DevicePlatform | null {
  if (platform === 'android' || platform === 'ios') {
    return platform;
  }
  return null;
}

/** True when OS-level push can be attempted on this platform. */
export function isPushSupported(platform: string | null | undefined): boolean {
  return mapDevicePlatform(platform) !== null;
}

/**
 * True when the permission response allows notifications.
 *
 * On iOS the root `status` can be `undetermined` even when the granular iOS
 * status is `PROVISIONAL` / `EPHEMERAL` (non-interruptive delivery), so the
 * iOS field is checked first — exactly as the Expo docs recommend.
 */
export function isNotificationPermissionGranted(permissions: {
  granted?: boolean | null;
  status?: string | null;
  ios?: { status?: number | string | null } | null;
}): boolean {
  if (permissions.granted === true) {
    return true;
  }
  const iosStatus = permissions.ios?.status;
  return IOS_GRANTED_STATUSES.some((status) => status === iosStatus);
}

/** True when the user still needs to be asked (not granted, not denied yet). */
export function shouldRequestNotificationPermission(permissions: {
  granted?: boolean | null;
  status?: string | null;
  ios?: { status?: number | string | null } | null;
}): boolean {
  if (isNotificationPermissionGranted(permissions)) {
    return false;
  }
  const status = permissions.status ?? permissions.ios?.status;
  return (
    status === 'undetermined' ||
    status === 'notDetermined' ||
    status === IOS_AUTHORIZATION_STATUS.NOT_DETERMINED ||
    status == null
  );
}

/** Shapes the API request: only the device's own native token + platform. */
export function buildDeviceTokenRequest(
  token: string,
  platform: DevicePlatform,
): DeviceTokenRegisterRequest {
  return { token: token.trim(), platform };
}

/**
 * Extracts the token string out of the expo-notifications `DevicePushToken`
 * shape (`{ type, data }`), where `data` is the FCM registration token
 * (Android) or APNs token (iOS) our firebase-admin backend can send to.
 */
export function devicePushTokenValue(token: { data?: unknown } | null | undefined): string | null {
  const value = token?.data;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
