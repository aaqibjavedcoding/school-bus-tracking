import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConfigService, Logger } from '../../framework';
import {
  createMarketingDeliveryScheduler,
  resolveMarketingSchedulerOptions,
  startMarketingDeliveryScheduler,
  stopRegisteredMarketingDeliveryScheduler,
  DEFAULT_MARKETING_INITIAL_DELAY_MS,
  DEFAULT_MARKETING_INTERVAL_MS,
  MARKETING_SCHEDULER_KEY,
  type MarketingDeliveryRunnable,
} from './marketing-delivery.scheduler';
import type { MarketingSweepSummary } from './marketing-delivery.worker';

/**
 * The scheduler is the only thing that makes delivery happen, so its failure
 * modes are the ones an operator would notice at 2am: two schedulers in one
 * process (double sends), a sweep that overlaps itself, a crash that takes
 * the API down with it, or a shutdown that abandons leased rows.
 */

const EMPTY: MarketingSweepSummary = {
  skipped: false,
  claimed: 0,
  sent: 0,
  retrying: 0,
  failed: 0,
  suppressed: 0,
  expired: 0,
  cancelled: 0,
  rateLimited: false,
};

const silentLogger = new Logger('MarketingSchedulerSpec');
for (const method of ['log', 'warn', 'error', 'debug'] as const) {
  (silentLogger as unknown as Record<string, () => void>)[method] = () => undefined;
}

function fakeWorker(
  run: () => Promise<MarketingSweepSummary> = async () => EMPTY,
): MarketingDeliveryRunnable & { runs: number; shutdowns: number } {
  const worker = {
    runs: 0,
    shutdowns: 0,
    async runOnce() {
      worker.runs += 1;
      return run();
    },
    shutdown() {
      worker.shutdowns += 1;
    },
  };
  return worker;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('createMarketingDeliveryScheduler', () => {
  it('runs the first sweep after the initial delay, then on the interval', async () => {
    const worker = fakeWorker();
    const scheduler = createMarketingDeliveryScheduler(
      worker,
      { initialDelayMs: 1, intervalMs: 5 },
      silentLogger,
    );

    scheduler.start();
    assert.equal(worker.runs, 0, 'nothing runs synchronously at boot');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await scheduler.stop();

    assert.ok(worker.runs >= 2, `expected repeated sweeps, saw ${worker.runs}`);
  });

  it('never starts when the worker is disabled by configuration', async () => {
    const worker = fakeWorker();
    const scheduler = createMarketingDeliveryScheduler(
      worker,
      { initialDelayMs: 1, intervalMs: 1, enabled: false },
      silentLogger,
    );

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(scheduler.isStarted(), false);
    assert.equal(worker.runs, 0, 'MARKETING_WORKER_ENABLED=false must mean no delivery');
    await scheduler.stop();
  });

  it('registers exactly one scheduler per process', async () => {
    const first = createMarketingDeliveryScheduler(fakeWorker(), { initialDelayMs: 1000 }, silentLogger);
    const secondWorker = fakeWorker();
    const second = createMarketingDeliveryScheduler(
      secondWorker,
      { initialDelayMs: 1 },
      silentLogger,
    );

    first.start();
    second.start();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(second.isStarted(), false, 'a hot-reloaded duplicate must not double-send');
    assert.equal(secondWorker.runs, 0);
    await first.stop();
    await second.stop();
  });

  it('skips a tick while a sweep is still in flight', async () => {
    let release: () => void = () => undefined;
    const worker = fakeWorker(
      () =>
        new Promise<MarketingSweepSummary>((resolve) => {
          release = () => resolve(EMPTY);
        }),
    );
    const scheduler = createMarketingDeliveryScheduler(
      worker,
      { initialDelayMs: 1, intervalMs: 2 },
      silentLogger,
    );

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(worker.runs, 1, 'a slow sweep is never run concurrently with itself');
    release();
    await scheduler.stop();
  });

  it('survives a throwing sweep and keeps the schedule', async () => {
    let calls = 0;
    const worker = fakeWorker(async () => {
      calls += 1;
      throw new Error('database unreachable');
    });
    const scheduler = createMarketingDeliveryScheduler(
      worker,
      { initialDelayMs: 1, intervalMs: 3 },
      silentLogger,
    );

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await scheduler.stop();

    assert.ok(calls >= 2, 'a failed sweep must not stop the schedule (or crash the API)');
  });

  it('stops claiming and waits for the in-flight sweep on shutdown', async () => {
    let finished = false;
    let release: () => void = () => undefined;
    const worker = fakeWorker(
      () =>
        new Promise<MarketingSweepSummary>((resolve) => {
          release = () => {
            finished = true;
            resolve(EMPTY);
          };
        }),
    );
    const scheduler = createMarketingDeliveryScheduler(
      worker,
      { initialDelayMs: 1, intervalMs: 1000 },
      silentLogger,
    );

    scheduler.start();
    await tick();
    const stopping = scheduler.stop();
    assert.equal(worker.shutdowns, 1, 'the worker is told to stop claiming first');
    assert.equal(finished, false);
    release();
    await stopping;

    assert.equal(finished, true, 'the sweep that was running got to record its outcome');
    assert.equal(scheduler.isStarted(), false);
  });

  it('deregisters itself so a later start can take over', async () => {
    const scheduler = createMarketingDeliveryScheduler(fakeWorker(), { initialDelayMs: 1000 }, silentLogger);
    scheduler.start();
    assert.ok((globalThis as Record<symbol, unknown>)[MARKETING_SCHEDULER_KEY]);
    await stopRegisteredMarketingDeliveryScheduler();
    assert.equal((globalThis as Record<symbol, unknown>)[MARKETING_SCHEDULER_KEY], undefined);
  });
});

describe('resolveMarketingSchedulerOptions', () => {
  const config = (values: Record<string, unknown>): ConfigService =>
    ({
      get: <T>(key: string, fallback?: T) => (key in values ? (values[key] as T) : (fallback as T)),
    }) as unknown as ConfigService;

  it('reads the cadence from configuration', () => {
    const resolved = resolveMarketingSchedulerOptions(
      config({
        'marketing.worker.intervalMs': 9000,
        'marketing.worker.initialDelayMs': 500,
        'marketing.worker.enabled': false,
      }),
      silentLogger,
    );
    assert.deepEqual(resolved, { intervalMs: 9000, initialDelayMs: 500, enabled: false });
  });

  it('falls back to defaults when the environment holds nonsense', () => {
    const resolved = resolveMarketingSchedulerOptions(
      config({ 'marketing.worker.intervalMs': -1, 'marketing.worker.initialDelayMs': Number.NaN }),
      silentLogger,
    );
    assert.equal(resolved.intervalMs, DEFAULT_MARKETING_INTERVAL_MS);
    assert.equal(resolved.initialDelayMs, DEFAULT_MARKETING_INITIAL_DELAY_MS);
    assert.equal(resolved.enabled, true, 'delivery is on unless it is explicitly turned off');
  });
});

describe('startMarketingDeliveryScheduler', () => {
  it('schedules nothing when the process has no database connection', async () => {
    const worker = fakeWorker();
    const configService = {
      get: (<T>(_key: string, fallback?: T) => fallback as T) as ConfigService['get'],
    } as unknown as ConfigService;

    const scheduler = startMarketingDeliveryScheduler(
      { configService, sequelize: null },
      worker,
      { initialDelayMs: 1, intervalMs: 1, logger: silentLogger },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(scheduler.isStarted(), false, 'a stubbed bootstrap must not run background work');
    assert.equal(worker.runs, 0);
    await scheduler.stop();
  });

  it('starts when a connection exists', async () => {
    const worker = fakeWorker();
    const configService = {
      get: (<T>(_key: string, fallback?: T) => fallback as T) as ConfigService['get'],
    } as unknown as ConfigService;

    const scheduler = startMarketingDeliveryScheduler(
      { configService, sequelize: {} },
      worker,
      { initialDelayMs: 1, intervalMs: 1000, logger: silentLogger },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await scheduler.stop();

    assert.equal(worker.runs, 1);
  });
});
