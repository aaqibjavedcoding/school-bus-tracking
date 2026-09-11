import type { TripStatus } from '@school-bus-tracking/shared-types';
import { generateIdempotencyKey } from '../../../lib/idempotency.ts';

/**
 * Pure offline-queue logic (no native imports — unit-testable in plain Node).
 *
 * The queue holds the crew actions that must never be lost when the bus is
 * out of coverage: attendance (board / drop) and trip lifecycle transitions.
 * Every item carries **one** idempotency key generated when it is captured
 * and reused on every replay, so the API's `x-idempotency-key` deduplication
 * guarantees a retried sync can never create a second server mutation.
 *
 * `attendance-queue.ts` persists this state in AsyncStorage and
 * `attendance-sync.ts` drives the replay; both delegate every decision to
 * the functions here.
 */

/** States of a queued action. */
export type QueueItemStatus = 'pending' | 'syncing' | 'success' | 'failed';

/** Attendance actions. */
export type AttendanceEventType = 'board' | 'drop';

/** What a queued item does on the server. */
export type QueuedActionKind = 'attendance' | 'trip_status';

/** A single queued crew action. */
export interface QueuedAttendanceEvent {
  /** Local event ID (UUID). */
  id: string;
  /** Idempotency key sent as `x-idempotency-key` on every replay. */
  idempotencyKey: string;
  /** When the action was captured locally. */
  capturedAt: string;
  /**
   * The signed-in user who captured the action. A queued action is only ever
   * replayed under the same account — never by whoever signs in next on the
   * device.
   */
  userId: string | null;
  /** `attendance` (default for rows persisted before `kind` existed). */
  kind: QueuedActionKind;
  /** Trip ID (all kinds). */
  tripId: string;
  /** Student ID (attendance only; empty string for trip_status). */
  studentId: string;
  /** Attendance event type (attendance only; `board` placeholder otherwise). */
  eventType: AttendanceEventType;
  /** Target trip status (trip_status only). */
  tripStatus?: TripStatus;
  /** Current sync status. */
  status: QueueItemStatus;
  /** Number of sync attempts. */
  retryCount: number;
  /** Last error message, if failed. */
  lastError: string | null;
  /** HTTP status of the last attempt, if any. */
  lastStatusCode: number | null;
  /** When the item was last attempted. */
  lastSyncAt: string | null;
}

export const MAX_RETRY_COUNT = 10;
export const MAX_QUEUE_SIZE = 500;

/** Input of {@link addToQueue}. */
export type NewQueuedAction =
  | {
      kind: 'attendance';
      userId: string | null;
      tripId: string;
      studentId: string;
      eventType: AttendanceEventType;
    }
  | {
      kind: 'trip_status';
      userId: string | null;
      tripId: string;
      tripStatus: TripStatus;
    };

/** Restores rows written by older app versions (no `kind` / `userId`). */
export function normalizeQueueItem(raw: unknown): QueuedAttendanceEvent | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const item = raw as Partial<QueuedAttendanceEvent>;
  if (typeof item.id !== 'string' || typeof item.tripId !== 'string') {
    return null;
  }
  return {
    id: item.id,
    idempotencyKey:
      typeof item.idempotencyKey === 'string' && item.idempotencyKey
        ? item.idempotencyKey
        : generateIdempotencyKey(),
    capturedAt: typeof item.capturedAt === 'string' ? item.capturedAt : new Date(0).toISOString(),
    userId: typeof item.userId === 'string' ? item.userId : null,
    kind: item.kind === 'trip_status' ? 'trip_status' : 'attendance',
    tripId: item.tripId,
    studentId: typeof item.studentId === 'string' ? item.studentId : '',
    eventType: item.eventType === 'drop' ? 'drop' : 'board',
    ...(item.tripStatus ? { tripStatus: item.tripStatus } : {}),
    status:
      item.status === 'failed' || item.status === 'success' ? item.status : 'pending',
    retryCount: typeof item.retryCount === 'number' ? item.retryCount : 0,
    lastError: typeof item.lastError === 'string' ? item.lastError : null,
    lastStatusCode: typeof item.lastStatusCode === 'number' ? item.lastStatusCode : null,
    lastSyncAt: typeof item.lastSyncAt === 'string' ? item.lastSyncAt : null,
  };
}

/** True when `candidate` is the same logical action as `item` and still open. */
export function isDuplicateOf(item: QueuedAttendanceEvent, candidate: NewQueuedAction): boolean {
  if (item.status !== 'pending' && item.status !== 'syncing') {
    return false;
  }
  if (item.kind !== candidate.kind || item.tripId !== candidate.tripId) {
    return false;
  }
  if (item.userId !== candidate.userId) {
    return false;
  }
  if (candidate.kind === 'attendance') {
    return item.studentId === candidate.studentId && item.eventType === candidate.eventType;
  }
  return item.tripStatus === candidate.tripStatus;
}

/**
 * Appends a new action (or returns the identical open one). Never mutates
 * `items`; the caller persists the returned list.
 */
export function addToQueue(
  items: QueuedAttendanceEvent[],
  action: NewQueuedAction,
  now: Date = new Date(),
): { items: QueuedAttendanceEvent[]; item: QueuedAttendanceEvent; added: boolean } {
  const existing = items.find((item) => isDuplicateOf(item, action));
  if (existing) {
    return { items, item: existing, added: false };
  }
  if (items.length >= MAX_QUEUE_SIZE) {
    throw new Error(`Offline queue is full (${MAX_QUEUE_SIZE} items)`);
  }
  const item: QueuedAttendanceEvent = {
    id: generateIdempotencyKey(),
    idempotencyKey: generateIdempotencyKey(),
    capturedAt: now.toISOString(),
    userId: action.userId,
    kind: action.kind,
    tripId: action.tripId,
    studentId: action.kind === 'attendance' ? action.studentId : '',
    eventType: action.kind === 'attendance' ? action.eventType : 'board',
    ...(action.kind === 'trip_status' ? { tripStatus: action.tripStatus } : {}),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    lastStatusCode: null,
    lastSyncAt: null,
  };
  return { items: [...items, item], item, added: true };
}

/** What the sync loop should do with the result of one replay attempt. */
export type SyncOutcome =
  /** Server applied it (or had already applied it): drop from the queue. */
  | { action: 'success' }
  /** Transient (network / 5xx / 429 / auth refresh): keep and retry later. */
  | { action: 'retry'; error: string; statusCode: number | null }
  /** Permanent (gone / invalid now): stop retrying, surface to the user. */
  | { action: 'fail'; error: string; statusCode: number | null };

/**
 * Classifies one replay attempt.
 *
 * - `ok` → success.
 * - 409 → the server already holds this state (student already boarded /
 *   dropped, trip already in that status) → success: the local action is
 *   satisfied and replaying would only ever produce the same 409.
 * - 400 → the transition is no longer valid (e.g. an admin cancelled the
 *   trip while offline) → permanent failure, shown to the crew.
 * - 404 → trip / student gone from the caller's scope → permanent failure.
 * - 401 / 403 → the session is being refreshed or the role changed → retry
 *   (never dropped: the action is preserved until confirmed).
 * - 0 (network), 429, 5xx, anything else → retry with backoff.
 */
export function classifySyncOutcome(result: {
  ok: boolean;
  status: number | null;
  message?: string | null;
}): SyncOutcome {
  if (result.ok) {
    return { action: 'success' };
  }
  const status = result.status ?? 0;
  const error = result.message?.trim() || `Request failed (HTTP ${status || 'network'})`;
  if (status === 409) {
    return { action: 'success' };
  }
  if (status === 400 || status === 404 || status === 410 || status === 422) {
    return { action: 'fail', error, statusCode: status };
  }
  return { action: 'retry', error, statusCode: status || null };
}

/** Applies a {@link SyncOutcome} to one item (pure). */
export function applySyncOutcome(
  item: QueuedAttendanceEvent,
  outcome: SyncOutcome,
  now: Date = new Date(),
): QueuedAttendanceEvent {
  const lastSyncAt = now.toISOString();
  if (outcome.action === 'success') {
    return { ...item, status: 'success', lastError: null, lastSyncAt };
  }
  const retryCount = item.retryCount + 1;
  const exhausted = retryCount >= MAX_RETRY_COUNT;
  return {
    ...item,
    retryCount,
    lastError: outcome.error,
    lastStatusCode: outcome.statusCode,
    lastSyncAt,
    status: outcome.action === 'fail' || exhausted ? 'failed' : 'pending',
  };
}

/**
 * Exponential backoff for a retry attempt. Base 1 s, cap 5 min, ±20 % jitter
 * (`random` injectable for deterministic tests).
 */
export function getBackoffDelay(retryCount: number, random: () => number = Math.random): number {
  const base = 1000;
  const max = 5 * 60 * 1000;
  const delay = Math.min(base * Math.pow(2, retryCount), max);
  const jitter = delay * 0.2 * (random() * 2 - 1);
  return Math.round(delay + jitter);
}

/** True when the item's backoff window has elapsed (or it never failed). */
export function isDueForRetry(item: QueuedAttendanceEvent, now: Date = new Date()): boolean {
  if (!item.lastSyncAt || item.retryCount === 0) {
    return true;
  }
  const elapsed = now.getTime() - new Date(item.lastSyncAt).getTime();
  // Use the deterministic (jitter-free) midpoint so "due" is monotonic.
  return elapsed >= getBackoffDelay(item.retryCount, () => 0.5);
}

/**
 * The items to replay now, oldest first, for one user. Trip lifecycle and
 * attendance are order-sensitive (board before drop, BOARDING before
 * IN_PROGRESS), so callers replay this list sequentially.
 */
export function selectDueItems(
  items: QueuedAttendanceEvent[],
  userId: string | null,
  now: Date = new Date(),
): QueuedAttendanceEvent[] {
  return items
    .filter((item) => item.status === 'pending')
    .filter((item) => userId === null || item.userId === null || item.userId === userId)
    .filter((item) => isDueForRetry(item, now))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** Pending + syncing count for one user (what the UI shows as "N pending"). */
export function countOpen(items: QueuedAttendanceEvent[], userId: string | null): number {
  return items.filter(
    (item) =>
      (item.status === 'pending' || item.status === 'syncing') &&
      (userId === null || item.userId === null || item.userId === userId),
  ).length;
}

/** Permanently failed count for one user. */
export function countFailed(items: QueuedAttendanceEvent[], userId: string | null): number {
  return items.filter(
    (item) =>
      item.status === 'failed' &&
      (userId === null || item.userId === null || item.userId === userId),
  ).length;
}

/** Endpoint-agnostic description used for user-facing labels. */
export function describeAction(item: QueuedAttendanceEvent): string {
  if (item.kind === 'trip_status') {
    return `Trip → ${item.tripStatus ?? 'status'}`;
  }
  return item.eventType === 'board' ? 'Board student' : 'Drop student';
}

/** Restores a `syncing` item interrupted by an app kill back to `pending`. */
export function recoverInterrupted(items: QueuedAttendanceEvent[]): QueuedAttendanceEvent[] {
  return items.map((item) => (item.status === 'syncing' ? { ...item, status: 'pending' } : item));
}
