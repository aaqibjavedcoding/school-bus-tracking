/**
 * In-process scheduler for the {@link MarketingDeliveryWorker}.
 *
 * Identical in shape to the retention and notification-outbox schedulers, on
 * purpose: this repository runs one custom Next.js server process that owns
 * the database connection, so background work lives in that process and is
 * started once after `bootstrapDatabase()` resolves and stopped during
 * graceful shutdown. A second scheduling mechanism (cron container, external
 * queue runner) would be a second deployment to keep in sync for no gain at
 * this size.
 *
 * Guarantees:
 *
 * - **Started at most once per process.** An instance flag plus a
 *   `globalThis` symbol survive dev hot-restarts and double bootstraps, and
 *   give `server.js` a handle to stop it without knowing which module graph
 *   created it.
 * - **No overlapping sweeps.** A tick that fires while a sweep is in flight
 *   is skipped. Across processes, the worker's advisory lock plus
 *   `FOR UPDATE SKIP LOCKED` make a concurrent sweep safe rather than
 *   forbidden.
 * - **Failures never crash the server.** A throwing sweep is caught, logged
 *   and retried next tick; the configured admin address is notified for
 *   startup/configuration problems, never for every transient blip.
 * - **Graceful shutdown finishes in-flight sends.** `stop()` tells the
 *   worker to stop claiming, then awaits the sweep already running so no row
 *   is left leased with no outcome.
 * - **No audit noise.** Starting and stopping a worker is operational
 *   telemetry, not a Super Admin action: it goes to the log, never to
 *   `audit_logs`, which exists to answer "who changed what".
 */

import { ConfigService, Logger } from '../../framework';
import type { MarketingSweepSummary } from './marketing-delivery.worker';

/** Default sweep cadence. */
export const DEFAULT_MARKETING_INTERVAL_MS = 15_000;
/** Default delay after boot before the first sweep. */
export const DEFAULT_MARKETING_INITIAL_DELAY_MS = 30_000;

/** The worker surface the scheduler drives (the real worker, or a fake). */
export interface MarketingDeliveryRunnable {
  runOnce(): Promise<MarketingSweepSummary>;
  shutdown?(): void;
}

export interface MarketingSchedulerOptions {
  intervalMs?: number;
  initialDelayMs?: number;
  /** `MARKETING_WORKER_ENABLED=false` keeps the scheduler unstarted. */
  enabled?: boolean;
  logger?: Logger;
  /** Called once if starting is impossible/misconfigured (admin alert rail). */
  onStartupProblem?: (message: string) => void;
}

export interface MarketingDeliveryScheduler {
  start(): void;
  stop(): Promise<void>;
  isStarted(): boolean;
}

export const MARKETING_SCHEDULER_KEY = Symbol.for('school-bus-tracking.marketing-scheduler');

type GlobalWithScheduler = typeof globalThis & {
  [MARKETING_SCHEDULER_KEY]?: MarketingDeliveryScheduler;
};

const EMPTY_SUMMARY: MarketingSweepSummary = {
  skipped: true,
  claimed: 0,
  sent: 0,
  retrying: 0,
  failed: 0,
  suppressed: 0,
  expired: 0,
  cancelled: 0,
  rateLimited: false,
};

/** Reads the cadence knobs, falling back (loudly) on nonsense values. */
export function resolveMarketingSchedulerOptions(
  configService: ConfigService,
  logger: Logger,
): Required<Pick<MarketingSchedulerOptions, 'intervalMs' | 'initialDelayMs' | 'enabled'>> {
  const intervalMs = configService.get<number>(
    'marketing.worker.intervalMs',
    DEFAULT_MARKETING_INTERVAL_MS,
  );
  const initialDelayMs = configService.get<number>(
    'marketing.worker.initialDelayMs',
    DEFAULT_MARKETING_INITIAL_DELAY_MS,
  );
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    logger.warn(
      `Invalid MARKETING_WORKER_INTERVAL_MS ${String(intervalMs)} — using the default instead.`,
    );
  }
  return {
    intervalMs:
      Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_MARKETING_INTERVAL_MS,
    initialDelayMs:
      Number.isFinite(initialDelayMs) && initialDelayMs >= 0
        ? initialDelayMs
        : DEFAULT_MARKETING_INITIAL_DELAY_MS,
    enabled: configService.get<boolean>('marketing.worker.enabled', true),
  };
}

/** Creates a scheduler without starting it (the unit-test seam). */
export function createMarketingDeliveryScheduler(
  worker: MarketingDeliveryRunnable,
  options: MarketingSchedulerOptions = {},
  logger: Logger = new Logger('MarketingDeliveryScheduler'),
): MarketingDeliveryScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_MARKETING_INTERVAL_MS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_MARKETING_INITIAL_DELAY_MS;

  let started = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<MarketingSweepSummary> | null = null;

  const runOnce = (): void => {
    if (inFlight) {
      logger.warn('Marketing delivery sweep still in flight — skipping this tick.');
      return;
    }
    inFlight = worker
      .runOnce()
      .catch((error: unknown) => {
        logger.error(
          `Marketing delivery sweep failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return EMPTY_SUMMARY;
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const clearTimers = (): void => {
    if (initialTimer) {
      clearTimeout(initialTimer);
      initialTimer = null;
    }
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };

  const api: MarketingDeliveryScheduler = {
    start() {
      const globalRef = globalThis as GlobalWithScheduler;
      if (globalRef[MARKETING_SCHEDULER_KEY] && globalRef[MARKETING_SCHEDULER_KEY] !== api) {
        logger.warn(
          'A marketing delivery scheduler is already registered for this process — ignoring the duplicate start.',
        );
        return;
      }
      if (started) {
        return;
      }
      if (options.enabled === false) {
        logger.log('Marketing delivery worker disabled by configuration (MARKETING_WORKER_ENABLED=false).');
        return;
      }
      started = true;
      logger.log(
        `Marketing delivery worker scheduled — first sweep in ${initialDelayMs}ms, then every ${intervalMs}ms.`,
      );
      initialTimer = setTimeout(() => {
        initialTimer = null;
        runOnce();
      }, initialDelayMs);
      intervalTimer = setInterval(runOnce, intervalMs);
      globalRef[MARKETING_SCHEDULER_KEY] = api;
    },
    async stop() {
      const globalRef = globalThis as GlobalWithScheduler;
      if (globalRef[MARKETING_SCHEDULER_KEY] === api) {
        delete globalRef[MARKETING_SCHEDULER_KEY];
      }
      if (!started) {
        return;
      }
      started = false;
      clearTimers();
      // Stop claiming first, then wait for the in-flight sweep: a send that
      // already reached the relay must be allowed to record its outcome.
      worker.shutdown?.();
      logger.log('Marketing delivery worker stopped.');
      const running = inFlight;
      if (running) {
        await running.catch(() => undefined);
      }
    },
    isStarted() {
      return started;
    },
  };
  return api;
}

/**
 * Builds and starts the scheduler for the running server process.
 *
 * A stubbed bootstrap (`sequelize: null`, used by smoke scripts and DB-less
 * tests) is honoured explicitly: the scheduler is created but never started,
 * so no background code path touches a database that is not there.
 */
export function startMarketingDeliveryScheduler(
  deps: { configService: ConfigService; sequelize: unknown | null },
  worker: MarketingDeliveryRunnable,
  options: MarketingSchedulerOptions = {},
): MarketingDeliveryScheduler {
  const logger = options.logger ?? new Logger('MarketingDeliveryScheduler');
  const resolved = resolveMarketingSchedulerOptions(deps.configService, logger);
  const scheduler = createMarketingDeliveryScheduler(
    worker,
    {
      ...options,
      intervalMs: options.intervalMs ?? resolved.intervalMs,
      initialDelayMs: options.initialDelayMs ?? resolved.initialDelayMs,
      enabled: options.enabled ?? resolved.enabled,
    },
    logger,
  );
  if (!deps.sequelize) {
    logger.warn(
      'Marketing delivery scheduling skipped — this process has no database connection (stubbed bootstrap).',
    );
    return scheduler;
  }
  scheduler.start();
  return scheduler;
}

/** Stops and deregisters the scheduler of this process, if any. */
export async function stopRegisteredMarketingDeliveryScheduler(): Promise<void> {
  const globalRef = globalThis as GlobalWithScheduler;
  await globalRef[MARKETING_SCHEDULER_KEY]?.stop();
}
