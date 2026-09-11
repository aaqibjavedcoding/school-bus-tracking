import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TripStatus } from '@school-bus-tracking/shared-types';

/**
 * End-to-end simulation of the crew offline queue against the real
 * `attendance-queue` + `attendance-sync` modules, with AsyncStorage, NetInfo,
 * AppState and the API client mocked (`--experimental-test-module-mocks`).
 * Run with `npm run test:offline-sim`. Covers: online success, offline queue,
 * reconnect sync, transient failure retry, server-side idempotent replay,
 * permanent rejection + retry, and per-user isolation.
 */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../') + '/';
const store = new Map<string, string>();
mock.module('@react-native-async-storage/async-storage', { defaultExport: {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
}});
let netListener: ((s: unknown) => void) | null = null;
mock.module('@react-native-community/netinfo', { defaultExport: {
  addEventListener: (fn: (s: unknown) => void) => { netListener = fn; return () => { netListener = null; }; },
}});
mock.module('react-native', { namedExports: {
  AppState: { addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'android' },
}});
const { ApiClientError } = await import('@school-bus-tracking/api-client');
const serverCalls: { kind: string; key: string }[] = [];
const applied = new Map<string, unknown>();
const state = { online: true, failNext: 0, reject: 0 };
function serverPost(kind: string, key: string) {
  serverCalls.push({ kind, key });
  if (!state.online) throw new ApiClientError('Network request failed', 0);
  if (state.failNext > 0) { state.failNext -= 1; throw new ApiClientError('Bad gateway', 502); }
  if (state.reject > 0) { state.reject -= 1; throw new ApiClientError('Invalid transition', 400); }
  if (applied.has(key)) return applied.get(key);
  const res = { success: true, data: { kind } };
  applied.set(key, res);
  return res;
}
const h = (o: RequestInit) => (o.headers as Record<string, string>)['x-idempotency-key'];
mock.module(pathToFileURL(ROOT + 'src/services/api.ts').href, { namedExports: { apiClient: {
  boardTripStudent: async (_t: string, s: string, o: RequestInit) => serverPost(`board:${s}`, h(o)),
  dropTripStudent: async (_t: string, s: string, o: RequestInit) => serverPost(`drop:${s}`, h(o)),
  updateTripStatus: async (_t: string, b: { status: string }, o: RequestInit) => serverPost(`status:${b.status}`, h(o)),
}}});

const queue = await import(pathToFileURL(ROOT + 'src/features/crew/offline/attendance-queue.ts').href);
const sync = await import(pathToFileURL(ROOT + 'src/features/crew/offline/attendance-sync.ts').href);
const { shouldQueueAfterError } = await import(pathToFileURL(ROOT + 'src/features/crew/offline/useOfflineAction.ts').href);

const USER = 'driver-1';
const net = (online: boolean) => { state.online = online; netListener?.({ isConnected: online, isInternetReachable: online }); };
const tick = () => new Promise((r) => setTimeout(r, 30));

// The same flow useOfflineAction.execute runs (hooks need React; replicate the logic).
async function execute(action: Parameters<typeof queue.enqueue>[0], onlineCall: (key: string) => Promise<unknown>) {
  const item = await queue.enqueue(action);
  if (!sync.getSyncState().isOnline) { void sync.syncNow(); return 'queued'; }
  try { await onlineCall(item.idempotencyKey); }
  catch (e) {
    if (shouldQueueAfterError(e)) { void sync.syncNow(); return 'queued'; }
    await queue.markOutcome(item.id, { action: 'success' }); await queue.cleanupSuccessful(); throw e;
  }
  await queue.markOutcome(item.id, { action: 'success' }); await queue.cleanupSuccessful(); await sync.refreshCounts();
  return 'online';
}
const { apiClient } = (await import(pathToFileURL(ROOT + 'src/services/api.ts').href)) as typeof import('../../../services/api.ts');
const { withIdempotencyKey } = await import('@school-bus-tracking/api-client');

test('1. online → action succeeds immediately, queue empty', async () => {
  sync.startSyncManager(USER); await tick();
  const r = await execute({ kind: 'attendance', userId: USER, tripId: 't1', studentId: 's1', eventType: 'board' },
    (k) => apiClient.boardTripStudent('t1', 's1', withIdempotencyKey(k)));
  assert.equal(r, 'online');
  assert.equal(serverCalls.length, 1);
  assert.equal((await queue.loadQueue()).length, 0);
  assert.equal(sync.getSyncState().pendingCount, 0);
});

test('2. offline → action is queued, nothing hits the server', async () => {
  net(false); await tick();
  const r = await execute({ kind: 'attendance', userId: USER, tripId: 't1', studentId: 's2', eventType: 'board' },
    (k) => apiClient.boardTripStudent('t1', 's2', withIdempotencyKey(k)));
  assert.equal(r, 'queued');
  assert.equal(serverCalls.length, 1);
  await tick();
  assert.equal(sync.getSyncState().pendingCount, 1);
  assert.equal(sync.getSyncState().isOnline, false);
  // survives "restart": persisted in storage
  assert.match(store.get('@sbt/offline-attendance-queue')!, /"studentId":"s2"/);
});

test('3. internet returns → queued action syncs with its original key', async () => {
  net(true); await tick(); await tick();
  assert.equal(serverCalls.length, 2);
  assert.equal(serverCalls[1].kind, 'board:s2');
  assert.equal((await queue.loadQueue()).length, 0);
  assert.equal(sync.getSyncState().pendingCount, 0);
  assert.equal(sync.getSyncState().status, 'idle');
});

test('4. sync failure → retried without losing the action', async () => {
  state.failNext = 2; // online attempt 502, first background retry 502
  const r = await execute({ kind: 'trip_status', userId: USER, tripId: 't1', tripStatus: TripStatus.IN_PROGRESS },
    (k) => apiClient.updateTripStatus('t1', { status: TripStatus.IN_PROGRESS }, withIdempotencyKey(k)));
  assert.equal(r, 'queued');
  await tick();
  const items = await queue.loadQueue();
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'pending');
  assert.equal(items[0].retryCount, 1);
  assert.equal(sync.getSyncState().status, 'error');
  assert.equal(sync.getSyncState().pendingCount, 1);
  const keyBefore = items[0].idempotencyKey;
  // backoff window: force it due by rewinding lastSyncAt, then sync
  const raw = JSON.parse(store.get('@sbt/offline-attendance-queue')!);
  raw.items[0].lastSyncAt = new Date(Date.now() - 60_000).toISOString();
  store.set('@sbt/offline-attendance-queue', JSON.stringify(raw));
  await sync.syncNow(); await tick();
  assert.equal((await queue.loadQueue()).length, 0);
  const last = serverCalls[serverCalls.length - 1];
  assert.equal(last.kind, 'status:IN_PROGRESS');
  assert.equal(last.key, keyBefore, 'replay reuses the same idempotency key');
});

test('5. duplicate sync attempt → no duplicate mutation (server dedupes on key)', async () => {
  // Simulate "request reached server, response lost": server applied under key K, client thinks it failed.
  const item = await queue.enqueue({ kind: 'attendance', userId: USER, tripId: 't1', studentId: 's3', eventType: 'drop' });
  applied.set(item.idempotencyKey, { success: true, data: { kind: 'drop:s3', replay: true } });
  const before = applied.size;
  await sync.syncNow(); await tick();
  assert.equal(applied.size, before, 'no new server-side mutation');
  assert.equal((await queue.loadQueue()).length, 0);
  // Double tap while pending → single queue item
  net(false); await tick();
  const a = await queue.enqueue({ kind: 'attendance', userId: USER, tripId: 't1', studentId: 's4', eventType: 'board' });
  const b = await queue.enqueue({ kind: 'attendance', userId: USER, tripId: 't1', studentId: 's4', eventType: 'board' });
  assert.equal(a.id, b.id);
  const callsBefore = serverCalls.length;
  net(true); await tick(); await tick();
  assert.equal(serverCalls.length - callsBefore, 1);
});

test('permanent rejection (400) surfaces as failed, retry/dismiss work', async () => {
  net(false); await tick();
  await queue.enqueue({ kind: 'trip_status', userId: USER, tripId: 't1', tripStatus: TripStatus.COMPLETED });
  state.reject = 1;
  net(true); await tick(); await tick();
  assert.equal(sync.getSyncState().failedCount, 1);
  assert.equal(sync.getSyncState().pendingCount, 0);
  assert.match(sync.getSyncState().lastError ?? '', /Invalid transition/);
  await queue.retryFailed(USER); await sync.refreshCounts(); await sync.syncNow(); await tick();
  assert.equal(sync.getSyncState().failedCount, 0);
  assert.equal((await queue.loadQueue()).length, 0);
});

test('user isolation: another user’s pending items are never replayed under this session', async () => {
  net(false); await tick();
  await queue.enqueue({ kind: 'attendance', userId: 'someone-else', tripId: 't9', studentId: 'x', eventType: 'board' });
  const callsBefore = serverCalls.length;
  net(true); await tick(); await tick();
  assert.equal(serverCalls.length, callsBefore);
  assert.equal((await queue.loadQueue()).length, 1);
  sync.stopSyncManager();
  assert.equal(sync.getSyncState().pendingCount, 0);
});
