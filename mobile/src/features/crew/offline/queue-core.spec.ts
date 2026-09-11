import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TripStatus } from '@school-bus-tracking/shared-types';
import {
  addToQueue,
  applySyncOutcome,
  classifySyncOutcome,
  countFailed,
  countOpen,
  getBackoffDelay,
  isDueForRetry,
  MAX_RETRY_COUNT,
  normalizeQueueItem,
  recoverInterrupted,
  selectDueItems,
  type QueuedAttendanceEvent,
} from './queue-core.ts';

/**
 * Offline queue decisions: dedupe, idempotency-key stability across replays,
 * retry classification (never lose an action on a transient error, never
 * replay a permanent rejection), user isolation and ordering.
 */

const USER = 'user-1';
const OTHER = 'user-2';

const board = (studentId = 's1', userId: string | null = USER) =>
  ({ kind: 'attendance', userId, tripId: 't1', studentId, eventType: 'board' }) as const;

describe('addToQueue', () => {
  it('assigns one idempotency key per logical action and reuses the open item', () => {
    const first = addToQueue([], board());
    assert.equal(first.added, true);
    assert.equal(first.item.status, 'pending');
    assert.ok(first.item.idempotencyKey.length > 0);

    const again = addToQueue(first.items, board());
    assert.equal(again.added, false);
    assert.equal(again.item.id, first.item.id);
    assert.equal(again.item.idempotencyKey, first.item.idempotencyKey);
    assert.equal(again.items.length, 1);
  });

  it('treats board and drop of the same student as different actions', () => {
    const a = addToQueue([], board());
    const b = addToQueue(a.items, { ...board(), eventType: 'drop' });
    assert.equal(b.added, true);
    assert.equal(b.items.length, 2);
  });

  it('does not dedupe across users on a shared device', () => {
    const a = addToQueue([], board('s1', USER));
    const b = addToQueue(a.items, board('s1', OTHER));
    assert.equal(b.added, true);
  });

  it('queues trip status transitions once per target status', () => {
    const a = addToQueue([], {
      kind: 'trip_status',
      userId: USER,
      tripId: 't1',
      tripStatus: TripStatus.IN_PROGRESS,
    });
    const b = addToQueue(a.items, {
      kind: 'trip_status',
      userId: USER,
      tripId: 't1',
      tripStatus: TripStatus.IN_PROGRESS,
    });
    assert.equal(b.added, false);
    assert.equal(a.item.tripStatus, TripStatus.IN_PROGRESS);
    assert.equal(a.item.studentId, '');
  });

  it('allows a new action once the previous one succeeded', () => {
    const a = addToQueue([], board());
    const done = a.items.map((item) => applySyncOutcome(item, { action: 'success' }));
    const b = addToQueue(done, board());
    assert.equal(b.added, true);
  });
});

describe('classifySyncOutcome', () => {
  it('success and 409 (already applied) both resolve the item', () => {
    assert.deepEqual(classifySyncOutcome({ ok: true, status: 200 }), { action: 'success' });
    assert.deepEqual(classifySyncOutcome({ ok: false, status: 409, message: 'Already boarded' }), {
      action: 'success',
    });
  });

  it('network / 5xx / 429 / 401 keep the item for retry', () => {
    for (const status of [0, 500, 502, 503, 429, 401, 403, null]) {
      const outcome = classifySyncOutcome({ ok: false, status, message: 'x' });
      assert.equal(outcome.action, 'retry', `status ${status}`);
    }
  });

  it('400 / 404 are permanent failures the user must see', () => {
    for (const status of [400, 404, 410, 422]) {
      const outcome = classifySyncOutcome({ ok: false, status, message: 'Invalid transition' });
      assert.equal(outcome.action, 'fail', `status ${status}`);
      if (outcome.action === 'fail') {
        assert.equal(outcome.error, 'Invalid transition');
      }
    }
  });
});

describe('applySyncOutcome', () => {
  const item = addToQueue([], board()).item;

  it('a retry keeps status pending and preserves the idempotency key', () => {
    const next = applySyncOutcome(item, { action: 'retry', error: 'offline', statusCode: 0 });
    assert.equal(next.status, 'pending');
    assert.equal(next.retryCount, 1);
    assert.equal(next.lastError, 'offline');
    assert.equal(next.idempotencyKey, item.idempotencyKey);
  });

  it('a permanent failure marks the item failed immediately', () => {
    const next = applySyncOutcome(item, { action: 'fail', error: 'gone', statusCode: 404 });
    assert.equal(next.status, 'failed');
  });

  it('exhausting the retry budget marks the item failed', () => {
    let current = item;
    for (let i = 0; i < MAX_RETRY_COUNT; i += 1) {
      current = applySyncOutcome(current, { action: 'retry', error: 'x', statusCode: 500 });
    }
    assert.equal(current.status, 'failed');
    assert.equal(current.retryCount, MAX_RETRY_COUNT);
  });
});

describe('backoff and due selection', () => {
  it('backoff doubles and is capped at five minutes', () => {
    const fixed = () => 0.5;
    assert.equal(getBackoffDelay(0, fixed), 1000);
    assert.equal(getBackoffDelay(1, fixed), 2000);
    assert.equal(getBackoffDelay(3, fixed), 8000);
    assert.equal(getBackoffDelay(20, fixed), 5 * 60 * 1000);
  });

  it('a fresh item is due; a just-failed item waits for its window', () => {
    const now = new Date('2026-09-11T10:00:00Z');
    const fresh = addToQueue([], board(), now).item;
    assert.equal(isDueForRetry(fresh, now), true);
    const failed = applySyncOutcome(
      fresh,
      { action: 'retry', error: 'x', statusCode: 0 },
      now,
    );
    assert.equal(isDueForRetry(failed, new Date(now.getTime() + 500)), false);
    assert.equal(isDueForRetry(failed, new Date(now.getTime() + 2500)), true);
  });

  it('selects only the current user’s pending items, oldest first', () => {
    const t0 = new Date('2026-09-11T10:00:00Z');
    const t1 = new Date('2026-09-11T10:00:01Z');
    let items: QueuedAttendanceEvent[] = [];
    items = addToQueue(items, board('s2', USER), t1).items;
    items = addToQueue(items, board('s1', USER), t0).items;
    items = addToQueue(items, board('s9', OTHER), t0).items;
    const due = selectDueItems(items, USER, t1);
    assert.deepEqual(
      due.map((item) => item.studentId),
      ['s1', 's2'],
    );
    assert.equal(countOpen(items, USER), 2);
    assert.equal(countOpen(items, OTHER), 1);
  });

  it('counts failed items per user', () => {
    const items = [
      applySyncOutcome(addToQueue([], board('s1', USER)).item, {
        action: 'fail',
        error: 'x',
        statusCode: 404,
      }),
    ];
    assert.equal(countFailed(items, USER), 1);
    assert.equal(countFailed(items, OTHER), 0);
  });
});

describe('persistence compatibility', () => {
  it('normalises rows written before kind/userId existed', () => {
    const legacy = {
      id: 'abc',
      idempotencyKey: 'key',
      capturedAt: '2026-01-01T00:00:00.000Z',
      studentId: 's1',
      tripId: 't1',
      eventType: 'drop',
      status: 'pending',
      retryCount: 2,
      lastError: null,
      lastStatusCode: null,
      lastSyncAt: null,
    };
    const item = normalizeQueueItem(legacy);
    assert.ok(item);
    assert.equal(item.kind, 'attendance');
    assert.equal(item.userId, null);
    assert.equal(item.eventType, 'drop');
    assert.equal(item.idempotencyKey, 'key');
    assert.equal(normalizeQueueItem({ nope: true }), null);
  });

  it('recovers items interrupted mid-sync back to pending', () => {
    const item = { ...addToQueue([], board()).item, status: 'syncing' as const };
    const [recovered] = recoverInterrupted([item]);
    assert.equal(recovered.status, 'pending');
  });
});
