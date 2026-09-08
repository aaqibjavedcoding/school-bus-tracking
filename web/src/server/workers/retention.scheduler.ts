/**
 * In-process scheduler for the {@link RetentionWorker}.
 *
 * The application is a single custom Next.js server (`server.js`) that owns
 * the database connection, so the retention jobs run inside that same
 * process: `server.js` starts the scheduler once after
 * `bootstrapDatabase()` resolves and stops it during graceful shutdown.
 *
 * Guarantees:
 *
 * - **Started at most once per process.** Both an instance flag and a
 *   `globalThis` symbol guard repeat starts (dev restarts, double bootstrap,
 *   a second caller). The symbol also lets `server.js` stop the scheduler
 *   during shutdown without caring which module graph created it.
 * - **No overlapping runs.** A tick that fires while a run is still in flight
 *   is skipped; the PostgreSQL advisory lock additionally protects against
 * workers in *other* processes/instances.
 * - **Failures never crash the server.** A throwing `runAll()` is caught,
 *   logged and retried on the next tick.
 * - **Respects retention policies.** The worker itself reads
 * `LOCATION_RETENTION_DAYS` etc. through `ConfigService`; the scheduler only
 * adds the cadence knobs (`RETENTION_INTERVAL_MS`,
 * `RETENTION_INITIAL_DELAY_MS`, `RETENTION_ENABLED`).
 *
 * Multi-instance note: running N API instances schedules N schedulers, but the
 * advisory lock in the worker makes every run after the first a cheap no-op,
 * so this stays safe. Running the cleanup from exactly one dedicated
 * deployment (a single worker instance) remains the tidier production option.
 */
import type { Sequelize } from 'sequelize-typescript';

import { ConfigService, Logger } from '../framework';
import type { RetentionResults, RetentionWorker } from './retention.worker';

/** Default cadence: one cleanup pass every 6 hours. */
export const DEFAULT_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Default delay after boot before the first pass (let startup settle). */
export const DEFAULT_RETENTION_INITIAL_DELAY_MS = 30_000;

/** Shape both the scheduler and its tests depend on (the real worker + fakes). */
export interface RetentionRunnable {
  runAll(): Promise<RetentionResults>;
}

export interface RetentionSchedulerOptions {
  /** Cadence between cleanup passes. Default: 6h (`RETENTION_INTERVAL_MS`). */
  intervalMs?: number;
  /** Delay before the first pass after `start()`. Default: 30s. */
  initialDelayMs?: number;
  /** Set `false` to keep the scheduler unstarted (`RETENTION_ENABLED`). */
  enabled?: boolean;
  logger?: Logger;
}

export interface RetentionScheduler {
  /** Schedules the first pass; idempotent. */
  start(): void;
  /** Clears pending timers and awaits an in-flight run. Idempotent. */
  stop(): Promise<void>;
  /** True between `start()` and `stop()`. */
  isStarted(): boolean;
}

/** `globalThis` key of the scheduler started for this process (shutdown seam). */
export const RETENTION_SCHEDULER_KEY = Symbol.for('school-bus-tracking.retention-scheduler');

type GlobalWithScheduler = typeof globalThis & { [RETENTION_SCHEDULER_KEY]?: RetentionScheduler };

export function resolveSchedulerOptions(
  configService: ConfigService,
  logger: Logger,
): Required<Pick<RetentionSchedulerOptions, 'intervalMs' | 'initialDelayMs' | 'enabled'>> {
  const intervalMs = configService.get<number>(
    'retention.intervalMs',
    DEFAULT_RETENTION_INTERVAL_MS,
  );
  const initialDelayMs = configService.get<number>(
    'retention.initialDelayMs',
    DEFAULT_RETENTION_INITIAL_DELAY_MS,
  );
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    logger.warn(`Invalid retention interval ${String(intervalMs)} — using the default instead.`);
  }
  return {
    intervalMs:
      Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_RETENTION_INTERVAL_MS,
    initialDelayMs:
      Number.isFinite(initialDelayMs) && initialDelayMs >= 0
        ? initialDelayMs
        : DEFAULT_RETENTION_INITIAL_DELAY_MS,
    enabled: configService.get<boolean>('retention.enabled', true),
  };
}

/**
 * Builds and starts the scheduler for the running server process.
 *
 * `sequelize: null` (stubbed test/smoke bootstrap) is honoured explicitly:
 * the scheduler is not started at all, so smoke scripts never touch the
 * database from the background.
 */
export function startRetentionScheduler(
  deps: { configService: ConfigService; sequelize: Sequelize | null },
  worker: RetentionWorker,
  options: RetentionSchedulerOptions = {},
): RetentionScheduler {
  const logger = options.logger ?? new Logger('RetentionScheduler');
  const resolved = resolveSchedulerOptions(deps.configService, logger);
  const scheduler = createRetentionScheduler(
    worker,
    {
      ...resolved,
      ...options,
      intervalMs: options.intervalMs ?? resolved.intervalMs,
      initialDelayMs: options.initialDelayMs ?? resolved.initialDelayMs,
      enabled: options.enabled ?? resolved.enabled,
    },
    logger,
  );
  if (!deps.sequelize) {
    logger.warn(
      'Retention scheduling skipped — this process has no database connection (stubbed bootstrap).',
    );
    return scheduler;
  }
  scheduler.start();
  return scheduler;
}

/**
 * Stops and deregisters the scheduler running for this process, if any.
 *
 * This is the shutdown seam `server.js` calls from its SIGTERM/SIGINT
 * handler — like the realtime wiring, the scheduler may have been created by
 * a different require graph, so the global registration is the only reliable
 * handle.
 */
export async function stopRegisteredRetentionScheduler(): Promise<void> {
  const globalRef = globalThis as GlobalWithScheduler;
  const active = globalRef[RETENTION_SCHEDULER_KEY];
  if (active) {
    await active.stop();
  }
}

/**
 * Creates a scheduler without starting it. Exported separately from
 * {@link startRetentionScheduler} so unit tests can drive `start`/`stop`
 * with fake timers and a stubbed worker.
 */
export function createRetentionScheduler(
  worker: RetentionRunnable,
  options: RetentionSchedulerOptions = {},
  logger: Logger = new Logger('RetentionScheduler'),
): RetentionScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_RETENTION_INTERVAL_MS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_RETENTION_INITIAL_DELAY_MS;

  let started = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<RetentionResults> | null = null;

  const runOnce = (): void => {
    if (inFlight) {
      logger.warn('Retention run still in flight — skipping this tick.');
      return;
    }
    inFlight = worker
      .runAll()
      .catch((error: unknown) => {
        // Never let a background failure take the API server down; the next
        // tick (and the advisory lock for other instances) stays healthy.
        logger.error(
          `Retention run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return { skipped: true };
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

  // Referenced from inside its own methods (the global registration must be
  // able to tell *this* scheduler apart from a stray duplicate), so the object
  // is captured in a `const` the closures read at call time.
  const api: RetentionScheduler = {
    start() {
      const globalRef = globalThis as GlobalWithScheduler;
      if (globalRef[RETENTION_SCHEDULER_KEY] && globalRef[RETENTION_SCHEDULER_KEY] !== api) {
        logger.warn(
          'A retention scheduler is already registered for this process — ignoring the duplicate start.',
        );
        return;
      }
      if (started) {
        return;
      }
      if (options.enabled === false) {
        logger.log('Retention worker disabled by configuration (RETENTION_ENABLED=false).');
        return;
      }
      started = true;
      logger.log(
        `Retention worker scheduled — first pass in ${initialDelayMs}ms, then every ${intervalMs}ms.`,
      );
      initialTimer = setTimeout(() => {
        initialTimer = null;
        runOnce();
      }, initialDelayMs);
      intervalTimer = setInterval(runOnce, intervalMs);
      globalRef[RETENTION_SCHEDULER_KEY] = api;
    },
    async stop() {
      const globalRef = globalThis as GlobalWithScheduler;
      if (globalRef[RETENTION_SCHEDULER_KEY] === api) {
        delete globalRef[RETENTION_SCHEDULER_KEY];
      }
      if (!started) {
        return;
      }
      started = false;
      clearTimers();
      logger.log('Retention worker stopped.');
      const running = inFlight;
      if (running) {
        // Await (never escalate) — shutdown must not crash on a background
        // cleanup error that is already logged.
        await running.catch(() => undefined);
      }
    },
    isStarted() {
      return started;
    },
  };
  return api;
}
