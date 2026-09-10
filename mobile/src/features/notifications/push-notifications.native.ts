import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import {
  buildDeviceTokenRequest,
  devicePushTokenValue,
  isNotificationPermissionGranted,
  mapDevicePlatform,
  PUSH_CHANNEL_ID,
  shouldEnableRemotePush,
  shouldRequestNotificationPermission,
} from './push-registration';

/**
 * Native push wiring (expo-notifications) for OS-level FCM delivery.
 *
 * `expo-notifications` is loaded **lazily** (see `loadNotifications()`), never
 * through a top-level/static `import * as Notifications from
 * 'expo-notifications'`. The package's `.native.ts` modules call
 * `requireNativeModule('ExpoPushTokenManager')`, `ExpoNotificationPermissionsModule`
 * and `ExpoNotificationScheduler` at *module scope* — and none of those native
 * modules exist inside Expo Go Android. A static import therefore throws
 * during module evaluation, **before** `isRunningInExpoGo()` can protect it,
 * which is the exact crash this module is designed to avoid.
 *
 * - Foreground: `setNotificationHandler` makes a received push show as an
 *   in-app banner; background/killed delivery is rendered by the OS from the
 *   FCM notification message automatically (no handler needed).
 * - After login (any role): Android 13+ `POST_NOTIFICATIONS` permission is
 *   requested, the device push token is fetched and registered against the
 *   authenticated user, and a token-refresh listener re-registers new tokens.
 * - On logout: the token is unregistered fire-and-forget — logout never waits
 *   on the network, and a failed call simply leaves a stale token that FCM
 *   deactivates later (or the next login overwrites).
 *
 * In Expo Go `setupPushNotifications` returns early (a safe no-op) before
 * `loadNotifications()` is ever called, so the `expo-notifications` module is
 * never evaluated. In a development/production build (`isRunningInExpoGo()`
 * is `false`) the module is required and the full implementation runs.
 */

/** Shape of the lazily-required `expo-notifications` module. */
type NotificationsModule = typeof import('expo-notifications');

let notifications: NotificationsModule | null = null;
let loadAttempted = false;

/**
 * Requires `expo-notifications` on first use and installs the foreground
 * handler once. Only ever called after the Expo Go guard has passed.
 */
function loadNotifications(): NotificationsModule | null {
  if (loadAttempted) {
    return notifications;
  }
  loadAttempted = true;
  try {
    // Deliberately a lazy `require()`: evaluating this module on Expo Go
    // Android throws at import time (missing native modules), so it must only
    // happen inside a supported runtime, guarded by `isRunningInExpoGo()`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
    // Foreground presentation: show the banner/list row, play the default sound.
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Untestable/unsupported environment: the app simply has no in-app banner.
    notifications = null;
  }
  return notifications;
}

/** Last token obtained from the native module (used by logout unregister). */
let currentDeviceToken: string | null = null;
let tokenListenerAttached = false;

/**
 * Requests permission, fetches the native push token and registers it.
 *
 * Idempotent per process: the token listener is attached once; every login /
 * app-start call re-checks permissions and re-registers the current token so
 * ownership always follows the signed-in user. Failed steps are swallowed and
 * logged — push must never break sign-in.
 */
export async function setupPushNotifications(user: AuthenticatedUser): Promise<void> {
  // No tenant, no push: the platform SUPER_ADMIN has no device registration.
  if (!user.school_id) {
    return;
  }
  // Expo Go ships without the native push modules (removed in SDK 53). This
  // short-circuits to a graceful no-op in Expo Go — crucially *before* the
  // lazy `require('expo-notifications')` below — while a development /
  // production build (`isRunningInExpoGo() === false`) still registers the
  // token.
  if (!shouldEnableRemotePush({ platform: Platform.OS, isExpoGo: isRunningInExpoGo() })) {
    return;
  }

  const platform = mapDevicePlatform(Platform.OS);
  if (!platform) {
    return;
  }

  const Notifications = loadNotifications();
  if (!Notifications) {
    return;
  }

  try {
    // Android 13+ requires the channel to exist before requesting permission,
    // and the server always sends on this channel id.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
        name: 'Trip alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
      });
    }

    let permissions = await Notifications.getPermissionsAsync();
    if (shouldRequestNotificationPermission(permissions)) {
      permissions = await Notifications.requestPermissionsAsync();
    }
    if (!isNotificationPermissionGranted(permissions)) {
      return;
    }

    if (!tokenListenerAttached) {
      Notifications.addPushTokenListener((token) => {
        const value = devicePushTokenValue(token);
        if (value) {
          currentDeviceToken = value;
          void registerDeviceToken(value, platform);
        }
      });
      tokenListenerAttached = true;
    }

    const token = await Notifications.getDevicePushTokenAsync();
    const value = devicePushTokenValue(token);
    if (!value) {
      return;
    }
    currentDeviceToken = value;
    await registerDeviceToken(value, platform);
  } catch (error) {
    // Expo Go / no Firebase config / permission denied: the app keeps working
    // without OS push; setup is retried on the next login/app start.
    console.warn('Push notification setup skipped:', errorMessage(error));
  }
}

/**
 * Unregisters the current device token (logout). Fire-and-forget by design:
 * the caller never awaits it, so a slow or failing network cannot delay
 * clearing the local session.
 */
export async function unregisterPushDevice(): Promise<void> {
  const token = currentDeviceToken;
  if (!token) {
    return;
  }
  try {
    await apiClient.unregisterDeviceToken(token);
  } catch {
    // Best effort: the token row will be overwritten on next login or
    // deactivated by FCM's unregistered-token handling.
  }
}

async function registerDeviceToken(token: string, platform: 'android' | 'ios'): Promise<void> {
  try {
    await apiClient.registerDeviceToken(buildDeviceTokenRequest(token, platform));
  } catch {
    // Network hiccup on login: the next setup run (or token refresh) retries.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
