import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConfigService, Logger } from '../../../framework';
import {
  DELIVERY_SCHEDULER_KEY,
  createDeliveryScheduler,
  startDeliveryScheduler,
  stopRegisteredDeliveryScheduler,
  type DeliveryRunnable,
  type DeliveryScheduler,
} from './delivery.scheduler';
import type { DeliverySweepSummary } from './delivery-worker';

const TICK = 5;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubWorker(): DeliveryRunnable & { readonly calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async runOnce(): Promise<DeliverySweepSummary> {
      state.calls += 1;
      return { skipped: false, claimed: 0, sent: 0, failed: 0, abandoned: 0 };
    },
  };
}

function quietLogger(): Logger {
  return new Logger('test');
}

function globalRef(): typeof globalThis & { [DELIVERY_SCHEDULER_KEY]?: DeliveryScheduler } {
  return globalThis as typeof globalThis & { [DELIVERY_SCHEDULER_KEY]?: DeliveryScheduler };
}

describe('createDeliveryScheduler', () => {
  const created: DeliveryScheduler[] = [];
  afterEach(async () => {
    delete globalRef()[DELIVERY_SCHEDULER_KEY];
    for (const instance of created) {
      await instance.stop();
    }
    created.length = 0;
  });

  it('runs the first sweep after the initial delay and repeats', async () => {
    const worker = stubWorker();
    const scheduler = createDeliveryScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    await wait(TICK * 4);
    assert.ok(worker.calls >= 1, 'the first sweep must run');
    await scheduler.stop();
    const afterStop = worker.calls;
    await wait(TICK * 3);
    assert.equal(worker.calls, afterStop, 'no sweep may run after stop()');
  });

  it('suppresses duplicate starts via the process-wide registry', async () => {
    const first = stubWorker();
    const second = stubWorker();
    const one = createDeliveryScheduler(
      first,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    const two = createDeliveryScheduler(
      second,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(one, two);

    one.start();
    two.start();

    await wait(TICK * 4);
    assert.ok(first.calls >= 1);
    assert.equal(second.calls, 0, 'the duplicate delivery scheduler never runs');
  });

  it('skips a tick while a sweep is still in flight and resumes after', async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    let calls = 0;
    const worker: DeliveryRunnable = {
      async runOnce() {
        calls += 1;
        if (calls === 1) {
          await gate;
        }
        return { skipped: false, claimed: 0, sent: 0, failed: 0, abandoned: 0 };
      },
    };
    const scheduler = createDeliveryScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: 0 },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    await wait(TICK * 2);
    assert.equal(calls, 1, 'a long sweep must block the next tick');
    resolveGate();
    await wait(TICK * 3);
    assert.ok(calls >= 2, 'later ticks resume once the sweep finishes');
  });

  it('keeps the schedule alive after a throwing sweep', async () => {
    let attempts = 0;
    const worker: DeliveryRunnable = {
      async runOnce() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('db down');
        }
        return { skipped: false, claimed: 0, sent: 0, failed: 0, abandoned: 0 };
      },
    };
    const scheduler = createDeliveryScheduler(
      worker,
      { intervalMs: TICK, initialDelayMs: TICK },
      quietLogger(),
    );
    created.push(scheduler);
    scheduler.start();

    await wait(TICK * 5);
    assert.ok(attempts >= 2, 'the schedule must continue after a failed sweep');
  });
});

describe('startDeliveryScheduler / stopRegisteredDeliveryScheduler', () => {
  afterEach(async () => {
    await stopRegisteredDeliveryScheduler();
    delete globalRef()[DELIVERY_SCHEDULER_KEY];
  });

  it('starts against a live database and registers the global scheduler', () => {
    const worker = stubWorker();
    const configService = new ConfigService({
      notificationDelivery: { enabled: true, intervalMs: 60_000, initialDelayMs: 60_000 },
    });
    const scheduler = startDeliveryScheduler(
      { configService, sequelize: {} as never },
      worker as never,
    );
    assert.equal(scheduler.isStarted(), true);
    assert.equal(globalRef()[DELIVERY_SCHEDULER_KEY], scheduler);
  });

  it('refuses to start without a database connection (stubbed bootstrap)', async () => {
    const worker = stubWorker();
    const configService = new ConfigService({
      notificationDelivery: { enabled: true, intervalMs: 60_000, initialDelayMs: 60_000 },
    });
    const scheduler = startDeliveryScheduler({ configService, sequelize: null }, worker as never);
    assert.equal(scheduler.isStarted(), false);
    await wait(TICK * 4);
    assert.equal(worker.calls, 0);
  });

  it('honours NOTIFICATION_OUTBOX_ENABLED=false', () => {
    const worker = stubWorker();
    const configService = new ConfigService({
      notificationDelivery: { enabled: false, intervalMs: 60_000, initialDelayMs: 60_000 },
    });
    const scheduler = startDeliveryScheduler(
      { configService, sequelize: {} as never },
      worker as never,
    );
    assert.equal(scheduler.isStarted(), false);
  });
});
