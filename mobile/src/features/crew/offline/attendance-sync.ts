import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { ApiClientError, withIdempotencyKey } from '@school-bus-tracking/api-client';
import {
  cleanupSuccessful,
  loadQueue,
  markOutcome,
  markSyncing,
  recoverInterruptedItems,
  type QueuedAttendanceEvent,
} from './attendance-queue.ts';
import { classifySyncOutcome, countFailed, countOpen, selectDueItems } from './queue-core.ts';
import { apiClient } from '../../../services/api.ts';

/**
 * Offline crew-action sync manager.
 *
 * Monitors connectivity and replays queued actions (attendance board/drop,
 * trip status transitions) **sequentially, oldest first** through the same
 * `apiClient` methods the online path uses, each with the idempotency key
 * captured when the action was queued. The API deduplicates on that key, so
 * a replay that already reached the server (response lost in transit, app
 * killed mid-sync) returns the original result instead of mutating twice.
 *
 * Runs when: connectivity is restored, the app returns to the foreground,
 * every 30 s while active, and on demand (`syncNow`). Attendance and GPS are
 * separate systems — this module never replays GPS fixes.
 *
 * The manager is bound to one signed-in user: `startSyncManager(userId)`
 * only replays that user's items, so a device handed to another crew member
 * never submits the previous user's actions under the new session.
 */

const SYNC_INTERVAL_MS = 30_000;

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Pending + in-flight items for the current user. */
  pendingCount: number;
  /** Items that permanently failed (need Retry / Dismiss). */
  failedCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  isOnline: boolean;
}

type SyncListener = (state: SyncState) => void;

const INITIAL_STATE: SyncState = {
  status: 'idle',
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  lastError: null,
  isOnline: true,
};

let syncState: SyncState = { ...INITIAL_STATE };
let currentUserId: string | null = null;

const listeners = new Set<SyncListener>();
let syncInterval: ReturnType<typeof setInterval> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let isSyncing = false;
/** Set when a sync was requested while one was running; triggers one more pass. */
let syncRequestedDuringRun = false;

function publish(): void {
  for (const listener of listeners) {
    listener({ ...syncState });
  }
}

/** Subscribes to sync state changes (immediately replays the current state). */
export function subscribeSyncState(listener: SyncListener): () => void {
  listeners.add(listener);
  listener({ ...syncState });
  return () => {
    listeners.delete(listener);
  };
}

/** Current sync state snapshot. */
export function getSyncState(): SyncState {
  return { ...syncState };
}

/** The user whose queue this manager replays (null = not started). */
export function getSyncUserId(): string | null {
  return currentUserId;
}

/**
 * Starts the sync manager for the signed-in crew user. Idempotent: calling
 * it again for the same user is a no-op; a different user restarts it.
 */
export function startSyncManager(userId: string): void {
  if (netInfoUnsubscribe && currentUserId === userId) {
    return;
  }
  stopSyncManager();
  currentUserId = userId;
  syncState = { ...INITIAL_STATE };

  netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOnline = syncState.isOnline;
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    syncState = { ...syncState, isOnline: online };
    publish();
    if (!wasOnline && online) {
      void syncNow();
    }
  });

  appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') {
      void syncNow();
    }
  });

  syncInterval = setInterval(() => {
    if (syncState.isOnline && !isSyncing) {
      void syncNow();
    }
  }, SYNC_INTERVAL_MS);

  // Anything left `syncing` by a previous process was interrupted: retry it.
  void recoverInterruptedItems()
    .then(() => refreshCounts())
    .then(() => syncNow());
}

/** Stops the manager (logout). Queued items stay on disk for the same user. */
export function stopSyncManager(): void {
  netInfoUnsubscribe?.();
  netInfoUnsubscribe = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  currentUserId = null;
  syncState = { ...INITIAL_STATE };
  publish();
}

/** Recomputes the pending/failed counters and notifies the UI. */
export async function refreshCounts(): Promise<void> {
  const items = await loadQueue();
  syncState = {
    ...syncState,
    pendingCount: countOpen(items, currentUserId),
    failedCount: countFailed(items, currentUserId),
  };
  publish();
}

/**
 * Replays every due item for the current user. Never throws. Concurrent
 * callers coalesce into the running pass plus at most one follow-up pass.
 */
export async function syncNow(): Promise<void> {
  if (!currentUserId) {
    return;
  }
  if (isSyncing) {
    syncRequestedDuringRun = true;
    return;
  }
  if (!syncState.isOnline) {
    await refreshCounts();
    return;
  }

  isSyncing = true;
  try {
    do {
      syncRequestedDuringRun = false;
      await runOnePass(currentUserId);
    } while (syncRequestedDuringRun && syncState.isOnline && currentUserId);
  } finally {
    isSyncing = false;
  }
}

async function runOnePass(userId: string): Promise<void> {
  const due = selectDueItems(await loadQueue(), userId);
  if (due.length === 0) {
    await refreshCounts();
    if (syncState.status === 'syncing') {
      syncState = { ...syncState, status: 'idle' };
      publish();
    }
    return;
  }

  syncState = { ...syncState, status: 'syncing' };
  publish();

  let lastError: string | null = null;
  let sawRetryable = false;

  for (const item of due) {
    // Logout mid-pass: leave the rest pending for the next session.
    if (currentUserId !== userId) {
      return;
    }
    const outcome = await replayItem(item);
    await markOutcome(item.id, outcome);
    if (outcome.action !== 'success') {
      lastError = outcome.error;
      if (outcome.action === 'retry') {
        sawRetryable = true;
        // Transient failure (most likely still offline): stop the pass now
        // and let backoff / the next connectivity event resume it in order.
        break;
      }
    }
    await refreshCounts();
  }

  await cleanupSuccessful();
  await refreshCounts();
  syncState = {
    ...syncState,
    status: sawRetryable ? 'error' : 'idle',
    lastSyncAt: new Date().toISOString(),
    lastError,
  };
  publish();
}

/** Sends one queued action to the API and classifies the result. */
async function replayItem(item: QueuedAttendanceEvent) {
  await markSyncing(item.id);
  try {
    const options = withIdempotencyKey(item.idempotencyKey);
    const envelope =
      item.kind === 'trip_status'
        ? await apiClient.updateTripStatus(item.tripId, { status: item.tripStatus! }, options)
        : item.eventType === 'board'
          ? await apiClient.boardTripStudent(item.tripId, item.studentId, options)
          : await apiClient.dropTripStudent(item.tripId, item.studentId, options);
    return classifySyncOutcome({
      ok: envelope.success !== false,
      status: envelope.success === false ? 500 : 200,
      message: envelope.error?.message ?? envelope.message ?? null,
    });
  } catch (error) {
    if (error instanceof ApiClientError) {
      return classifySyncOutcome({ ok: false, status: error.status, message: error.message });
    }
    return classifySyncOutcome({
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : 'Network error',
    });
  }
}
