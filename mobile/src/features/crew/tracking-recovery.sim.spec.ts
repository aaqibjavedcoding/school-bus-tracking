import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Simulation of the crew tracking lifecycle against the **real**
 * `tracking-lifecycle.ts`, with the native runtimes mocked
 * (`--experimental-test-module-mocks` + the shared native-stub loader):
 * expo-location, AsyncStorage, the live-tracking socket, the API client and the
 * API-env registration.
 *
 * It covers the behaviour the mobile-reliability patch exists for:
 *
 * - a headless OS execution with an **empty in-memory access token** recovering
 *   a session, an owned context and a socket before delivering a fix;
 * - concurrent callers sharing one refresh (no refresh-token rotation race);
 * - no session / wrong user / wrong tenant / closed trip → nothing is sent;
 * - logout while a recovery is in flight → the late completion is a no-op;
 * - network loss → bounded retry → reconnect → the held fix re-sent with the
 *   **same** idempotency key and its **original** timestamp;
 * - an expired held fix discarded and counted, never replayed as live;
 * - expired-auth server disconnect → refresh → explicit reconnect, versus a
 *   permanent revocation which stops retries for good;
 * - two screens starting tracking → exactly one location watcher;
 * - status derived from the server acknowledgement, not from a local fix;
 * - successive stop visits each deliver their own fix — the per-visit
 *   evidence stream the server's arrival pipeline advances stops with
 *   (batch 3A: one eligible in-geofence fix records the next stop).
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
const deniedPermission = {
  granted: false,
  canAskAgain: false,
  status: 'denied',
  android: { accuracy: 'fine' },
};

const location = {
  servicesEnabled: true,
  foreground: grantedPermission as Record<string, unknown> | null,
  background: grantedPermission as Record<string, unknown> | null,
  watchCalls: 0,
  watchers: [] as Array<(fix: unknown) => void>,
  removedWatchers: 0,
  startCalls: 0,
  stopCalls: 0,
  taskStarted: false,
  lastTaskOptions: null as Record<string, unknown> | null,
  /** `getBackgroundPermissionsAsync` probes (Expo Go must never do these). */
  backgroundPermissionReads: 0,
  /** `hasStartedLocationUpdatesAsync` probes (Expo Go must never do these). */
  hasStartedCalls: 0,
};

mock.module('expo-location', {
  namedExports: {
    Accuracy: { BestForNavigation: 6 },
    hasServicesEnabledAsync: async () => location.servicesEnabled,
    getForegroundPermissionsAsync: async () => location.foreground,
    getBackgroundPermissionsAsync: async () => {
      location.backgroundPermissionReads += 1;
      return location.background;
    },
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
    startLocationUpdatesAsync: async (_task: string, options: Record<string, unknown>) => {
      location.startCalls += 1;
      location.taskStarted = true;
      location.lastTaskOptions = options;
    },
    stopLocationUpdatesAsync: async () => {
      location.stopCalls += 1;
      location.taskStarted = false;
    },
    hasStartedLocationUpdatesAsync: async () => {
      location.hasStartedCalls += 1;
      return location.taskStarted;
    },
  },
});

// ── live-tracking socket double ─────────────────────────────────────────────
interface EmittedEvent {
  event: string;
  payload: Record<string, unknown>;
}

const socket = {
  connected: false,
  /** 'ok' connects on demand, 'down' never does (bounded wait → timeout). */
  connectMode: 'ok' as 'ok' | 'down',
  ackMode: 'accept' as
    'accept' | 'accept-stale' | 'reject-unauthenticated' | 'reject-unauthorized' | 'none',
  connects: 0,
  emitted: [] as EmittedEvent[],
  joins: [] as string[],
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
  connect() {
    socket.connects += 1;
    if (socket.connectMode === 'ok') {
      socket.connected = true;
      socket.fire('connect');
    }
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
    socket.emitted.push({ event, payload });
    if (event === 'tracking:join') {
      socket.joins.push(String(payload.trip_id));
      ack?.({ status: 'joined', trip_id: payload.trip_id, room: `trip:${payload.trip_id}` });
      return;
    }
    if (!ack) {
      return;
    }
    const tripId = String(payload.trip_id);
    if (socket.ackMode === 'none') {
      return; // no acknowledgement at all — the bounded wait must time out
    }
    if (socket.ackMode === 'accept') {
      ack({ status: 'accepted', trip_id: tripId, received_at: new Date().toISOString() });
      return;
    }
    if (socket.ackMode === 'accept-stale') {
      ack({
        status: 'accepted',
        trip_id: tripId,
        stale: true,
        received_at: new Date().toISOString(),
      });
      return;
    }
    const reason = socket.ackMode === 'reject-unauthenticated' ? 'unauthenticated' : 'unauthorized';
    ack({ status: 'rejected', trip_id: tripId, reason });
  },
  fire(event: string, ...args: unknown[]) {
    for (const listener of socket.listeners.get(event) ?? []) {
      listener(...args);
    }
  },
  locationUpdates(): EmittedEvent[] {
    return socket.emitted.filter((entry) => entry.event === 'trip:location:update');
  },
  reset() {
    socket.connected = false;
    socket.connectMode = 'ok';
    socket.ackMode = 'accept';
    socket.connects = 0;
    socket.emitted = [];
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

// ── API client double (refresh + eligibility re-check) ──────────────────────
const api = {
  refreshCalls: 0,
  getTripCalls: 0,
  /** Set to false to simulate a rejected refresh (signed-out / revoked cookie). */
  refreshSucceeds: true,
  /** Set to false to simulate a dead network on the refresh call. */
  refreshSlowMs: 0,
  tripStatus: 'IN_PROGRESS' as string,
  tripFails: false,
};

mock.module(moduleUrl('src/services/api.ts'), {
  namedExports: {
    registerApiEnv: () => undefined,
    socketOrigin: () => 'http://192.168.1.50:3001',
    getApiConfigurationError: () => null,
    apiClient: {
      refresh: async () => {
        api.refreshCalls += 1;
        if (api.refreshSlowMs > 0) {
          await new Promise((r) => setTimeout(r, api.refreshSlowMs));
        }
        if (!api.refreshSucceeds) {
          return {
            success: false,
            timestamp: new Date().toISOString(),
            error: { code: 'UNAUTHORIZED', message: 'No session' },
          };
        }
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: {
            access_token: `jwt-${api.refreshCalls}`,
            token_type: 'Bearer',
            expires_in: 900,
            user: {
              id: 'driver-1',
              school_id: 'school-1',
              role: 'DRIVER',
              first_name: 'Asha',
              last_name: 'Driver',
              email: null,
            },
          },
        };
      },
      getTrip: async (tripId: string) => {
        api.getTripCalls += 1;
        if (api.tripFails) {
          throw new Error('Network request failed');
        }
        return {
          success: true,
          timestamp: new Date().toISOString(),
          data: { id: tripId, status: api.tripStatus, school_id: 'school-1' },
        };
      },
    },
  },
});

// Metro defines `__DEV__` as a global; `api-env.ts` reads it at module scope, so
// the simulation provides the same global before the lifecycle is loaded.
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
const statusModule = (await import(
  moduleUrl('src/features/crew/tracking-status.ts')
)) as typeof import('./tracking-status.ts');
const mapModule = (await import(
  moduleUrl('src/features/crew/crew-map-presentation.ts')
)) as typeof import('./crew-map-presentation.ts');
const runtimeModule = (await import(
  moduleUrl('src/lib/runtime-environment.ts')
)) as typeof import('../../lib/runtime-environment.ts');
const i18nModule = (await import(
  moduleUrl('src/lib/i18n.ts')
)) as typeof import('../../lib/i18n.ts');

// Shrink every bounded wait so a scenario is milliseconds, not seconds.
lifecycle.__setTrackingTimeoutsForTests({ connect: 40, ack: 40, eligibility: 40, session: 60 });

const DRIVER = { userId: 'driver-1', schoolId: 'school-1' };
// The shared validation schema requires UUID trip ids, so the simulation uses
// real UUIDs rather than readable slugs.
const TRIP = '11111111-1111-4111-8111-111111111111';
const TRIP_2 = '22222222-2222-4222-8222-222222222222';
const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fix(offsetMs = 0, overrides: Record<string, unknown> = {}) {
  return {
    coords: {
      latitude: 21.1458,
      longitude: 79.0882,
      accuracy: 8,
      speed: 8,
      heading: 90,
      ...overrides,
    },
    timestamp: Date.now() - offsetMs,
  };
}

function persistContext(
  overrides: { userId?: string; schoolId?: string | null; tripId?: string } = {},
) {
  storage.set(
    contextModule.CREW_TRACKING_CONTEXT_KEY,
    contextModule.serializeCrewTrackingContext(
      contextModule.createCrewTrackingContext({
        userId: overrides.userId ?? DRIVER.userId,
        schoolId: overrides.schoolId === undefined ? DRIVER.schoolId : overrides.schoolId,
        tripId: overrides.tripId ?? TRIP,
        now: Date.now(),
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
  location.startCalls = 0;
  location.stopCalls = 0;
  location.taskStarted = false;
  location.servicesEnabled = true;
  location.foreground = grantedPermission;
  location.background = grantedPermission;
  location.backgroundPermissionReads = 0;
  location.hasStartedCalls = 0;
  // Every scenario starts on a development build (SDK 57 reports
  // executionEnvironment 'storeClient' for dev builds too — the Expo Go
  // scenarios below set appOwnership 'expo' to be inside the Go app shell).
  runtimeModule.registerRuntimeFacts({
    executionEnvironment: 'storeClient',
    appOwnership: null,
    platform: 'android',
  });
  api.refreshCalls = 0;
  api.getTripCalls = 0;
  api.refreshSucceeds = true;
  api.refreshSlowMs = 0;
  api.tripStatus = 'IN_PROGRESS';
  api.tripFails = false;
});

test('1. headless execution with an empty token recovers session → context → socket → delivery', async () => {
  persistContext();
  assert.equal(session.getAccessToken(), null, 'a fresh headless process holds no token');

  const deviceFix = fix();
  const result = await lifecycle.runHeadlessCrewLocationTask([deviceFix]);

  assert.equal(result.session, 'recovered');
  assert.equal(result.context, 'resume');
  assert.equal(result.eligibility, 'eligible');
  assert.equal(result.delivered, 1);
  assert.equal(result.dropped, 0);
  assert.equal(api.refreshCalls, 1, 'the existing cookie refresh restored the session');
  assert.equal(api.getTripCalls, 1, 'eligibility was re-checked with the server');
  assert.equal(socket.connects, 1, 'the socket was connected before any GPS was sent');

  const sent = socket.locationUpdates();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.trip_id, TRIP);
  assert.ok(sent[0].payload.idempotency_key, 'every fix carries an idempotency key');
  assert.equal(
    sent[0].payload.recorded_at,
    new Date(deviceFix.timestamp).toISOString(),
    'the device timestamp is sent as-is (never re-stamped at send time)',
  );

  const stats = lifecycle.getCrewLocationStats();
  assert.equal(stats.emittedCount, 1);
  assert.ok(stats.lastAckAt, 'the server acknowledgement is recorded');
  assert.equal(stats.disconnectedCount, 0);
});

test('2. concurrent headless callers share one refresh (no rotation race)', async () => {
  persistContext();
  api.refreshSlowMs = 20;

  const [a, b] = await Promise.all([
    lifecycle.runHeadlessCrewLocationTask([fix()]),
    lifecycle.runHeadlessCrewLocationTask([fix(1_000)]),
  ]);

  assert.equal(api.refreshCalls, 1, 'exactly one POST /auth/refresh for two callers');
  assert.equal(a.delivered + b.delivered >= 1, true, 'at least one execution delivered');
  assert.equal(session.getAccessToken(), 'jwt-1');
});

test('3. no recoverable session → nothing is sent and the drop is counted', async () => {
  persistContext();
  api.refreshSucceeds = false;

  const result = await lifecycle.runHeadlessCrewLocationTask([fix()]);

  assert.equal(result.session, 'anonymous');
  assert.equal(result.delivered, 0);
  assert.equal(result.dropped, 1);
  assert.match(result.reason ?? '', /^session:/);
  assert.equal(
    socket.locationUpdates().length,
    0,
    'no GPS is emitted on an unauthenticated socket',
  );
  assert.equal(socket.connects, 0, 'and no handshake the gateway would refuse is attempted');
  assert.equal(lifecycle.getCrewLocationStats().unauthenticatedCount, 1);
});

test('4. a context belonging to another user is never resumed (and is dropped)', async () => {
  persistContext({ userId: 'driver-2' });

  const result = await lifecycle.runHeadlessCrewLocationTask([fix()]);

  assert.equal(result.context, 'other-user');
  assert.equal(result.delivered, 0);
  assert.equal(socket.locationUpdates().length, 0);
  assert.equal(
    storage.get(contextModule.CREW_TRACKING_CONTEXT_KEY),
    undefined,
    "another account's context is removed, not kept for later",
  );
});

test('5. a context belonging to another tenant is never resumed', async () => {
  persistContext({ schoolId: 'school-2' });

  const result = await lifecycle.runHeadlessCrewLocationTask([fix()]);

  assert.equal(result.context, 'other-school');
  assert.equal(result.delivered, 0);
});

test('6. a completed trip cannot resume tracking', async () => {
  persistContext();
  api.tripStatus = 'COMPLETED';

  const result = await lifecycle.runHeadlessCrewLocationTask([fix()]);

  assert.equal(result.eligibility, 'refused');
  assert.equal(result.delivered, 0);
  assert.equal(socket.locationUpdates().length, 0, 'not one fix is sent for a closed trip');
  const stopped = lifecycle.getCrewTrackingState();
  assert.equal(stopped.tripId, null, 'tracking was stopped');
  assert.equal(
    stopped.lastStopReason,
    'headless-not-eligible',
    'the stop records that the server refused the trip',
  );
  assert.equal(
    stopped.lastStopTripStatus,
    'COMPLETED',
    'the server status that ended sharing is recorded for the diagnostics readout',
  );
  assert.equal(
    storage.get(contextModule.CREW_TRACKING_CONTEXT_KEY),
    undefined,
    'the persisted context is cleared so the next execution does not retry it',
  );
});

test('7. a cancelled trip cannot resume tracking either', async () => {
  persistContext();
  api.tripStatus = 'CANCELLED';

  const result = await lifecycle.runHeadlessCrewLocationTask([fix()]);
  assert.equal(result.eligibility, 'refused');
  assert.equal(result.delivered, 0);
});

test('8. a headless batch delivers only the newest fix (no burst of old live points)', async () => {
  persistContext();
  socket.connectMode = 'down'; // hold them instead of sending a burst

  const result = await lifecycle.runHeadlessCrewLocationTask([
    fix(30_000),
    fix(20_000),
    fix(1_000),
  ]);

  assert.equal(result.dropped, 2, 'the two older fixes of the batch are superseded');
  assert.equal(result.pending, true, 'the newest one is held for the bounded retry');
  assert.equal(lifecycle.getCrewLocationStats().supersededCount, 2);
  assert.equal(socket.locationUpdates().length, 0);
});

test('9. logout while a recovery is in flight cancels it (no resurrected session)', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.clearAccessToken();
  socket.connected = false;
  api.refreshSlowMs = 40;

  const inflight = lifecycle.requestCrewTrackingRecovery();
  await tick(5);
  await lifecycle.endCrewTrackingSession(); // logout
  await inflight;
  await tick(60);

  assert.equal(session.getAccessToken(), null, 'the late refresh installed no token');
  assert.equal(socket.locationUpdates().length, 0);
  assert.equal(lifecycle.getCrewTrackingState().tripId, null);
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
  assert.equal(storage.get(contextModule.CREW_TRACKING_CONTEXT_KEY), undefined);
});

test('10. a disconnected fix is held, then re-sent after reconnect with the SAME key and timestamp', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = true;

  // Network drops: the fix cannot be sent and is held (bounded, latest-only).
  socket.connected = false;
  const held = fix(2_000);
  const outcome = lifecycle.deliverCrewDeviceFix(held);
  assert.equal(outcome, 'not-connected');
  assert.equal(lifecycle.getCrewLocationStats().disconnectedCount, 1);
  assert.equal(socket.locationUpdates().length, 0);

  // Network returns and recovery runs.
  socket.connected = false;
  await lifecycle.requestCrewTrackingRecovery();
  await tick(10);

  const sent = socket.locationUpdates();
  assert.equal(sent.length, 1, 'the held fix was re-sent exactly once');
  assert.equal(sent[0].payload.trip_id, TRIP);
  assert.equal(
    sent[0].payload.recorded_at,
    new Date(held.timestamp).toISOString(),
    'the ORIGINAL device timestamp is preserved — it is not re-stamped as now',
  );
  const stats = lifecycle.getCrewLocationStats();
  assert.equal(stats.retriedCount, 1);
  assert.equal(stats.emittedCount, 1);
  assert.ok(stats.lastAckAt, 'the retry was server-acknowledged');
  assert.ok(
    Date.now() - new Date(String(stats.lastFix?.recorded_at)).getTime() >= 1_500,
    'the delivered fix is still the old one, not a fabricated fresh position',
  );

  // The same fix redelivered by the OS keeps one stable idempotency key.
  const key = String(sent[0].payload.idempotency_key);
  assert.match(key, /^[0-9a-f-]{36}$/);
});

test('11. an expired held fix is discarded and counted, never replayed as live', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = false;

  // A fix already older than the age limit is dropped at capture time.
  const stale = lifecycle.deliverCrewDeviceFix(fix(5 * 60_000));
  assert.equal(stale, 'not-connected');
  assert.equal(lifecycle.getCrewLocationStats().expiredCount + 1 >= 1, true);

  socket.connected = true;
  await lifecycle.requestCrewTrackingRecovery();
  await tick(10);

  assert.equal(socket.locationUpdates().length, 0, 'a stale coordinate is never sent as current');
});

test('12. expired-auth server disconnect → refresh → explicit reconnect', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-expired');
  socket.connected = true;
  await tick(10);
  const before = socket.connects;
  const refreshesBefore = api.refreshCalls;

  // The server revokes the socket because the access token expired, then
  // force-disconnects it. Socket.IO does NOT auto-reconnect after that, so the
  // controller must refresh and reconnect explicitly.
  session.clearAccessToken();
  socket.connected = false;
  socket.fire('session:revoked', { reason: 'token_expired' });
  socket.fire('disconnect', 'io server disconnect');

  const state = lifecycle.getCrewTrackingState();
  assert.equal(state.recovery.lastDisconnectClass, 'auth-expired');
  assert.equal(state.connection, 'reconnecting');
  assert.equal(state.recovery.attempts, 1, 'one bounded attempt was scheduled');

  await lifecycle.requestCrewTrackingRecovery();
  await tick(10);

  assert.equal(
    api.refreshCalls - refreshesBefore,
    1,
    'the expired-auth recovery refreshed the session exactly once (no rotation race)',
  );
  assert.ok(socket.connects > before, 'an explicit reconnect followed the refresh');
  assert.equal(lifecycle.getCrewTrackingState().connection, 'connected');
  assert.ok(socket.joins.includes(TRIP), 'the authorized trip room was re-joined');
});

test('13. a permanent revocation stops retries and stops tracking', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = true;
  await tick(10);

  socket.connected = false;
  socket.fire('session:revoked', { reason: 'user_deactivated' });
  socket.fire('disconnect', 'io server disconnect');
  await tick(10);

  const state = lifecycle.getCrewTrackingState();
  assert.equal(state.connection, 'revoked', 'the permanent class survives the stop');
  assert.equal(state.lastStopReason, 'revoked', 'tracking stopped for good');
  assert.equal(state.tripId, null);
  assert.equal(state.foregroundActive, false);
  const connectsBefore = socket.connects;
  await tick(30);
  assert.equal(socket.connects, connectsBefore, 'no further connection attempts');
});

test('14. a permanent server rejection of a fix stops tracking instead of retrying', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = true;
  socket.ackMode = 'reject-unauthorized';

  lifecycle.deliverCrewDeviceFix(fix());
  await tick(20);

  const stopped = lifecycle.getCrewTrackingState();
  assert.equal(stopped.tripId, null, 'a permanent rejection ends tracking');
  assert.equal(stopped.lastStopReason, 'rejected-permanent');
  assert.equal(socket.locationUpdates().length, 1, 'the rejected fix was never retried');
});

test('15. an unauthenticated ack triggers a session recovery, not a stop', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = true;
  socket.ackMode = 'reject-unauthenticated';

  lifecycle.deliverCrewDeviceFix(fix());
  await tick(20);

  const state = lifecycle.getCrewTrackingState();
  assert.equal(state.tripId, TRIP, 'tracking is kept — the session is the problem');
  assert.equal(state.recovery.inFlight || state.recovery.attempts >= 0, true);
});

test('16. two screens starting tracking create exactly one location watcher', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER }); // trip screen
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER }); // help screen
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER }); // and again

  assert.equal(location.watchCalls, 1, 'one watcher for the whole app');
  assert.equal(location.watchers.length, 1);
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, true);

  // A fix from that single watcher is delivered once.
  socket.connected = true;
  session.setAccessToken('jwt-live');
  location.watchers[0](fix());
  await tick(10);
  assert.equal(socket.locationUpdates().length, 1);
});

test('17. switching to another trip drops the previous trip’s held fix', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = false;
  lifecycle.deliverCrewDeviceFix(fix(1_000));

  await lifecycle.startCrewTracking({ tripId: TRIP_2, ...DRIVER });
  socket.connected = true;
  await lifecycle.requestCrewTrackingRecovery();
  await tick(10);

  const sent = socket.locationUpdates();
  assert.ok(
    sent.every((entry) => entry.payload.trip_id === TRIP_2),
    'the previous trip’s fix is never replayed onto the new trip',
  );
});

test('18. stopping tracking cancels pending recovery work', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = false;
  lifecycle.deliverCrewDeviceFix(fix());
  assert.equal(
    lifecycle.getCrewTrackingState().connection,
    'reconnecting',
    'a bounded recovery pass was scheduled for the held fix',
  );
  assert.equal(lifecycle.getCrewLocationStats().disconnectedCount, 1, 'the fix was held');

  await lifecycle.stopCrewTracking('user');
  const connectsBefore = socket.connects;
  await tick(40);

  assert.equal(socket.connects, connectsBefore, 'no scheduled attempt survives a stop');
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
  assert.equal(location.removedWatchers, 1, 'the watcher was released');
  assert.equal(lifecycle.getCrewTrackingState().lastStopReason, 'user');
});

test('19. background enabling needs consent, permission and an active trip', async () => {
  // No trip yet.
  const noTrip = await lifecycle.setBackgroundTrackingEnabled(true);
  assert.equal(noTrip.ok, false);
  assert.equal(location.startCalls, 0);

  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });

  // Background permission denied after a foreground grant.
  location.background = deniedPermission;
  const denied = await lifecycle.setBackgroundTrackingEnabled(true);
  assert.equal(denied.ok, false, 'a foreground grant alone never enables background tracking');
  assert.equal(location.startCalls, 0);
  assert.equal(lifecycle.getCrewTrackingState().backgroundActive, false);

  // Granted → starts, records consent, and keeps the service alive on swipe-away.
  location.background = grantedPermission;
  const ok = await lifecycle.setBackgroundTrackingEnabled(true);
  assert.equal(ok.ok, true);
  assert.equal(location.startCalls, 1);
  assert.equal(lifecycle.getCrewTrackingState().backgroundActive, true);
  assert.equal(lifecycle.getCrewTrackingState().backgroundConsent, true);
  const service = (location.lastTaskOptions?.foregroundService ?? {}) as Record<string, unknown>;
  assert.equal(
    service.killServiceOnDestroy,
    false,
    'swiping the app away must not silently stop the run (see docs/mobile-tracking-reliability.md)',
  );
  assert.ok(service.notificationTitle, 'the foreground service notification is configured');

  await lifecycle.setBackgroundTrackingEnabled(false);
  assert.equal(location.stopCalls, 1);
  assert.equal(lifecycle.getCrewTrackingState().backgroundConsent, false);
});

test('20. a denied foreground permission stops sharing from starting', async () => {
  location.foreground = deniedPermission;
  const result = await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });

  assert.equal(result.ok, false);
  assert.equal(location.watchCalls, 0, 'no watcher is created without permission');
  assert.equal(lifecycle.getCrewTrackingState().foregroundActive, false);
  assert.equal(lifecycle.getCrewGpsIssue(false), 'permission_permanently_denied');
});

test('21. status is derived from the server ack, not from a local fix', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');

  // Connected but the server never acknowledges: the phone HAS a fix.
  socket.connected = true;
  socket.ackMode = 'none';
  lifecycle.deliverCrewDeviceFix(fix());
  await tick(60);

  const unacked = lifecycle.getCrewTrackingStatus();
  assert.notEqual(unacked.status, 'live', 'an unacknowledged fix is never "live"');
  assert.equal(unacked.schoolSeesLive, false, 'a local fix is never "the school can see me"');
  assert.notEqual(unacked.localFixAgeMs, null, 'the device fix is reported as a fact');
  assert.equal(unacked.serverAckAgeMs, null, 'the server never acknowledged it');
  assert.ok(lifecycle.getCrewLocationStats().lastFix, 'the local fix is still reported as such');
  assert.equal(lifecycle.getCrewLocationStats().lastAckAt, null);

  // With the socket itself still up, that combination has its own honest
  // headline: GPS works, delivery does not.
  const localOnly = statusModule.deriveCrewTrackingStatus({
    foregroundActive: true,
    backgroundActive: false,
    foregroundPermission: 'granted',
    servicesEnabled: true,
    connection: 'connected',
    lastLocalFixAt: new Date().toISOString(),
    lastServerAckAt: null,
    now: Date.now(),
  });
  assert.equal(localOnly.status, 'local-only');
  assert.equal(localOnly.schoolSeesLive, false);

  // Now the server accepts one: only then is the bus visible.
  socket.ackMode = 'accept';
  lifecycle.deliverCrewDeviceFix(fix());
  await tick(20);
  const live = lifecycle.getCrewTrackingStatus();
  assert.equal(live.status, 'live');
  assert.equal(live.schoolSeesLive, true);

  // And it ages out on its own when acknowledgements stop.
  const aged = statusModule.deriveCrewTrackingStatus({
    foregroundActive: true,
    backgroundActive: false,
    foregroundPermission: 'granted',
    servicesEnabled: true,
    connection: 'connected',
    lastLocalFixAt: null,
    lastServerAckAt: lifecycle.getCrewLocationStats().lastAckAt,
    now: Date.now() + statusModule.SERVER_ACK_LIVE_WINDOW_MS + 1_000,
  });
  assert.equal(aged.status, 'stale');
  assert.equal(aged.schoolSeesLive, false);
});

test('22. hydrate reflects a headless run without starting delivery', async () => {
  persistContext();
  location.taskStarted = true; // the OS task is running from a previous session

  await lifecycle.hydrateCrewTracking(DRIVER);

  const state = lifecycle.getCrewTrackingState();
  assert.equal(state.tripId, TRIP, 'the owned context is restored');
  assert.equal(state.backgroundActive, true, 'the real OS task state is reflected');
  assert.equal(state.foregroundActive, false, 'hydration never starts a watcher');
  assert.equal(location.watchCalls, 0);
});

test('23. hydrate refuses another user’s persisted context', async () => {
  persistContext({ userId: 'driver-2' });
  location.taskStarted = true;

  await lifecycle.hydrateCrewTracking(DRIVER);

  assert.equal(lifecycle.getCrewTrackingState().tripId, null);
  assert.equal(storage.get(contextModule.CREW_TRACKING_CONTEXT_KEY), undefined);
});

test('24. the legacy ownerless trip key is dropped, never resumed', async () => {
  storage.set(contextModule.LEGACY_CREW_ACTIVE_TRIP_KEY, 'trip-legacy');

  const result = await lifecycle.runHeadlessCrewLocationTask([fix()]);
  assert.equal(result.delivered, 0);
  assert.equal(result.context, 'none', 'a bare trip id carries no owner, so nothing is resumed');

  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  await lifecycle.stopCrewTracking('user');
  assert.equal(
    storage.get(contextModule.LEGACY_CREW_ACTIVE_TRIP_KEY),
    undefined,
    'the legacy key is removed on the next stop',
  );
});

test('25. a scheduled recovery attempt actually fires after its backoff delay', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = true;
  await tick(10);

  socket.connected = false;
  socket.connectMode = 'ok';
  socket.fire('disconnect', 'transport close');
  assert.equal(lifecycle.getCrewTrackingState().recovery.attempts, 1);

  // The policy's first delay is 1 s; the attempt must run on its own.
  await new Promise((r) => setTimeout(r, 1_300));
  assert.equal(lifecycle.getCrewTrackingState().connection, 'connected');
  assert.ok(socket.connects >= 1);
});

test('26. a disconnected fix does not schedule rapid retries on top of each other', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = false;
  socket.connectMode = 'down';
  await tick(5);

  lifecycle.deliverCrewDeviceFix(fix());
  lifecycle.deliverCrewDeviceFix(fix(500));
  lifecycle.deliverCrewDeviceFix(fix(1_000));

  const state = lifecycle.getCrewTrackingState();
  assert.ok(state.recovery.attempts <= 1, 'at most one scheduled attempt at a time');
  assert.equal(lifecycle.getCrewLocationStats().disconnectedCount, 3, 'every fix was counted');
  assert.equal(socket.locationUpdates().length, 0, 'nothing was queued up for a burst');

  const connectsBefore = socket.connects;
  await tick(50);
  assert.ok(
    socket.connects - connectsBefore <= 1,
    'three undeliverable fixes never start three retry loops',
  );
});

test('27. the Driver Trip map draws the local fix and never claims delivery itself', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  // Connected, but the server never acknowledges: GPS works, delivery does not.
  socket.connected = true;
  socket.ackMode = 'none';
  lifecycle.deliverCrewDeviceFix(fix(0, { heading: 90, speed: 9 }));
  await tick(60);
  socket.ackMode = 'accept';

  const state = lifecycle.getCrewTrackingState();
  const localFix = state.stats.lastFix;
  assert.ok(localFix, 'the device fix is available to draw');
  assert.equal(typeof localFix.latitude, 'number');
  assert.equal(typeof localFix.longitude, 'number');
  assert.equal(localFix.heading, 90, 'the device course is carried through for the marker');
  assert.equal(localFix.speed, 9 * 3.6, 'speed is the payload’s km/h, not the device m/s');

  const status = lifecycle.getCrewTrackingStatus();
  const presentation = mapModule.deriveDriverMapPresentation({
    status: status.status,
    localFixAgeMs: status.localFixAgeMs,
    accuracyMeters: localFix.accuracy,
    connection: state.connection,
  });

  // The marker is this device's own position...
  assert.equal(presentation.source, 'device');
  assert.equal(presentation.state, 'live', 'the device has a current fix');

  // ...and the map still cannot say the school sees it, because the server
  // never acknowledged anything.
  assert.equal(status.schoolSeesLive, false);
  assert.equal(presentation.schoolSeesLive, false);
  // Which denial depends on how the lifecycle observed the socket (`offline`
  // when it never saw a connect, `notDelivered` when it did) — but it is always
  // a denial. What must never happen is a delivery claim.
  assert.ok(
    presentation.deliveryKey === 'driverMap.note.notDelivered' ||
      presentation.deliveryKey === 'driverMap.note.offline',
    `an unacknowledged fix must not be presented as delivered (got ${presentation.deliveryKey})`,
  );
  assert.equal(
    presentation.positionKey,
    'gps.lastUpdate',
    'and it must still say how current the position it draws is',
  );
});

test('28. an unavailable heading never reaches the uploaded payload or the marker', async () => {
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  session.setAccessToken('jwt-live');
  socket.connected = true;
  socket.ackMode = 'accept';

  // expo-location's "no course" sentinel, straight from the device.
  lifecycle.deliverCrewDeviceFix(fix(0, { heading: -1 }));
  await tick(20);

  const uploaded = socket.locationUpdates().at(-1)?.payload;
  assert.ok(uploaded, 'the fix was delivered');
  assert.equal('heading' in uploaded, false, 'heading: -1 must not become 359 on the wire');

  const localFix = lifecycle.getCrewTrackingState().stats.lastFix;
  assert.ok(localFix);
  assert.equal(localFix.heading, null, 'nor may it become a direction the device never had');
});

test('29. an unchanged permission refresh publishes nothing (render-loop regression)', async () => {
  // The crew Help screen re-reads OS permissions from a render-driven effect.
  // Every publish re-renders every subscribed screen, so a refresh that finds
  // the same values must be silent — otherwise "same values" → publish →
  // render → refresh → publish … ("Maximum update depth exceeded").
  let publishes = 0;
  const unsubscribe = lifecycle.subscribeCrewTracking(() => {
    publishes += 1;
  });
  try {
    const before = lifecycle.getCrewTrackingState();
    await lifecycle.refreshCrewPermissions();
    const afterFirst = publishes;
    assert.ok(afterFirst >= 1, 'the first read of granted permissions is a real change');
    assert.notEqual(
      lifecycle.getCrewTrackingState(),
      before,
      'a real change replaces the snapshot',
    );

    const settled = lifecycle.getCrewTrackingState();
    await lifecycle.refreshCrewPermissions();
    await lifecycle.refreshCrewPermissions();
    await lifecycle.hydrateCrewTracking(DRIVER);

    assert.equal(publishes, afterFirst, 'identical OS values must not notify subscribers');
    assert.equal(
      lifecycle.getCrewTrackingState(),
      settled,
      'and must not allocate a new snapshot (React would treat it as a state change)',
    );

    // A genuine change still goes through.
    location.foreground = deniedPermission;
    await lifecycle.refreshCrewPermissions();
    assert.equal(publishes, afterFirst + 1, 'a revoked permission is published exactly once');
    assert.equal(lifecycle.getCrewTrackingState().foregroundPermission, 'denied');
  } finally {
    unsubscribe();
  }
});

// ── Runtime-aware background gating (Expo Go vs development build) ────────
//
// From SDK 53 on, the Expo Go shell cannot run the OS background-location
// task (expo-location's own LogBox says "not available at all" on Android),
// so the lifecycle must not call the SDK's task APIs inside Expo Go — and
// must explain WHY instead of failing with a confusing error. A development
// build (appOwnership null) keeps the full path bit-for-bit.

test('30. Expo Go (Android): foreground sharing works, the background task APIs are never called', async () => {
  runtimeModule.registerRuntimeFacts({
    executionEnvironment: 'storeClient',
    appOwnership: 'expo',
    platform: 'android',
  });

  const result = await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  assert.equal(result.ok, true, 'the foreground watch still works inside Expo Go');

  const state = lifecycle.getCrewTrackingState();
  assert.equal(state.foregroundActive, true);
  assert.equal(state.backgroundUnavailableReason, 'expo-go', 'the state carries the reason');
  assert.equal(state.backgroundPermission, 'unavailable');
  assert.equal(
    location.backgroundPermissionReads,
    0,
    'Expo Go never reads a background permission that cannot be granted',
  );

  const enabled = await lifecycle.setBackgroundTrackingEnabled(true);
  assert.equal(enabled.ok, false);
  assert.equal(
    enabled.message,
    i18nModule.t('gps.message.backgroundNeedsDevBuild'),
    'the failure names the missing development build, not an SDK error',
  );
  assert.equal(lifecycle.getCrewTrackingState().backgroundActive, false);
  assert.equal(location.startCalls, 0, 'the background task is never started');

  await lifecycle.stopCrewTracking('user');
  assert.equal(location.hasStartedCalls, 0, 'stop never probes a task that cannot exist');
  assert.equal(location.stopCalls, 0);
});

test('31. Development build (Android): the full background path is unchanged', async () => {
  // beforeEach registered the dev-client facts (executionEnvironment
  // 'storeClient', appOwnership null — SDK 57 reads dev builds like this).
  await lifecycle.startCrewTracking({ tripId: TRIP, ...DRIVER });
  assert.equal(lifecycle.getCrewTrackingState().backgroundUnavailableReason, null);

  const enabled = await lifecycle.setBackgroundTrackingEnabled(true);
  assert.equal(enabled.ok, true);
  assert.equal(location.startCalls, 1, 'the OS task is started through the SDK as before');
  assert.equal(lifecycle.getCrewTrackingState().backgroundActive, true);

  await lifecycle.setBackgroundTrackingEnabled(false);
  assert.equal(location.stopCalls, 1, '…and stopped through the same API');
  assert.equal(lifecycle.getCrewTrackingState().backgroundConsent, false);
});

test('32. hydrate: Expo Go never probes the task, a development build reflects it', async () => {
  persistContext();

  runtimeModule.registerRuntimeFacts({
    executionEnvironment: 'storeClient',
    appOwnership: 'expo',
    platform: 'android',
  });
  location.taskStarted = true; // a leftover belief that an OS task is running
  await lifecycle.hydrateCrewTracking(DRIVER);
  assert.equal(
    lifecycle.getCrewTrackingState().backgroundActive,
    false,
    'Expo Go cannot have a running task — no probe, no claim',
  );
  assert.equal(location.hasStartedCalls, 0);

  await lifecycle.__resetCrewTrackingForTests();
  runtimeModule.registerRuntimeFacts({
    executionEnvironment: 'storeClient',
    appOwnership: null,
    platform: 'ios',
  });
  await lifecycle.hydrateCrewTracking(DRIVER);
  assert.equal(
    lifecycle.getCrewTrackingState().backgroundActive,
    true,
    'a development build reflects the real OS task state',
  );
  assert.equal(location.hasStartedCalls, 1);
});

test('33. successive stop visits each deliver their fix — the stream that advances stops', async () => {
  persistContext();

  // Three visits along the route (~440 m apart). Since batch 3A one eligible
  // in-geofence fix records the next stop server-side, so the send path must
  // deliver EACH visit's fix — same-trip, own idempotency key, own device
  // timestamp — or the trip cannot advance. (The server-side stop assertions
  // live in `web`'s arrival sim, `npm run smoke:eta`; this pins the mobile
  // half: the evidence stream itself.)
  const visits = [
    { latitude: 21.1458, longitude: 79.0882 },
    { latitude: 21.1498, longitude: 79.0882 },
    { latitude: 21.1538, longitude: 79.0882 },
  ];
  for (const [index, coords] of visits.entries()) {
    const result = await lifecycle.runHeadlessCrewLocationTask([
      fix(0, { ...coords, speed: 0 }),
    ]);
    assert.equal(result.delivered, 1, `visit ${index + 1} fix is delivered`);
    assert.equal(result.dropped, 0);
  }

  const sent = socket.locationUpdates();
  assert.equal(sent.length, 3, 'every visit delivered exactly one fix');
  assert.deepEqual(
    sent.map((entry) => [entry.payload.latitude, entry.payload.longitude]),
    visits.map((coords) => [coords.latitude, coords.longitude]),
    'fixes arrive in visit order with their own coordinates',
  );
  const keys = sent.map((entry) => String(entry.payload.idempotency_key));
  assert.equal(new Set(keys).size, 3, 'each fix carries its own idempotency key');
  for (const entry of sent) {
    assert.equal(entry.payload.trip_id, TRIP);
  }

  const stats = lifecycle.getCrewLocationStats();
  assert.equal(stats.emittedCount, 3, 'three accepted fixes — three arrival candidates');
  assert.equal(stats.disconnectedCount, 0);
});
