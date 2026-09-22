import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import {
  DATA_UPDATED_DEBOUNCE_MS,
  __resetDataUpdatedListenersForTests,
  createDebouncedReload,
  notifyDataUpdated,
  subscribeDataUpdated,
} from './data-updated.ts';

/**
 * The "my own write is visible everywhere" contract.
 *
 * A list screen used to refresh only the list it owned, which left every other
 * surface showing rows from before the save. The bus is the fix: one event per
 * successful mutation, and the reload is coalesced so a multi-step write (create
 * a parent, then link the guardian) costs one refetch instead of two.
 */

const fakeTimers = () => {
  const queue: Array<{ at: number; callback: () => void; id: number }> = [];
  let nextId = 1;
  let now = 0;
  return {
    schedule: (callback: () => void, ms: number) => {
      const handle = { id: nextId++, at: now + ms };
      queue.push({ ...handle, callback });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle: ReturnType<typeof setTimeout>) => {
      const { id } = handle as unknown as { id: number };
      const at = queue.findIndex((entry) => entry.id === id);
      if (at !== -1) queue.splice(at, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const due of queue.filter((entry) => entry.at <= now)) {
        queue.splice(queue.indexOf(due), 1);
        due.callback();
      }
    },
    pending: () => queue.length,
  };
};

afterEach(() => {
  __resetDataUpdatedListenersForTests();
});

describe('the data-updated bus', () => {
  it('reaches every subscriber, and only while subscribed', () => {
    const seen: string[] = [];
    const off = subscribeDataUpdated(() => seen.push('a'));
    const offOther = subscribeDataUpdated(() => seen.push('b'));
    notifyDataUpdated();
    assert.deepEqual(seen, ['a', 'b']);
    off();
    notifyDataUpdated();
    // Only the still-mounted screen is asked again.
    assert.deepEqual(seen, ['a', 'b', 'b']);
    offOther();
    notifyDataUpdated();
    assert.deepEqual(seen, ['a', 'b', 'b']);
  });

  it('survives a listener that unsubscribes while the event is being delivered', () => {
    const seen: string[] = [];
    const offFirst = subscribeDataUpdated(() => {
      seen.push('first');
      offFirst();
    });
    subscribeDataUpdated(() => seen.push('second'));
    assert.doesNotThrow(() => notifyDataUpdated());
    assert.deepEqual(seen, ['first', 'second']);
  });

  it('does nothing when no list is mounted', () => {
    assert.doesNotThrow(() => notifyDataUpdated());
  });
});

describe('createDebouncedReload', () => {
  it('coalesces a burst of invalidations into one reload', () => {
    const timers = fakeTimers();
    let reloads = 0;
    const { request } = createDebouncedReload(
      () => {
        reloads += 1;
      },
      DATA_UPDATED_DEBOUNCE_MS,
      timers.schedule,
      timers.cancel,
    );
    request();
    request();
    request();
    assert.equal(reloads, 0, 'nothing reloads synchronously');
    timers.advance(DATA_UPDATED_DEBOUNCE_MS);
    assert.equal(reloads, 1);
  });

  it('reloads again for a later, separate write', () => {
    const timers = fakeTimers();
    let reloads = 0;
    const { request } = createDebouncedReload(
      () => {
        reloads += 1;
      },
      DATA_UPDATED_DEBOUNCE_MS,
      timers.schedule,
      timers.cancel,
    );
    request();
    timers.advance(DATA_UPDATED_DEBOUNCE_MS);
    request();
    timers.advance(DATA_UPDATED_DEBOUNCE_MS);
    assert.equal(reloads, 2);
  });

  it('drops a pending reload when the owner goes away', () => {
    const timers = fakeTimers();
    let reloads = 0;
    const { request, cancel } = createDebouncedReload(
      () => {
        reloads += 1;
      },
      DATA_UPDATED_DEBOUNCE_MS,
      timers.schedule,
      timers.cancel,
    );
    request();
    cancel();
    timers.advance(DATA_UPDATED_DEBOUNCE_MS);
    assert.equal(reloads, 0, 'a reload must not land after unmount');
    assert.equal(timers.pending(), 0);
  });
});
