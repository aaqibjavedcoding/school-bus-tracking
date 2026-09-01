import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline attendance queue for boarding/drop operations.
 *
 * When the driver/conductor loses internet, boarding/drop operations are
 * queued locally and synced when the network returns. Each queued operation
 * has:
 * - local event ID
 * - idempotency key
 * - captured timestamp
 * - student ID
 * - trip ID
 * - event type (board/drop)
 * - pending/syncing/success/failed state
 *
 * The queue is persisted in AsyncStorage so it survives app restarts.
 */

const QUEUE_STORAGE_KEY = '@sbt/offline-attendance-queue';

/** States of a queued attendance operation. */
export type QueueItemStatus = 'pending' | 'syncing' | 'success' | 'failed';

/** Types of attendance operations. */
export type AttendanceEventType = 'board' | 'drop';

/** A single queued attendance operation. */
export interface QueuedAttendanceEvent {
  /** Local event ID (UUID). */
  id: string;
  /** Idempotency key for deduplication with the server. */
  idempotencyKey: string;
  /** When the event was captured locally. */
  capturedAt: string;
  /** Student ID. */
  studentId: string;
  /** Trip ID. */
  tripId: string;
  /** Event type. */
  eventType: AttendanceEventType;
  /** Current sync status. */
  status: QueueItemStatus;
  /** Number of sync attempts. */
  retryCount: number;
  /** Last error message, if failed. */
  lastError: string | null;
  /** Server response status code, if attempted. */
  lastStatusCode: number | null;
  /** When the event was last synced/attempted. */
  lastSyncAt: string | null;
}

/** The full queue state. */
export interface AttendanceQueueState {
  items: QueuedAttendanceEvent[];
}

const MAX_RETRY_COUNT = 10;
const MAX_QUEUE_SIZE = 500;

/**
 * Generates a simple UUID v4-like identifier.
 * Uses Math.random for React Native compatibility.
 */
function generateId(): string {
  const hex = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      result += '-';
    } else if (i === 14) {
      result += '4';
    } else if (i === 19) {
      result += hex[(Math.random() * 4) | 8];
    } else {
      result += hex[(Math.random() * 16) | 0];
    }
  }
  return result;
}

/**
 * Loads the attendance queue from persistent storage.
 */
export async function loadQueue(): Promise<QueuedAttendanceEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as AttendanceQueueState;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/**
 * Saves the attendance queue to persistent storage.
 */
async function saveQueue(items: QueuedAttendanceEvent[]): Promise<void> {
  const state: AttendanceQueueState = { items };
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Adds a boarding event to the queue.
 */
export async function queueBoard(params: {
  tripId: string;
  studentId: string;
}): Promise<QueuedAttendanceEvent> {
  return enqueue({
    tripId: params.tripId,
    studentId: params.studentId,
    eventType: 'board',
  });
}

/**
 * Adds a drop event to the queue.
 */
export async function queueDrop(params: {
  tripId: string;
  studentId: string;
}): Promise<QueuedAttendanceEvent> {
  return enqueue({
    tripId: params.tripId,
    studentId: params.studentId,
    eventType: 'drop',
  });
}

/**
 * Internal enqueue helper.
 */
async function enqueue(params: {
  tripId: string;
  studentId: string;
  eventType: AttendanceEventType;
}): Promise<QueuedAttendanceEvent> {
  const items = await loadQueue();

  // Prevent unbounded queue growth.
  if (items.length >= MAX_QUEUE_SIZE) {
    throw new Error(`Attendance queue is full (${MAX_QUEUE_SIZE} items)`);
  }

  // Check for duplicate: same student, same trip, same event type, pending.
  const existing = items.find(
    (item) =>
      item.studentId === params.studentId &&
      item.tripId === params.tripId &&
      item.eventType === params.eventType &&
      (item.status === 'pending' || item.status === 'syncing'),
  );
  if (existing) {
    return existing;
  }

  const event: QueuedAttendanceEvent = {
    id: generateId(),
    idempotencyKey: generateId(),
    capturedAt: new Date().toISOString(),
    studentId: params.studentId,
    tripId: params.tripId,
    eventType: params.eventType,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    lastStatusCode: null,
    lastSyncAt: null,
  };

  items.push(event);
  await saveQueue(items);
  return event;
}

/**
 * Marks a queue item as syncing.
 */
export async function markSyncing(id: string): Promise<void> {
  const items = await loadQueue();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.status = 'syncing';
    item.lastSyncAt = new Date().toISOString();
    await saveQueue(items);
  }
}

/**
 * Marks a queue item as successfully synced.
 */
export async function markSuccess(id: string): Promise<void> {
  const items = await loadQueue();
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) {
    items[idx].status = 'success';
    items[idx].lastSyncAt = new Date().toISOString();
    await saveQueue(items);
  }
}

/**
 * Marks a queue item as failed.
 */
export async function markFailed(
  id: string,
  error: string,
  statusCode?: number,
): Promise<void> {
  const items = await loadQueue();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.retryCount += 1;
    item.lastError = error;
    item.lastStatusCode = statusCode ?? null;
    item.lastSyncAt = new Date().toISOString();

    if (item.retryCount >= MAX_RETRY_COUNT) {
      item.status = 'failed';
    } else {
      item.status = 'pending'; // Will be retried.
    }
    await saveQueue(items);
  }
}

/**
 * Removes successfully synced items from the queue.
 */
export async function cleanupSuccessful(): Promise<number> {
  const items = await loadQueue();
  const remaining = items.filter((i) => i.status !== 'success');
  const removed = items.length - remaining.length;
  if (removed > 0) {
    await saveQueue(remaining);
  }
  return removed;
}

/**
 * Gets the count of pending items.
 */
export async function getPendingCount(): Promise<number> {
  const items = await loadQueue();
  return items.filter((i) => i.status === 'pending' || i.status === 'syncing').length;
}

/**
 * Gets all pending items sorted by capture time (oldest first).
 */
export async function getPendingItems(): Promise<QueuedAttendanceEvent[]> {
  const items = await loadQueue();
  return items
    .filter((i) => i.status === 'pending')
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/**
 * Clears the entire queue (for testing or manual reset).
 */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
}

/**
 * Calculates exponential backoff delay for a retry attempt.
 * Base: 1 second, max: 5 minutes.
 */
export function getBackoffDelay(retryCount: number): number {
  const base = 1000;
  const max = 5 * 60 * 1000;
  const delay = Math.min(base * Math.pow(2, retryCount), max);
  // Add jitter (±20%).
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}
