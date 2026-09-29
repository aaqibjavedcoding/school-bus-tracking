import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INITIAL_SCROLL_LOCK,
  isScrollLocked,
  reduceScrollLock,
  type ScrollLockEvent,
  type ScrollLockState,
} from './scroll-lock.ts';

/**
 * The gesture-ownership reducer, pinned on the three ways it can rot:
 *
 * 1. a **leaked lock** — the screen never scrolls again because one release
 *    was missed;
 * 2. a **stolen release** — one island unlocks the scroll while another is
 *    still being touched;
 * 3. **duplicate locks** — a touch stream that reports two starts before an
 *    end leaves a counter above zero forever.
 *
 * All three were reachable with the obvious `useState<boolean>` version, and
 * all three present as the same field symptom: a driver who cannot scroll the
 * trip screen.
 */

function run(events: ScrollLockEvent[], from: ScrollLockState = INITIAL_SCROLL_LOCK) {
  return events.reduce(reduceScrollLock, from);
}

describe('scroll lock — one island', () => {
  const cases: Array<{ name: string; events: ScrollLockEvent[]; locked: boolean }> = [
    { name: 'nothing has happened yet', events: [], locked: false },
    { name: 'a touch is on the map', events: [{ type: 'lock', owner: 'map' }], locked: true },
    {
      name: 'the touch ended',
      events: [
        { type: 'lock', owner: 'map' },
        { type: 'release', owner: 'map' },
      ],
      locked: false,
    },
    {
      name: 'the same island locked twice and released once',
      events: [
        { type: 'lock', owner: 'map' },
        { type: 'lock', owner: 'map' },
        { type: 'release', owner: 'map' },
      ],
      locked: false,
    },
    {
      name: 'a release arrived without a lock',
      events: [{ type: 'release', owner: 'map' }],
      locked: false,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.locked ? 'locked' : 'scrollable'}`, () => {
      assert.equal(isScrollLocked(run(testCase.events)), testCase.locked);
    });
  }
});

describe('scroll lock — two islands', () => {
  it('keeps the lock while the second island is still touched', () => {
    const state = run([
      { type: 'lock', owner: 'map' },
      { type: 'lock', owner: 'slider' },
      { type: 'release', owner: 'map' },
    ]);
    assert.deepEqual(state.owners, ['slider']);
    assert.equal(isScrollLocked(state), true);
  });

  it('releases only when the last island lets go', () => {
    const state = run([
      { type: 'lock', owner: 'map' },
      { type: 'lock', owner: 'slider' },
      { type: 'release', owner: 'slider' },
      { type: 'release', owner: 'map' },
    ]);
    assert.equal(isScrollLocked(state), false);
  });

  it('drops every lock on teardown — no touch-end will ever arrive', () => {
    const state = run([
      { type: 'lock', owner: 'map' },
      { type: 'lock', owner: 'slider' },
      { type: 'release-all' },
    ]);
    assert.deepEqual(state.owners, []);
  });
});

describe('scroll lock — identity', () => {
  it('returns the same object when nothing changes, so React skips the render', () => {
    const locked = run([{ type: 'lock', owner: 'map' }]);
    assert.equal(reduceScrollLock(locked, { type: 'lock', owner: 'map' }), locked);
    assert.equal(reduceScrollLock(locked, { type: 'release', owner: 'other' }), locked);
    assert.equal(
      reduceScrollLock(INITIAL_SCROLL_LOCK, { type: 'release-all' }),
      INITIAL_SCROLL_LOCK,
    );
  });
});
