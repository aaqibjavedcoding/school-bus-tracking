import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TripStatus } from '@school-bus-tracking/shared-types';
import {
  addToQueue,
  applySyncOutcome,
  classifySyncOutcome,
  countFailed,
  countOpen,
  describeAction,
  getBackoffDelay,
  isDuplicateOf,
  isDueForRetry,
  isQueuedForUser,
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

const arrive = (stopId = 'stop-1', userId: string | null = USER) =>
  ({ kind: 'stop_mark', userId, tripId: 't1', stopId, stopAction: 'arrive' }) as const;

const skip = (stopId = 'stop-1', skipReason = 'Road closed', userId: string | null = USER) =>
  ({ kind: 'stop_mark', userId, tripId: 't1', stopId, stopAction: 'skip', skipReason }) as const;

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

/**
 * Crew stop marking ("Arrived" / "Skip") — the manual fallback used exactly
 * where coverage is worst, so every one of its queue decisions matters.
 */
describe('stop_mark queueing', () => {
  it('stores the stop, the mark and the crew’s reason', () => {
    const { item, added } = addToQueue([], skip('stop-7', 'Waterlogged lane'));
    assert.equal(added, true);
    assert.equal(item.kind, 'stop_mark');
    assert.equal(item.tripId, 't1');
    assert.equal(item.stopId, 'stop-7');
    assert.equal(item.stopAction, 'skip');
    assert.equal(item.skipReason, 'Waterlogged lane');
    assert.equal(item.status, 'pending');
    assert.ok(item.idempotencyKey.length > 0);
    // Attendance-shaped placeholders stay empty for a stop mark.
    assert.equal(item.studentId, '');
    assert.equal(item.eventType, 'board');
    assert.equal(item.tripStatus, undefined);
  });

  it('carries no reason for an arrival (reason is skip-only)', () => {
    const { item } = addToQueue([], arrive('stop-7'));
    assert.equal(item.stopAction, 'arrive');
    assert.equal(item.skipReason, undefined);
    assert.equal(Object.hasOwn(item, 'skipReason'), false);
  });

  it('dedupes a repeated arrival on the same stop', () => {
    const first = addToQueue([], arrive('stop-1'));
    const again = addToQueue(first.items, arrive('stop-1'));
    assert.equal(again.added, false);
    assert.equal(again.items.length, 1);
    assert.equal(again.item.id, first.item.id);
    assert.equal(again.item.idempotencyKey, first.item.idempotencyKey);
  });

  /**
   * Deliberate product decision, locked here: the reason is NOT part of a
   * skip's identity. Two taps on the same stop are one decision, and the
   * first reason the crew typed is the one that replays — a later tap must
   * never create a second skip, nor silently rewrite the recorded words.
   */
  it('dedupes a repeated skip on the same stop even when the reason differs', () => {
    const first = addToQueue([], skip('stop-1', 'Road closed'));
    const again = addToQueue(first.items, skip('stop-1', 'No students waiting'));
    assert.equal(again.added, false);
    assert.equal(again.items.length, 1);
    assert.equal(again.item.id, first.item.id);
    assert.equal(again.item.skipReason, 'Road closed', 'first reason is the one kept');
    assert.equal(
      isDuplicateOf(first.item, skip('stop-1', 'Something else entirely')),
      true,
    );
  });

  it('treats arrive and skip on the same stop as different actions', () => {
    const a = addToQueue([], arrive('stop-1'));
    const b = addToQueue(a.items, skip('stop-1'));
    assert.equal(b.added, true);
    assert.equal(b.items.length, 2);
    assert.equal(isDuplicateOf(a.item, skip('stop-1')), false);
  });

  it('keeps marks for different stops, trips and users apart', () => {
    const a = addToQueue([], arrive('stop-1'));
    const otherStop = addToQueue(a.items, arrive('stop-2'));
    assert.equal(otherStop.added, true);
    assert.equal(isDuplicateOf(a.item, arrive('stop-2')), false);
    assert.equal(isDuplicateOf(a.item, arrive('stop-1', OTHER)), false);
    assert.equal(
      isDuplicateOf(a.item, { ...arrive('stop-1'), tripId: 't2' }),
      false,
    );
    // A stop mark is never confused with an attendance action on the same trip.
    assert.equal(isDuplicateOf(a.item, board()), false);
  });

  it('allows marking the stop again once the queued mark resolved', () => {
    const a = addToQueue([], arrive('stop-1'));
    const done = a.items.map((item) => applySyncOutcome(item, { action: 'success' }));
    assert.equal(isDuplicateOf(done[0], arrive('stop-1')), false);
    assert.equal(addToQueue(done, arrive('stop-1')).added, true);

    const failed = a.items.map((item) =>
      applySyncOutcome(item, { action: 'fail', error: 'gone', statusCode: 404 }),
    );
    assert.equal(addToQueue(failed, arrive('stop-1')).added, true);
  });

  it('replays, counts and orders stop marks like any other queued action', () => {
    const t0 = new Date('2026-09-11T10:00:00Z');
    const t1 = new Date('2026-09-11T10:00:01Z');
    let items: QueuedAttendanceEvent[] = [];
    items = addToQueue(items, skip('stop-2', 'Diversion'), t1).items;
    items = addToQueue(items, arrive('stop-1'), t0).items;
    items = addToQueue(items, arrive('stop-9', OTHER), t0).items;
    const due = selectDueItems(items, USER, t1);
    assert.deepEqual(
      due.map((item) => item.stopId),
      ['stop-1', 'stop-2'],
    );
    assert.equal(countOpen(items, USER), 2);
    assert.equal(countOpen(items, OTHER), 1);
  });
});

describe('describeAction', () => {
  it('labels a stop arrival and a stop skip differently', () => {
    assert.equal(describeAction(addToQueue([], arrive('stop-1')).item), 'Mark stop arrived');
    assert.equal(describeAction(addToQueue([], skip('stop-1')).item), 'Skip stop');
  });

  it('falls back to the arrival label for a mark with no action recorded', () => {
    const item = { ...addToQueue([], arrive('stop-1')).item, stopAction: undefined };
    assert.equal(describeAction(item), 'Mark stop arrived');
  });

  it('still labels attendance and trip status actions', () => {
    assert.equal(describeAction(addToQueue([], board()).item), 'Board student');
    assert.equal(
      describeAction(addToQueue([], { ...board(), eventType: 'drop' }).item),
      'Drop student',
    );
    assert.equal(
      describeAction(
        addToQueue([], {
          kind: 'trip_status',
          userId: USER,
          tripId: 't1',
          tripStatus: TripStatus.COMPLETED,
        }).item,
      ),
      `Trip → ${TripStatus.COMPLETED}`,
    );
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

  /**
   * `lastError` is rendered by `OfflineSyncBanner`, so it is user-facing copy.
   * It used to be the API client's diagnostic — or, with no message at all,
   * the literal `Request failed (HTTP 500)`.
   */
  it('never stores a technical diagnostic as the crew-facing error', () => {
    const permanent = classifySyncOutcome({
      ok: false,
      status: 400,
      message: 'Request failed with status 400',
    });
    assert.equal(permanent.action, 'fail');
    if (permanent.action === 'fail') {
      assert.doesNotMatch(permanent.error, /request failed|\bhttp\b|\b[1-5]\d{2}\b/i);
      assert.equal(permanent.error, 'Please check the information and try again.');
    }

    const transient = classifySyncOutcome({
      ok: false,
      status: 503,
      message: 'Request failed with status 503',
    });
    assert.equal(transient.action, 'retry');
    if (transient.action === 'retry') {
      assert.equal(transient.error, 'Something went wrong. Please try again later.');
    }

    const offline = classifySyncOutcome({ ok: false, status: 0, message: null });
    assert.equal(offline.action, 'retry');
    if (offline.action === 'retry') {
      assert.match(offline.error, /internet connection/i);
      assert.doesNotMatch(offline.error, /\b[1-5]\d{2}\b/);
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

  describe('cross-user isolation on a shared device', () => {
    it('never replays another account’s queued actions under the new session', () => {
      const t0 = new Date('2026-09-11T10:00:00Z');
      let items: QueuedAttendanceEvent[] = [];
      items = addToQueue(items, board('s1', OTHER), t0).items; // previous crew member
      items = addToQueue(items, board('s2', USER), t0).items; // current user
      const due = selectDueItems(items, USER, t0);
      assert.deepEqual(
        due.map((item) => item.studentId),
        ['s2'],
      );
    });

    it('never attributes legacy (userId: null) items to a signed-in user', () => {
      // Rows persisted before per-user capture existed have userId: null.
      // They must not be replayed, counted, retried or dismissed by whoever
      // signs in next — only by the account that captured them.
      const t0 = new Date('2026-09-11T10:00:00Z');
      let items: QueuedAttendanceEvent[] = [];
      items = addToQueue(items, board('s1', null), t0).items;
      items = addToQueue(items, board('s2', USER), t0).items;

      assert.deepEqual(
        selectDueItems(items, USER, t0)
          .map((item) => item.studentId),
        ['s2'],
      );
      assert.equal(countOpen(items, USER), 1);
      assert.equal(countOpen(items, OTHER), 0);

      const failedLegacy = applySyncOutcome(items[0], {
        action: 'fail',
        error: 'x',
        statusCode: 404,
      });
      const failedMine = applySyncOutcome(items[1], {
        action: 'fail',
        error: 'x',
        statusCode: 404,
      });
      const all = [failedLegacy, failedMine];
      assert.equal(countFailed(all, USER), 1);
      assert.equal(countFailed(all, OTHER), 0);
      // A signed-in user only sees their own legacy-adjacent failures.
      assert.equal(isQueuedForUser(failedLegacy, USER), false);
      assert.equal(isQueuedForUser(failedMine, USER), true);
    });

    it('a null caller (diagnostics) still sees every item', () => {
      const t0 = new Date('2026-09-11T10:00:00Z');
      let items: QueuedAttendanceEvent[] = [];
      items = addToQueue(items, board('s1', null), t0).items;
      items = addToQueue(items, board('s2', USER), t0).items;
      assert.equal(selectDueItems(items, null, t0).length, 2);
      assert.equal(countOpen(items, null), 2);
    });
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

  it('restores a stored stop_mark with its stop, mark and reason intact', () => {
    const stored = {
      id: 'sm-1',
      idempotencyKey: 'key-sm',
      capturedAt: '2026-09-11T10:00:00.000Z',
      userId: USER,
      kind: 'stop_mark',
      tripId: 't1',
      stopId: 'stop-5',
      stopAction: 'skip',
      skipReason: 'Road closed',
      status: 'pending',
      retryCount: 0,
      lastError: null,
      lastStatusCode: null,
      lastSyncAt: null,
    };
    const item = normalizeQueueItem(stored);
    assert.ok(item);
    assert.equal(item.kind, 'stop_mark');
    assert.equal(item.stopId, 'stop-5');
    assert.equal(item.stopAction, 'skip');
    assert.equal(item.skipReason, 'Road closed');
    assert.equal(item.idempotencyKey, 'key-sm');
    assert.equal(item.userId, USER);
    assert.equal(describeAction(item), 'Skip stop');
  });

  it('restores an arrival written without a reason', () => {
    const item = normalizeQueueItem({
      id: 'sm-2',
      kind: 'stop_mark',
      tripId: 't1',
      stopId: 'stop-6',
      stopAction: 'arrive',
      status: 'pending',
    });
    assert.ok(item);
    assert.equal(item.kind, 'stop_mark');
    assert.equal(item.stopAction, 'arrive');
    assert.equal(item.skipReason, undefined);
    assert.equal(Object.hasOwn(item, 'skipReason'), false);
    // Defaults for the fields a stop mark never carries.
    assert.equal(item.studentId, '');
    assert.equal(item.eventType, 'board');
    assert.equal(item.retryCount, 0);
    assert.equal(item.lastError, null);
    assert.ok(item.idempotencyKey.length > 0, 'a missing key is regenerated, never empty');
    assert.equal(describeAction(item), 'Mark stop arrived');
  });

  it('ignores a corrupt stop mark instead of replaying a nonsense action', () => {
    const item = normalizeQueueItem({
      id: 'sm-3',
      kind: 'stop_mark',
      tripId: 't1',
      stopId: 'stop-7',
      stopAction: 'teleport',
      skipReason: 42,
      status: 'pending',
    });
    assert.ok(item);
    assert.equal(item.kind, 'stop_mark');
    assert.equal(item.stopId, 'stop-7');
    assert.equal(Object.hasOwn(item, 'stopAction'), false);
    assert.equal(Object.hasOwn(item, 'skipReason'), false);
    // A row with no trip ID is unreplayable and is dropped entirely.
    assert.equal(normalizeQueueItem({ id: 'sm-4', kind: 'stop_mark', stopId: 'stop-7' }), null);
  });

  it('round-trips a queued stop mark through JSON unchanged', () => {
    const queued = addToQueue([], skip('stop-8', 'Bridge under repair')).item;
    const restored = normalizeQueueItem(JSON.parse(JSON.stringify(queued)));
    assert.deepEqual(restored, queued);
  });

  it('drops a diagnostic written by an older build from a stored item', () => {
    // Such an entry must not resurface in the banner after an app upgrade.
    const stored = { ...addToQueue([], board()).item, status: 'failed' as const };
    assert.equal(normalizeQueueItem({ ...stored, lastError: 'Request failed with status 400' })?.lastError, null);
    const kept = normalizeQueueItem({ ...stored, lastError: 'Invalid transition' });
    assert.ok(kept);
    assert.equal(kept.lastError, 'Invalid transition');
  });

  it('recovers items interrupted mid-sync back to pending', () => {
    const item = { ...addToQueue([], board()).item, status: 'syncing' as const };
    const [recovered] = recoverInterrupted([item]);
    assert.equal(recovered.status, 'pending');
  });
});
