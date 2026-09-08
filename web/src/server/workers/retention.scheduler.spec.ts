import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConfigService, Logger } from '../framework';
import {
  RETENTION_SCHEDULER_KEY,
  createRetentionScheduler,
  resolveSchedulerOptions,
  startRetentionScheduler,
  DEFAULT_RETENTION_INITIAL_DELAY_MS,
  DEFAULT_RETENTION_INTERVAL_MS,
  type RetentionRunnable,
  type RetentionScheduler,
} from './retention.scheduler';

/**
 * Real timers with short delays: the scheduler is a thin `setTimeout` +
 * `setInterval` wrapper, and the specs assert the observable scheduling
 * behaviour (runs happen, duplicates are suppressed, failures never throw,
 * stop() clears everything) rather than the timer mechanics themselves.
 */

const TICK = 5;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubWorker(): RetentionRunnable & { readonly calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async runAll() {
      state.calls += 1;
      return { skipped: false };
    },
  };
}

/** Silences the scheduler's logs for the duration of a test. */
function quietLogger(): Logger {
  return new Logger('test');
}

describe('createRetentionScheduler', () => {
  // Every scheduler created in a test, stopped again after it — a stopped
  // node:test process never exits while one of these intervals still ticks.
  const created: RetentionScheduler[] = [];
  let scheduler: RetentionScheduler | null = null;

  afterEach(async () => {
    for (const instance of created) {
      await instance.stop();
    }
    created.length = 0;
    scheduler = null;
  });

  it('runs the first pass after the initial delay and repeats on the interval', async () => {
    const worker = stubWorker();
    scheduler = createRetentionScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    await wait(TICK * 4);
    assert.ok(worker.calls >= 2, `expected at least two runs, got ${worker.calls}`);
    await scheduler.stop();
    const afterStop = worker.calls;
    await wait(TICK * 3);
    assert.equal(worker.calls, afterStop, 'no run may be scheduled after stop()');
  });

  it('never schedules twice — a second start() is a no-op', async () => {
    const worker = stubWorker();
    scheduler = createRetentionScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();
    scheduler.start();
    scheduler.start();

    await wait(TICK * 4);
    const calls = worker.calls;
    // One timer pair runs at most one pass per interval (≤ 3 extra in the
    // three ticks that follow); a triple-registered scheduler would run ~3
    // passes per interval — roughly nine.
    await wait(TICK * 3);
    assert.ok(worker.calls - calls <= 4, 'runs must come from a single timer pair');
  });

  it('ignores a start while a different scheduler is already registered', async () => {
    const first = stubWorker();
    const second = stubWorker();
    const one = createRetentionScheduler(
      first,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    const two = createRetentionScheduler(
      second,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(one, two);
    scheduler = one;
    one.start();
    two.start(); // duplicate registration — must not schedule

    await wait(TICK * 4);
    assert.ok(first.calls >= 1, 'the registered scheduler runs');
    assert.equal(second.calls, 0, 'the duplicate scheduler never runs');
    await two.stop();
  });

  it('swallows worker failures and keeps the schedule alive', async () => {
    let attempts = 0;
    const worker: RetentionRunnable = {
      runAll: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('database unavailable');
        }
        return { skipped: false };
      },
    };
    scheduler = createRetentionScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    await wait(TICK * 5);
    assert.ok(attempts >= 2, 'the schedule must continue after a failed run');
    await scheduler.stop();
  });

  it('skips a tick while the previous run is still in flight', async () => {
    const gate = deferred<void>();
    let calls = 0;
    const worker: RetentionRunnable = {
      runAll: async () => {
        calls += 1;
        if (calls === 1) {
          await gate.promise;
        }
        return { skipped: false };
      },
    };
    scheduler = createRetentionScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: 0 },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    await wait(TICK * 2);
    assert.equal(calls, 1, 'the long-running first pass blocks the second tick');
    gate.resolve();
    await wait(TICK * 3);
    assert.ok(calls >= 2, 'later ticks resume once the run finishes');
    await scheduler.stop();
  });

  it('stop() awaits an in-flight run instead of abandoning it', async () => {
    const gate = deferred<void>();
    let finished = false;
    const worker: RetentionRunnable = {
      runAll: async () => {
        await gate.promise;
        finished = true;
        return { skipped: false };
      },
    };
    scheduler = createRetentionScheduler(worker, { initialDelayMs: 0 }, quietLogger());
    created.push(scheduler);
    scheduler.start();
    await wait(TICK);
    assert.equal(finished, false);

    const stopping = scheduler.stop();
    gate.resolve();
    await stopping;
    scheduler = null;
    assert.equal(finished, true, 'stop() must wait for the in-flight run');
  });

  it('does not start when disabled by configuration', async () => {
    const worker = stubWorker();
    scheduler = createRetentionScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK, enabled: false },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    assert.equal(scheduler.isStarted(), false);
    await wait(TICK * 4);
    assert.equal(worker.calls, 0);
  });

  it('never leaves the global registration behind after stop()', async () => {
    const worker = stubWorker();
    const globalRef = globalThis as typeof globalThis & {
      [RETENTION_SCHEDULER_KEY]?: RetentionScheduler;
    };
    delete globalRef[RETENTION_SCHEDULER_KEY];
    scheduler = createRetentionScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();
    assert.equal(globalRef[RETENTION_SCHEDULER_KEY], scheduler);
    await scheduler.stop();
    scheduler = null;
    assert.equal(globalRef[RETENTION_SCHEDULER_KEY], undefined);
  });
});

describe('startRetentionScheduler', () => {
  let scheduler: RetentionScheduler | null = null;

  afterEach(async () => {
    await scheduler?.stop();
    scheduler = null;
    const globalRef = globalThis as typeof globalThis & {
      [RETENTION_SCHEDULER_KEY]?: RetentionScheduler;
    };
    delete globalRef[RETENTION_SCHEDULER_KEY];
  });

  it('starts against a live database connection and registers itself globally', () => {
    const worker = stubWorker();
    const configService = new ConfigService({
      retention: { enabled: true, intervalMs: 60_000, initialDelayMs: 60_000 },
    });
    scheduler = startRetentionScheduler({ configService, sequelize: {} as never }, worker as never);
    assert.equal(scheduler.isStarted(), true);
    const globalRef = globalThis as typeof globalThis & {
      [RETENTION_SCHEDULER_KEY]?: RetentionScheduler;
    };
    assert.equal(globalRef[RETENTION_SCHEDULER_KEY], scheduler);
  });

  it('refuses to start without a database connection (stubbed bootstrap)', async () => {
    const worker = stubWorker();
    const configService = new ConfigService({
      retention: { enabled: true, intervalMs: 60_000, initialDelayMs: 60_000 },
    });
    scheduler = startRetentionScheduler({ configService, sequelize: null }, worker as never);
    assert.equal(scheduler.isStarted(), false);
    await wait(TICK * 4);
    assert.equal(worker.calls, 0);
  });

  it('honours RETENTION_ENABLED=false from configuration', async () => {
    const worker = stubWorker();
    const configService = new ConfigService({
      retention: { enabled: false, intervalMs: 60_000, initialDelayMs: 60_000 },
    });
    scheduler = startRetentionScheduler({ configService, sequelize: {} as never }, worker as never);
    assert.equal(scheduler.isStarted(), false);
  });
});

describe('resolveSchedulerOptions', () => {
  it('applies the defaults when the config carries no scheduler keys', () => {
    const options = resolveSchedulerOptions(new ConfigService({ retention: {} }), quietLogger());
    assert.equal(options.enabled, true);
    assert.equal(options.intervalMs, DEFAULT_RETENTION_INTERVAL_MS);
    assert.equal(options.initialDelayMs, DEFAULT_RETENTION_INITIAL_DELAY_MS);
  });

  it('reads the configured cadence and falls back from invalid values', () => {
    const configured = resolveSchedulerOptions(
      new ConfigService({ retention: { intervalMs: 1_000, initialDelayMs: 500 } }),
      quietLogger(),
    );
    assert.equal(configured.intervalMs, 1_000);
    assert.equal(configured.initialDelayMs, 500);

    const invalid = resolveSchedulerOptions(
      new ConfigService({ retention: { intervalMs: -5, initialDelayMs: 0 } }),
      quietLogger(),
    );
    assert.equal(invalid.intervalMs, DEFAULT_RETENTION_INTERVAL_MS);
    assert.equal(invalid.initialDelayMs, 0);
  });
});
