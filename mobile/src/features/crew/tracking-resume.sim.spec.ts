import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Simulation of the **restart-resume** behaviour of the crew tracking
 * lifecycle (`tracking-lifecycle.ts`), against the real module with the
 * native runtimes mocked (same harness pattern as
 * `tracking-recovery.sim.spec.ts`).
 *
 * The field bug this pins: a foreground `watchPositionAsync` dies with the
 * process (OS kill, battery optimiser, crash, force-close) while the trip
 * stays `BOARDING`/`IN_PROGRESS` on the server. Before the fix, hydration
 * restored the persisted context *as data only* — the app came back with no
 * watcher and no fixes, the strip read "Share GPS", and the bus vanished
 * from every map (driver, conductor, parent, admin) until the driver noticed
 * and tapped it. The context is the record of the driver's explicit consent
 * (written only by a successful start, ownership- and freshness-checked at
 * restore, cleared by a deliberate stop), so hydration now restarts the
 * foreground watch for a fresh, owned context — and the server's eligibility
 * re-check still closes it when the trip has since ended.
 *
 * Also pinned: the serialized start queue (concurrent callers still create
 * exactly one watcher, and a start queued behind a stop is dropped — the
 * crew's newest decision wins).
 */

const ROOT = `${resolve(fileURLToPath(import.meta.url), '../../../../')}/`;
const moduleUrl = (relative: string): string => pathToFileURL(ROOT + relative).href;

// ── AsyncStorage double ─────────────────────────────────────────────────────
const storage = new Map<string, string>();
const asyncStorage = {
  getItem: async (key: string) => storage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: async (key: string) => {
    storage.delete(key);
  },
};
mock.module('@react-native-async-storage/async-storage', { defaultExport: asyncStorage });

// ── react-native / expo-constants doubles (the api-env side effect) ──────────
mock.module('react-native', { namedExports: { Platform: { OS: 'android' } } });
mock.module('expo-constants', {
  defaultExport: {
    expoConfig: { hostUri: '192.168.1.50:8081' },
    expoGoConfig: null,
  },
});

// ── expo-location double ────────────────────────────────────────────────────
const grantedPermission = {
  granted: true,
  canAskAgain: true,
  status: 'granted',
  android: { accuracy: 'fine' },
};

/**
 * Hold for the foreground-permission read: scenario 6 parks the first start
 * inside its permission read so a second start is provably *queued*, then
 * stops the lifecycle before the queue drains.
 */
let permissionHold = false;
let permissionRelease: (() => void) | null = null;

const location = {
  servicesEnabled: true,
  foreground: grantedPermission as Record<string, unknown> | null,
  background: grantedPermission as Record<string, unknown> | null,
  watchCalls: 0,
  watchers: [] as Array<(fix: unknown) => void>,
  removedWatchers: 0,
  taskStarted: false,
};

mock.module('expo-location', {
  namedExports: {
    Accuracy: { BestForNavigation: 6 },
    hasServicesEnabledAsync: async () => location.servicesEnabled,
    getForegroundPermissionsAsync: async () => {
      if (permissionHold) {
        await new Promise<void>((release) => {
          permissionRelease = release;
        });
      }
      return location.foreground;
    },
    getBackgroundPermissionsAsync: async () => location.background,
    requestForegroundPermissionsAsync: async () => location.foreground,
    requestBackgroundPermissionsAsync: async () => location.background,
    watchPositionAsync: async (_options: unknown, callback: (fix: unknown) => void) => {
      location.watchCalls += 1;
      location.watchers.push(callback);
      return {
        remove: () => {
          location.removedWatchers += 1;
          location.watchers = location.watchers.filter((entry) => entry !== callback);
        },
      };
    },
    startLocationUpdatesAsync: async () => {
      location.taskStarted = true;
    },
    stopLocationUpdatesAsync: async () => {
      location.taskStarted = false;
    },
    hasStartedLocationUpdatesAsync: async () => location.taskStarted,
  },
});

// ── live-tracking socket double ─────────────────────────────────────────────
const socket = {
  connected: false,
  connects: 0,
  joins: [] as string[],
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
  connect() {
    socket.connects += 1;
    socket.connected = true;
    socket.fire('connect');
  },
  on(event: string, listener: (...args: unknown[]) => void) {
    const list = socket.listeners.get(event) ?? [];
    list.push(listener);
    socket.listeners.set(event, list);
  },
  off(event: string, listener: (...args: unknown[]) => void) {
    socket.listeners.set(
      event,
      (socket.listeners.get(event) ?? []).filter((entry) => entry !== listener),
    );
  },
  emit(event: string, payload: Record<string, unknown>, ack?: (value: unknown) => void) {
    if (event === 'tracking:join') {
      socket.joins.push(String(payload.trip_id));
      ack?.({ status: 'joined', trip_id: payload.trip_id, room: `trip:${payload.trip_id}` });
    }
  },
  fire(event: string, ...args: unknown[]) {
    for (const listener of socket.listeners.get(event) ?? []) {
      listener(...args);
    }
  },
  reset() {
    socket.connected = false;
    socket.connects = 0;
    socket.joins = [];
    socket.listeners.clear();
  },
};

mock.module(moduleUrl('src/services/live-tracking-socket.ts'), {
  namedExports: {
    getLiveTrackingSocket: () => socket,
    isLiveTrackingSocketConnected: () => socket.connected,
    disconnectLiveTrackingSocket: () => {
      socket.connected = false;
    },
  },
});

// ── API client double (eligibility re-check) ────────────────────────────────
const api = {
  getTripCalls: 0,
  tripStatus: 'IN_PROGRESS' as string,
};

mock.module(moduleUrl('src/services/api.ts'), {
  namedExports: {
    registerApiEnv: () => undefined,
    socketOrigin: () => 'http://192.168.1.50:3001',
    getApiConfigurationError: () => null,
    apiClient: {
      refresh: async () => ({
        success: false,
        timestamp: new Date().toISOString(),
        error: { code: 'UNAUTHORIZED', message: 'No session' },
      }),
      getTrip: async (tripId: string) => {
        api.getTripCalls += 1;
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: { id: tripId, status: api.tripStatus, school_id: 'school-1' },
        };
      },
    },
  },
});

// Metro defines `__DEV__` as a global; `api-env.ts` reads it at module scope.
(globalThis as { __DEV__?: boolean }).__DEV__ = true;

const session = (await import(
  moduleUrl('src/services/session.ts')
)) as typeof import('../../services/session.ts');
const recovery = (await import(
  moduleUrl('src/services/session-recovery.ts')
)) as typeof import('../../services/session-recovery.ts');
const lifecycle = (await import(
  moduleUrl('src/features/crew/tracking-lifecycle.ts')
)) as typeof import('./tracking-lifecycle.ts');
const contextModule = (await import(
  moduleUrl('src/features/crew/tracking-context.ts')
)) as typeof import('./tracking-context.ts');
const runtimeModule = (await import(
  moduleUrl('src/lib/runtime-environment.ts')
)) as typeof import('../../lib/runtime-environment.ts');

// Shrink every bounded wait so a scenario is milliseconds, not seconds.
lifecycle.__setTrackingTimeoutsForTests({ connect: 40, ack: 40, eligibility: 40, session: 60 });

const DRIVER = { userId: 'driver-1', schoolId: 'school-1' };
// The shared validation schema requires UUID trip ids.
const TRIP = '11111111-1111-4111-8111-111111111111';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function persistContext(
  overrides: { userId?: string; schoolId?: string | null; tripId?: string; ageMs?: number } = {},
) {
  storage.set(
    contextModule.CREW_TRACKING_CONTEXT_KEY,
    contextModule.serializeCrewTrackingContext(
      contextModule.createCrewTrackingContext({
        userId: overrides.userId ?? DRIVER.userId,
        schoolId: overrides.schoolId === undefined ? DRIVER.schoolId : overrides.schoolId,
        tripId: overrides.tripId ?? TRIP,
        now: Date.now() - (overrides.ageMs ?? 0),
      }),
    ),
  );
}

beforeEach(async () => {
  await lifecycle.__resetCrewTrackingForTests();
  recovery.__resetSessionRecoveryForTests();
  session.clearAccessToken();
  storage.clear();
  socket.reset();
  location.watchCalls = 0;
  location.watchers = [];
  location.removedWatchers = 0;
  location.taskStarted = false;
  location.servicesEnabled = true;
  location.foreground = grantedPermission;
  location.background = grantedPermission;
  permissionHold = false;
  permissionRelease = null;
  // A development build: the OS background task *could* exist here.
  runtimeModule.registerRuntimeFacts({
    executionEnvironment: 'storeClient',
    appOwnership: null,
    platform: 'android',
  });
  api.getTripCalls = 0;
  api.tripStatus = 'IN_PROGRESS';
});

test('1. restart with an owned, fresh context restarts the foreground watcher', async () => {
  persistContext();
  // The signed-in driver is back in the app: the session token is in memory.
  session.setAccessToken('jwt-live');

  await lifecycle.hydrateCrewTracking(DRIVER);
  await wait(60);

  const state = lifecycle.getCrewTrackingState();
  assert.equal(location.watchCalls, 1, 'the foreground watch was started again by hydration');
  assert.equal(state.foregroundActive, true);
  assert.equal(state.tripId, TRIP, 'the resumed context names the live trip');
  assert.ok(api.getTripCalls >= 1, 'the started run re-checked trip eligibility with the server');
});

test('2. restart with no persisted context starts nothing', async () => {
  session.setAccessToken('jwt-live');
  await lifecycle.hydrateCrewTracking(DRIVER);
  await wait(60);

  assert.equal(location.watchCalls, 0);
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
});

test('3. a deliberately stopped run is not resurrected by a restart', async () => {
  // The driver shared, then chose Stop — which clears the durable context.
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  await lifecycle.stopCrewTracking('user');
  assert.equal(
    storage.has(contextModule.CREW_TRACKING_CONTEXT_KEY),
    false,
    'a deliberate stop clears the persisted context',
  );

  // …and the app restarts: a fresh process has no watchers at all.
  await lifecycle.__resetCrewTrackingForTests();
  location.watchCalls = 0;
  location.watchers = [];
  location.removedWatchers = 0;
  session.setAccessToken('jwt-live');
  await lifecycle.hydrateCrewTracking(DRIVER);
  await wait(60);

  assert.equal(location.watchCalls, 0, 'a run the driver stopped is never auto-resumed');
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
});

test('4. another account’s context is not resumed and is dropped', async () => {
  persistContext({ userId: 'driver-2' });
  session.setAccessToken('jwt-live');

  await lifecycle.hydrateCrewTracking(DRIVER);
  await wait(60);

  assert.equal(location.watchCalls, 0, 'a foreign account’s trip is never resumed');
  assert.equal(
    storage.has(contextModule.CREW_TRACKING_CONTEXT_KEY),
    false,
    'the foreign context is cleared so it cannot come back',
  );
});

test('5. an expired context is not resumed', async () => {
  persistContext({ ageMs: 13 * 60 * 60 * 1000 }); // older than the 12 h bound
  session.setAccessToken('jwt-live');

  await lifecycle.hydrateCrewTracking(DRIVER);
  await wait(60);

  assert.equal(location.watchCalls, 0);
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
});

test('6. a start queued behind a stop is dropped (newest decision wins)', async () => {
  // Park the first start inside its permission read so the second is queued.
  permissionHold = true;
  const first = lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  await wait(5);
  assert.ok(permissionRelease, 'the first start is parked in its permission read');
  const second = lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });

  // The crew stops (or logs out) while the second start still waits.
  await lifecycle.stopCrewTracking('user');
  assert.equal(
    storage.has(contextModule.CREW_TRACKING_CONTEXT_KEY),
    false,
    'the stop cleared the durable context',
  );

  permissionHold = false;
  permissionRelease?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  await wait(20);

  assert.equal(firstResult.ok, false, 'the in-flight start is invalidated by the stop');
  assert.equal(secondResult.ok, false, 'the queued start is dropped, not run after the stop');
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
  assert.equal(location.watchers.length, 0, 'no watcher survives the stop');
  assert.equal(
    storage.has(contextModule.CREW_TRACKING_CONTEXT_KEY),
    false,
    'the invalidated start never re-persists the context the stop cleared',
  );
});

test('7. concurrent callers still create exactly one location watcher', async () => {
  session.setAccessToken('jwt-live');
  await Promise.all([
    lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER }),
    lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER }),
    lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER }),
  ]);

  assert.equal(location.watchCalls, 1, 'one watcher for the whole app, however many callers');
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, true);
});

test('8. a resumed run stops itself when the server says the trip is closed', async () => {
  persistContext();
  api.tripStatus = 'COMPLETED';
  session.setAccessToken('jwt-live');

  await lifecycle.hydrateCrewTracking(DRIVER);
  await wait(300);

  const state = lifecycle.getCrewTrackingState();
  assert.equal(state.foregroundActive, false, 'the closed-trip refusal stops the resumed run');
  assert.equal(state.lastStopReason, 'trip-not-eligible');
});
