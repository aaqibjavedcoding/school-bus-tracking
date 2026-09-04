import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import {
  loadQueue,
  markSyncing,
  markSuccess,
  markFailed,
  getPendingItems,
  cleanupSuccessful,
  getBackoffDelay,
  type QueuedAttendanceEvent,
} from './attendance-queue';
import { apiClient } from '../../../services/api';

/**
 * Offline attendance sync manager.
 *
 * Monitors network connectivity and syncs queued attendance events when
 * the network is available. Uses exponential backoff for retries and
 * handles 409 conflicts (already boarded/dropped) as success.
 *
 * The sync runs:
 * - When network connectivity is restored
 * - When the app comes to foreground
 * - Periodically while the app is active
 *
 * Important: Attendance and GPS are different systems. This module only
 * syncs attendance events, never replays GPS data.
 */

const SYNC_INTERVAL_MS = 30_000; // 30 seconds
const MAX_CONCURRENT_SYNCS = 3;

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  isOnline: boolean;
}

type SyncListener = (state: SyncState) => void;

let syncState: SyncState = {
  status: 'idle',
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
  isOnline: true,
};

const listeners = new Set<SyncListener>();
let syncInterval: ReturnType<typeof setInterval> | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let isSyncing = false;

function publish(): void {
  for (const listener of listeners) {
    listener({ ...syncState });
  }
}

/**
 * Subscribes to sync state changes.
 */
export function subscribeSyncState(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Gets the current sync state.
 */
export function getSyncState(): SyncState {
  return { ...syncState };
}

/**
 * Starts the offline attendance sync manager.
 */
export function startSyncManager(): void {
  // Monitor network connectivity.
  netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOnline = syncState.isOnline;
    syncState = { ...syncState, isOnline: state.isConnected ?? false };
    publish();

    // If we just came online, trigger a sync.
    if (!wasOnline && syncState.isOnline) {
      syncNow().catch(() => {
        // Errors are handled inside syncNow.
      });
    }
  });

  // Monitor app state (foreground/background).
  appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') {
      // App came to foreground — sync immediately.
      syncNow().catch(() => {});
    }
  });

  // Periodic sync while app is active.
  syncInterval = setInterval(() => {
    if (syncState.isOnline && !isSyncing) {
      syncNow().catch(() => {});
    }
  }, SYNC_INTERVAL_MS);

  // Initial sync.
  updatePendingCount().catch(() => {});
}

/**
 * Stops the offline attendance sync manager.
 */
export function stopSyncManager(): void {
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
    netInfoUnsubscribe = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Triggers an immediate sync of all pending attendance events.
 */
export async function syncNow(): Promise<void> {
  if (isSyncing) {
    return;
  }
  if (!syncState.isOnline) {
    return;
  }

  isSyncing = true;
  syncState = { ...syncState, status: 'syncing' };
  publish();

  try {
    const pending = await getPendingItems();
    if (pending.length === 0) {
      syncState = {
        ...syncState,
        status: 'idle',
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      };
      publish();
      return;
    }

    // Process items with limited concurrency.
    const chunks = chunkArray(pending, MAX_CONCURRENT_SYNCS);
    for (const chunk of chunks) {
      await Promise.all(chunk.map((item) => syncItem(item)));
    }

    // Clean up successful items.
    await cleanupSuccessful();
    await updatePendingCount();

    syncState = {
      ...syncState,
      status: 'idle',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
    publish();
  } catch (error) {
    syncState = {
      ...syncState,
      status: 'error',
      lastError: error instanceof Error ? error.message : 'Unknown sync error',
    };
    publish();
  } finally {
    isSyncing = false;
  }
}

/**
 * Syncs a single attendance event to the server.
 */
async function syncItem(item: QueuedAttendanceEvent): Promise<void> {
  // Check if enough time has passed since the last attempt (backoff).
  if (item.lastSyncAt && item.retryCount > 0) {
    const elapsed = Date.now() - new Date(item.lastSyncAt).getTime();
    const required = getBackoffDelay(item.retryCount);
    if (elapsed < required) {
      return; // Not time to retry yet.
    }
  }

  await markSyncing(item.id);

  try {
    const endpoint =
      item.eventType === 'board'
        ? `/trips/${item.tripId}/students/${item.studentId}/board`
        : `/trips/${item.tripId}/students/${item.studentId}/drop`;

    const response = await apiClient.post(endpoint, undefined, {
      headers: {
        'x-idempotency-key': item.idempotencyKey,
      },
    });

    if (response.success) {
      await markSuccess(item.id);
    } else if (response.error?.code === 'CONFLICT') {
      // Conflict: already boarded/dropped. Treat as success.
      await markSuccess(item.id);
    } else if (response.error?.code === 'NOT_FOUND') {
      // Trip or student not found (cancelled trip, etc.). Mark as failed permanently.
      await markFailed(
        item.id,
        response.error.message ?? 'Resource not found',
        404,
      );
    } else if (response.error?.code === 'TOO_MANY_REQUESTS') {
      // Rate limited. Will retry with backoff.
      await markFailed(item.id, 'Rate limited', 429);
    } else {
      await markFailed(
        item.id,
        response.error?.message ?? 'Server error',
        500,
      );
    }
  } catch (error) {
    // Network error. Will retry with backoff.
    await markFailed(
      item.id,
      error instanceof Error ? error.message : 'Network error',
    );
  }
}

/**
 * Updates the pending count in the sync state.
 */
async function updatePendingCount(): Promise<void> {
  const count = (await loadQueue()).filter(
    (i) => i.status === 'pending' || i.status === 'syncing',
  ).length;
  syncState = { ...syncState, pendingCount: count };
  publish();
}

/**
 * Splits an array into chunks of the given size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
