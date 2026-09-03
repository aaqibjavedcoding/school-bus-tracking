import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import {
  buildDeviceTokenRequest,
  devicePushTokenValue,
  isNotificationPermissionGranted,
  isPushSupported,
  mapDevicePlatform,
  PUSH_CHANNEL_ID,
  shouldRequestNotificationPermission,
} from './push-registration';

/**
 * Native push wiring (expo-notifications) for OS-level FCM delivery.
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
 * Remote push requires a development/production build (EAS) — it does **not**
 * work in Expo Go on SDK 54. See docs/notifications.md.
 */

// Foreground presentation: show the banner/list row, play the default sound.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // Web/untestable environments: the app simply has no in-app banner.
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
  if (!isPushSupported(Platform.OS)) {
    return;
  }

  const platform = mapDevicePlatform(Platform.OS);
  if (!platform) {
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
