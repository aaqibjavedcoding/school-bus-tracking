import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BackoffCancelledError,
  STYLE_RETRY_DELAYS_MS,
  planStyleLoadFailure,
  runWithBackoff,
} from './map-style-recovery.ts';

/**
 * The retry/recovery policy, pinned under `node --test` **mock timers**.
 *
 * Ground rules (the brief says so, and this file obeys): no real network —
 * every attempt is an injected port that fails or succeeds on cue; no real
 * sleeps — `t.mock.timers` drives `setTimeout`, which the injected spy
 * sleeper delegates to (the spy is also what the schedule is asserted
 * against); nothing scheduleable survives a test — `t.after` resets the mock
 * clock, and the module itself keeps no state.
 *
 * Node 22's `mock.timers` has no `tickAsync`, so after each synchronous
 * `tick()` the promise machinery is drained by awaiting one real
 * `setImmediate` turn — microtasks always run to completion before the event
 * loop reaches it.
 */
const drainMicrotasks = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/** A sleeper that records its schedule and runs on the mock clock. */
function spySleep(delays: number[]): (delayMs: number) => Promise<void> {
  return (delayMs: number) => {
    delays.push(delayMs);
    return new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  };
}

describe('the shared backoff schedule', () => {
  it('is the documented, bounded 2 s / 5 s / 15 s', () => {
    assert.deepEqual([...STYLE_RETRY_DELAYS_MS], [2_000, 5_000, 15_000]);
  });

  it('bounds the worst case inside the ~20 s field acceptance for a blip', () => {
    const worstCaseMs = STYLE_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0);
    assert.ok(worstCaseMs <= 25_000, `worst case ${worstCaseMs} ms must stay a short field wait`);
  });

  it('is increasing: cheap checks first, patience later', () => {
    for (let index = 1; index < STYLE_RETRY_DELAYS_MS.length; index += 1) {
      assert.ok(STYLE_RETRY_DELAYS_MS[index] > STYLE_RETRY_DELAYS_MS[index - 1]);
    }
  });
});

describe('runWithBackoff', () => {
  it('resolves on the first success without ever sleeping', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());

    const delays: number[] = [];
    let attempts = 0;
    const value = await runWithBackoff({
      sleep: spySleep(delays),
      attempt: () => {
        attempts += 1;
        return Promise.resolve('ok');
      },
    });
    assert.equal(value, 'ok');
    assert.equal(attempts, 1);
    assert.deepEqual(delays, [], 'a first-try success must not schedule a wait');
  });

  it('waits exactly the injected delays between attempts, then resolves', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());

    const delays: number[] = [];
    let attempts = 0;
    const promise = runWithBackoff({
      delaysMs: [1_000, 2_000],
      sleep: spySleep(delays),
      attempt: () => {
        attempts += 1;
        return attempts < 3 ? Promise.reject(new Error(`flaky ${attempts}`)) : Promise.resolve('ok');
      },
    });
    // The first attempt runs synchronously into its rejection; the backoff
    // timer is what gates the second one.
    assert.equal(attempts, 1);
    await drainMicrotasks();
    assert.deepEqual(delays, [1_000], 'the first wait starts after the first failure');

    t.mock.timers.tick(999);
    await drainMicrotasks();
    assert.equal(attempts, 1, 'the retry must wait out the first delay');
    t.mock.timers.tick(1);
    await drainMicrotasks();
    assert.equal(attempts, 2, 'first delay elapsed → second attempt');
    assert.deepEqual(delays, [1_000, 2_000]);

    t.mock.timers.tick(2_000);
    await drainMicrotasks();
    assert.equal(await promise, 'ok');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1_000, 2_000], 'a settled run leaves no more waits');
  });

  it('spends at most delays+1 attempts and rejects with the LAST failure', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());

    const delays: number[] = [];
    let attempts = 0;
    const promise = runWithBackoff<string>({
      // A local, tiny schedule: the policy is the shape, not the clock.
      delaysMs: [100, 200, 300],
      sleep: spySleep(delays),
      attempt: () => {
        attempts += 1;
        return Promise.reject(new Error(`failure #${attempts}`));
      },
    });
    const settled = promise.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    for (const delay of [100, 200, 300]) {
      // Drain first: the failure must land (and its wait get scheduled)
      // before the clock moves, or the tick fires nothing.
      await drainMicrotasks();
      t.mock.timers.tick(delay);
    }
    await drainMicrotasks();
    assert.equal(await settled, 'failure #4', 'the freshest failure is the honest one');
    assert.equal(attempts, 4, 'three delays + the first attempt, then it stops');
    assert.deepEqual(delays, [100, 200, 300], 'no wait is scheduled past the last attempt');
  });

  it('stops between attempts when cancelled, throwing the cancellation', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());

    let cancelled = false;
    let attempts = 0;
    const promise = runWithBackoff({
      delaysMs: [1_000, 1_000],
      isCancelled: () => cancelled,
      attempt: () => {
        attempts += 1;
        if (attempts === 1) cancelled = true; // an unmount mid-recovery
        return Promise.reject(new Error('still failing'));
      },
    });
    const settled = promise.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    // The first wait schedules after the first failure lands; then the clock
    // moves; then the cancelled check at the top of the next attempt fires.
    await drainMicrotasks();
    t.mock.timers.tick(1_000);
    await drainMicrotasks();
    assert.ok((await settled) instanceof BackoffCancelledError);
    assert.equal(attempts, 1, 'a cancelled pipeline makes no further attempts');
  });
});

describe('planStyleLoadFailure (the native did-fail decision)', () => {
  it('schedules a re-set at the scheduled delay while the budget lasts', () => {
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: false, recoveryInFlight: false, consecutiveFailures: 0 }),
      { kind: 'retry', delayMs: 2_000 },
    );
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: false, recoveryInFlight: false, consecutiveFailures: 1 }),
      { kind: 'retry', delayMs: 5_000 },
    );
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: false, recoveryInFlight: false, consecutiveFailures: 2 }),
      { kind: 'retry', delayMs: 15_000 },
    );
  });

  it('drops to the offline fallback once the bounded budget is spent', () => {
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: false, recoveryInFlight: false, consecutiveFailures: 3 }),
      { kind: 'fallback' },
    );
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: false, recoveryInFlight: false, consecutiveFailures: 9 }),
      { kind: 'fallback' },
    );
  });

  it('never double-schedules while a recovery is in flight', () => {
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: false, recoveryInFlight: true, consecutiveFailures: 0 }),
      { kind: 'wait' },
    );
  });

  it('does nothing more when the offline fallback is already showing', () => {
    assert.deepEqual(
      planStyleLoadFailure({ showingFallback: true, recoveryInFlight: false, consecutiveFailures: 0 }),
      { kind: 'wait' },
      'the fallback cannot fail its way back to the network style on its own',
    );
  });
});
