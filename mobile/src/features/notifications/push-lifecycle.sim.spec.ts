import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { UserRole, type AuthenticatedUser } from '@school-bus-tracking/shared-types';

/**
 * Simulation of the native push lifecycle against the real
 * `push-notifications.native.ts` with expo-notifications, expo-router,
 * react-native and the API client mocked (`--experimental-test-module-mocks`).
 * Covers: token registration, foreground presentation (own vs foreign
 * account), background tap → role screen, cold-start tap, token refresh
 * (old token retired), logout (token unregistered while JWT valid; a late
 * push is neither shown nor routed) and re-login re-owning the token.
 */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../') + '/';

mock.module('react-native', { namedExports: { Platform: { OS: 'android' } } });
mock.module('expo', { namedExports: { isRunningInExpoGo: () => false } });
const pushes: string[] = [];
let routerReady = true;
mock.module('expo-router', {
  namedExports: {
    router: {
      push: (route: string) => {
        if (!routerReady) throw new Error('navigator not mounted');
        pushes.push(route);
      },
    },
  },
});

type Handler = { handleNotification: (n: unknown) => Promise<Record<string, boolean>> };
const native = {
  handler: null as Handler | null,
  tokenListeners: [] as Array<(t: { data: string }) => void>,
  responseListeners: [] as Array<(r: unknown) => void>,
  lastResponse: null as unknown,
  token: 'fcm-token-1',
};
const fakeNotifications = {
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: (h: Handler) => { native.handler = h; },
  setNotificationChannelAsync: async () => undefined,
  getPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  addPushTokenListener: (fn: (t: { data: string }) => void) => { native.tokenListeners.push(fn); },
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => { native.responseListeners.push(fn); },
  getLastNotificationResponseAsync: async () => native.lastResponse,
  getDevicePushTokenAsync: async () => ({ type: 'android', data: native.token }),
};
const api = { registered: [] as Array<{ token: string; platform: string }>, unregistered: [] as string[] };
mock.module(pathToFileURL(ROOT + 'src/services/api.ts').href, {
  namedExports: {
    apiClient: {
      registerDeviceToken: async (body: { token: string; platform: string }) => { api.registered.push(body); return { success: true, data: body }; },
      unregisterDeviceToken: async (token: string) => { api.unregistered.push(token); return { success: true, data: { removed: true } }; },
    },
  },
});

const push = (await import(
  pathToFileURL(ROOT + 'src/features/notifications/push-notifications.native.ts').href
)) as typeof import('./push-notifications.native.ts');
// `expo-notifications` is loaded through a lazy CommonJS `require` in
// production (see the module docs); ESM mocks cannot intercept it, so the
// simulation injects the fake through the dedicated test seam.
push.__setNotificationsModuleLoaderForTests(
  () => fakeNotifications as unknown as typeof import('expo-notifications'),
);

const SCHOOL = 'school-1';
const driver = { id: 'driver-1', school_id: SCHOOL, role: UserRole.DRIVER } as AuthenticatedUser;
const parent = { id: 'parent-1', school_id: SCHOOL, role: UserRole.PARENT } as AuthenticatedUser;
const notification = (data: Record<string, string>) => ({ request: { content: { data } }, date: Date.now() });
const tick = () => new Promise((r) => setTimeout(r, 20));

test('login registers the device token once for the signed-in user', async () => {
  await push.setupPushNotifications(driver);
  assert.deepEqual(api.registered, [{ token: 'fcm-token-1', platform: 'android' }]);
  // App start → refresh → setup again: same token, same user → no duplicate POST.
  await push.setupPushNotifications(driver);
  assert.equal(api.registered.length, 1);
  assert.ok(native.handler, 'foreground handler installed');
  assert.equal(native.responseListeners.length, 1, 'tap listener attached once');
});

test('6. foreground push for the signed-in user is presented; another account’s is suppressed', async () => {
  const own = await native.handler!.handleNotification(
    notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'driver-1', school_id: SCHOOL }),
  );
  assert.equal(own.shouldShowBanner, true);
  assert.equal(own.shouldPlaySound, true);
  const foreign = await native.handler!.handleNotification(
    notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'someone-else', school_id: SCHOOL }),
  );
  assert.equal(foreign.shouldShowBanner, false);
  assert.equal(foreign.shouldShowList, false);
});

test('7/8. background push tapped → correct role screen', async () => {
  native.responseListeners[0]({
    notification: notification({ type: 'EMERGENCY_STATUS', user_id: 'driver-1', school_id: SCHOOL, emergency_id: 'e1' }),
  });
  assert.deepEqual(pushes.splice(0), ['/sos']);
  native.responseListeners[0]({
    notification: notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'driver-1', school_id: SCHOOL, trip_id: 't1' }),
  });
  assert.deepEqual(pushes.splice(0), ['/trip']);
  // Tap addressed to someone else never navigates.
  native.responseListeners[0]({
    notification: notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'other', school_id: SCHOOL }),
  });
  assert.deepEqual(pushes, []);
});

test('cold-start tap is replayed once the navigator mounts', async () => {
  routerReady = false;
  native.lastResponse = {
    notification: { ...notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'driver-1', school_id: SCHOOL }), date: Date.now() + 1 },
  };
  await push.setupPushNotifications(driver);
  await tick();
  assert.deepEqual(pushes, [], 'nothing routed while navigator is missing');
  routerReady = true;
  push.flushPendingRoute();
  assert.deepEqual(pushes.splice(0), ['/trip']);
  push.flushPendingRoute();
  assert.deepEqual(pushes, [], 'replayed exactly once');
});

test('FCM token refresh retires the old token and registers the new one', async () => {
  native.tokenListeners[0]({ data: 'fcm-token-2' });
  await tick();
  assert.deepEqual(api.unregistered, ['fcm-token-1']);
  assert.deepEqual(api.registered.at(-1), { token: 'fcm-token-2', platform: 'android' });
});

test('9. logout unregisters the token and a late push is neither shown nor routed', async () => {
  api.unregistered.length = 0;
  await push.unregisterPushDevice();
  assert.deepEqual(api.unregistered, ['fcm-token-2']);

  const late = await native.handler!.handleNotification(
    notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'driver-1', school_id: SCHOOL }),
  );
  assert.equal(late.shouldShowBanner, false);
  native.responseListeners[0]({
    notification: notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'driver-1', school_id: SCHOOL }),
  });
  assert.deepEqual(pushes, []);
});

test('9b. next login re-registers (re-owns) the same device token for the new user', async () => {
  const before = api.registered.length;
  native.token = 'fcm-token-2';
  await push.setupPushNotifications(parent);
  assert.equal(api.registered.length, before + 1);
  assert.deepEqual(api.registered.at(-1), { token: 'fcm-token-2', platform: 'android' });
  // The previous user's pushes are now ignored; the parent's are shown and routed.
  const stale = await native.handler!.handleNotification(
    notification({ type: 'CREW_TRIP_CANCELLED', user_id: 'driver-1', school_id: SCHOOL }),
  );
  assert.equal(stale.shouldShowBanner, false);
  native.responseListeners[0]({
    notification: notification({ type: 'STUDENT_BOARDED', user_id: 'parent-1', school_id: SCHOOL, student_id: 's1' }),
  });
  assert.deepEqual(pushes.splice(0), ['/tracking?child=s1']);
});
