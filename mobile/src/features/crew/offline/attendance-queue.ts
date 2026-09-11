import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripStatus } from '@school-bus-tracking/shared-types';
import {
  addToQueue,
  applySyncOutcome,
  normalizeQueueItem,
  recoverInterrupted,
  type NewQueuedAction,
  type QueuedAttendanceEvent,
  type SyncOutcome,
} from './queue-core.ts';

export {
  getBackoffDelay,
  MAX_QUEUE_SIZE,
  MAX_RETRY_COUNT,
  type AttendanceEventType,
  type QueuedActionKind,
  type QueuedAttendanceEvent,
  type QueueItemStatus,
} from './queue-core.ts';

/**
 * Persistent offline queue for crew actions (attendance board/drop + trip
 * status transitions).
 *
 * Every mutation goes through one serialised read-modify-write so two taps
 * in the same tick cannot lose each other's write. The decisions themselves
 * (dedupe, retry classification, backoff) live in `./queue-core.ts`.
 *
 * The queue is persisted in AsyncStorage so it survives app restarts, and
 * items are only removed after the server confirmed them.
 */

const QUEUE_STORAGE_KEY = '@sbt/offline-attendance-queue';

interface AttendanceQueueState {
  items: QueuedAttendanceEvent[];
}

/** Serialises every read-modify-write on the stored list. */
let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function readRaw(): Promise<QueuedAttendanceEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<AttendanceQueueState>;
    if (!Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items
      .map((item) => normalizeQueueItem(item))
      .filter((item): item is QueuedAttendanceEvent => item !== null);
  } catch {
    return [];
  }
}

async function writeRaw(items: QueuedAttendanceEvent[]): Promise<void> {
  const state: AttendanceQueueState = { items };
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(state));
}

/** Loads the queue from persistent storage. */
export async function loadQueue(): Promise<QueuedAttendanceEvent[]> {
  return withLock(readRaw);
}

async function mutate(
  update: (items: QueuedAttendanceEvent[]) => QueuedAttendanceEvent[],
): Promise<QueuedAttendanceEvent[]> {
  return withLock(async () => {
    const items = await readRaw();
    const next = update(items);
    if (next !== items) {
      await writeRaw(next);
    }
    return next;
  });
}

/** Enqueues a boarding event. */
export async function queueBoard(params: {
  tripId: string;
  studentId: string;
  userId?: string | null;
}): Promise<QueuedAttendanceEvent> {
  return enqueue({
    kind: 'attendance',
    userId: params.userId ?? null,
    tripId: params.tripId,
    studentId: params.studentId,
    eventType: 'board',
  });
}

/** Enqueues a drop event. */
export async function queueDrop(params: {
  tripId: string;
  studentId: string;
  userId?: string | null;
}): Promise<QueuedAttendanceEvent> {
  return enqueue({
    kind: 'attendance',
    userId: params.userId ?? null,
    tripId: params.tripId,
    studentId: params.studentId,
    eventType: 'drop',
  });
}

/** Enqueues a trip lifecycle transition (BOARDING / IN_PROGRESS / COMPLETED). */
export async function queueTripStatus(params: {
  tripId: string;
  status: TripStatus;
  userId?: string | null;
}): Promise<QueuedAttendanceEvent> {
  return enqueue({
    kind: 'trip_status',
    userId: params.userId ?? null,
    tripId: params.tripId,
    tripStatus: params.status,
  });
}

/** Generic enqueue: returns the identical open item instead of duplicating. */
export async function enqueue(action: NewQueuedAction): Promise<QueuedAttendanceEvent> {
  let result: QueuedAttendanceEvent | null = null;
  await mutate((items) => {
    const outcome = addToQueue(items, action);
    result = outcome.item;
    return outcome.items;
  });
  if (!result) {
    throw new Error('Could not queue action');
  }
  return result;
}

/** Marks a queue item as syncing (in flight). */
export async function markSyncing(id: string): Promise<void> {
  await mutate((items) =>
    items.map((item) =>
      item.id === id ? { ...item, status: 'syncing', lastSyncAt: new Date().toISOString() } : item,
    ),
  );
}

/** Applies a replay outcome to one item. */
export async function markOutcome(id: string, outcome: SyncOutcome): Promise<void> {
  await mutate((items) =>
    items.map((item) => (item.id === id ? applySyncOutcome(item, outcome) : item)),
  );
}

/** Marks a queue item as successfully synced. */
export async function markSuccess(id: string): Promise<void> {
  await markOutcome(id, { action: 'success' });
}

/** Marks a queue item as failed for this attempt (retried unless exhausted). */
export async function markFailed(id: string, error: string, statusCode?: number): Promise<void> {
  await markOutcome(id, { action: 'retry', error, statusCode: statusCode ?? null });
}

/** Puts a permanently failed item back into the retry pool (user "Retry"). */
export async function retryFailed(userId: string | null): Promise<number> {
  let reset = 0;
  await mutate((items) =>
    items.map((item) => {
      if (item.status === 'failed' && (userId === null || item.userId === null || item.userId === userId)) {
        reset += 1;
        return { ...item, status: 'pending', retryCount: 0, lastError: null };
      }
      return item;
    }),
  );
  return reset;
}

/** Discards permanently failed items (user "Dismiss"). */
export async function discardFailed(userId: string | null): Promise<number> {
  let removed = 0;
  await mutate((items) => {
    const kept = items.filter((item) => {
      const mine = userId === null || item.userId === null || item.userId === userId;
      const drop = item.status === 'failed' && mine;
      if (drop) removed += 1;
      return !drop;
    });
    return kept.length === items.length ? items : kept;
  });
  return removed;
}

/** Restores `syncing` rows left over by an app kill so they are retried. */
export async function recoverInterruptedItems(): Promise<void> {
  await mutate((items) => {
    const next = recoverInterrupted(items);
    return next.some((item, index) => item !== items[index]) ? next : items;
  });
}

/** Removes successfully synced items from the queue. */
export async function cleanupSuccessful(): Promise<number> {
  let removed = 0;
  await mutate((items) => {
    const remaining = items.filter((item) => item.status !== 'success');
    removed = items.length - remaining.length;
    return removed > 0 ? remaining : items;
  });
  return removed;
}

/** Count of pending/syncing items. */
export async function getPendingCount(): Promise<number> {
  const items = await loadQueue();
  return items.filter((item) => item.status === 'pending' || item.status === 'syncing').length;
}

/** All pending items sorted by capture time (oldest first). */
export async function getPendingItems(): Promise<QueuedAttendanceEvent[]> {
  const items = await loadQueue();
  return items
    .filter((item) => item.status === 'pending')
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** Clears the entire queue (tests / manual reset). */
export async function clearQueue(): Promise<void> {
  await withLock(() => AsyncStorage.removeItem(QUEUE_STORAGE_KEY));
}
