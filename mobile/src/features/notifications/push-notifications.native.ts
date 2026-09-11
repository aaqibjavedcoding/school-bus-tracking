import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { router } from 'expo-router';
import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api.ts';
import { readPushData, resolvePushRoute, shouldPresentForeground } from './push-routing.ts';
import {
  buildDeviceTokenRequest,
  devicePushTokenValue,
  isNotificationPermissionGranted,
  mapDevicePlatform,
  PUSH_CHANNEL_ID,
  shouldEnableRemotePush,
  shouldRequestNotificationPermission,
} from './push-registration.ts';

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

/** Default loader: the lazy CommonJS `require` described above. */
function requireNotifications(): NotificationsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as NotificationsModule;
}

let notificationsLoader: () => NotificationsModule = requireNotifications;

/**
 * Test seam: the plain-Node simulation cannot intercept a CommonJS
 * `require` with ESM module mocks, so it injects the mocked module here.
 * Production never calls this.
 */
export function __setNotificationsModuleLoaderForTests(
  loader: (() => NotificationsModule) | null,
): void {
  notificationsLoader = loader ?? requireNotifications;
  notifications = null;
  loadAttempted = false;
}

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
    notifications = notificationsLoader();
    // Foreground presentation: show the banner/list row, play the default
    // sound — but only for the signed-in account. A push addressed to a
    // previous user of this device (token not yet re-owned) is dropped.
    notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = readPushData(notification.request.content.data);
        const show = shouldPresentForeground(data, activeUser);
        return {
          shouldPlaySound: show,
          shouldSetBadge: false,
          shouldShowBanner: show,
          shouldShowList: show,
        };
      },
    });
  } catch {
    // Untestable/unsupported environment: the app simply has no in-app banner.
    notifications = null;
  }
  return notifications;
}

/** Last token obtained from the native module (used by logout unregister). */
let currentDeviceToken: string | null = null;
/** `token:userId` of the last successful registration — prevents re-posting. */
let registeredFor: string | null = null;
let tokenListenerAttached = false;
let responseListenerAttached = false;
/** The signed-in user; `null` between logout and the next login. */
let activeUser: { id: string; school_id: string | null; role: AuthenticatedUser['role'] } | null =
  null;
/** Route resolved from a tap that arrived before the navigator was ready. */
let pendingRoute: string | null = null;

/**
 * Opens the screen a tapped notification points at. Called from the tap
 * listener (warm/background) and from `setupPushNotifications` for the cold
 * start (`getLastNotificationResponseAsync`). Routing is role-aware and
 * ignores pushes addressed to another account.
 */
function openFromNotification(content: { data?: unknown } | null | undefined): void {
  if (!activeUser) {
    return;
  }
  const route = resolvePushRoute(readPushData(content?.data), activeUser);
  if (!route) {
    return;
  }
  try {
    router.push(route as never);
  } catch {
    // Navigator not mounted yet (cold start): replayed by `flushPendingRoute`.
    pendingRoute = route;
  }
}

/** Screens call this once mounted so a cold-start tap still lands. */
export function flushPendingRoute(): void {
  if (!pendingRoute) {
    return;
  }
  const route = pendingRoute;
  pendingRoute = null;
  try {
    router.push(route as never);
  } catch {
    pendingRoute = route;
  }
}

/**
 * Requests permission, fetches the native push token and registers it.
 *
 * Idempotent per process: the token listener is attached once; every login /
 * app-start call re-checks permissions and re-registers the current token so
 * ownership always follows the signed-in user. Failed steps are swallowed and
 * logged — push must never break sign-in.
 */
export async function setupPushNotifications(user: AuthenticatedUser): Promise<void> {
  activeUser = { id: user.id, school_id: user.school_id ?? null, role: user.role };
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
        if (value && activeUser) {
          // FCM rotated the token: the old one is retired server-side and
          // the new one registered, so no stale token keeps receiving.
          const previous = currentDeviceToken;
          currentDeviceToken = value;
          void (async () => {
            if (previous && previous !== value) {
              await unregisterToken(previous);
            }
            await registerDeviceToken(value, platform, activeUser?.id ?? null);
          })();
        }
      });
      tokenListenerAttached = true;
    }

    if (!responseListenerAttached) {
      // Background / killed → tap: the OS rendered the FCM notification and
      // the user opened the app from it.
      Notifications.addNotificationResponseReceivedListener((response) => {
        openFromNotification(response.notification.request.content);
      });
      responseListenerAttached = true;
    }

    // Cold start from a notification tap (the listener above is attached
    // too late to see it): expo keeps the last response for us.
    void Notifications.getLastNotificationResponseAsync?.()
      .then((response) => {
        if (response && response.notification.date > lastHandledColdStart) {
          lastHandledColdStart = response.notification.date;
          openFromNotification(response.notification.request.content);
        }
      })
      .catch(() => undefined);

    const token = await Notifications.getDevicePushTokenAsync();
    const value = devicePushTokenValue(token);
    if (!value) {
      return;
    }
    currentDeviceToken = value;
    await registerDeviceToken(value, platform, user.id);
  } catch (error) {
    // Expo Go / no Firebase config / permission denied: the app keeps working
    // without OS push; setup is retried on the next login/app start.
    console.warn('Push notification setup skipped:', errorMessage(error));
  }
}

/** Timestamp of the last cold-start response already routed. */
let lastHandledColdStart = 0;

/**
 * Unregisters the current device token (logout).
 *
 * Must be awaited **while the access token is still valid** — the API scopes
 * `DELETE /notifications/devices/:token` to the caller's JWT. The local
 * user binding is cleared immediately either way, so a push that still
 * arrives for the old account is neither shown nor routed, and the next
 * login re-registers (and re-owns) the same token for the new user.
 */
export async function unregisterPushDevice(): Promise<void> {
  const token = currentDeviceToken;
  activeUser = null;
  pendingRoute = null;
  registeredFor = null;
  if (!token) {
    return;
  }
  await unregisterToken(token);
}

async function unregisterToken(token: string): Promise<void> {
  try {
    await apiClient.unregisterDeviceToken(token);
  } catch {
    // Best effort: the row is re-owned on the next login (server upsert) or
    // deactivated by FCM's unregistered-token handling.
  }
}

async function registerDeviceToken(
  token: string,
  platform: 'android' | 'ios',
  userId: string | null,
): Promise<void> {
  const binding = `${token}:${userId ?? ''}`;
  if (registeredFor === binding) {
    // Same token already registered for this user in this process (app
    // foreground → refresh → setup): no duplicate POST.
    return;
  }
  try {
    const envelope = await apiClient.registerDeviceToken(buildDeviceTokenRequest(token, platform));
    if (envelope.success !== false) {
      registeredFor = binding;
    }
  } catch {
    // Network hiccup on login: the next setup run (or token refresh) retries.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
