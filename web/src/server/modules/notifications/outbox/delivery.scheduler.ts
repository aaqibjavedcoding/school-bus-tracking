import { ConfigService, Logger } from '../../../framework';
import type { DeliverySweepSummary } from './delivery-worker';

/**
 * In-process scheduler for the {@link DeliveryWorker} — the same single-
 * process model as the retention scheduler (`server.js` starts it once after
 * `bootstrapDatabase()` and stops it during graceful shutdown).
 *
 * Guarantees:
 * - started at most once per process (instance flag + `globalThis` symbol);
 * - no overlapping sweeps (a tick while a sweep is in flight is skipped; the
 *   worker's per-school advisory lock protects cross-instance);
 * - a throwing sweep never crashes the server (logged, retried next tick).
 *
 * Multi-instance: N API instances schedule N sweeps, but the per-school
 * advisory lock makes every concurrent claim after the first a cheap no-op.
 */

/** Default sweep cadence: every 4 seconds (proximity alerts are time-sensitive). */
export const DEFAULT_DELIVERY_INTERVAL_MS = 4000;
/** Default delay after boot before the first sweep. */
export const DEFAULT_DELIVERY_INITIAL_DELAY_MS = 3000;

export interface DeliveryRunnable {
  runOnce(): Promise<DeliverySweepSummary>;
}

export interface DeliverySchedulerOptions {
  intervalMs?: number;
  initialDelayMs?: number;
  enabled?: boolean;
  logger?: Logger;
}

export interface DeliveryScheduler {
  start(): void;
  stop(): Promise<void>;
  isStarted(): boolean;
}

export const DELIVERY_SCHEDULER_KEY = Symbol.for('school-bus-tracking.delivery-scheduler');

type GlobalWithScheduler = typeof globalThis & { [DELIVERY_SCHEDULER_KEY]?: DeliveryScheduler };

export function createDeliveryScheduler(
  worker: DeliveryRunnable,
  options: DeliverySchedulerOptions = {},
  logger: Logger = new Logger('NotificationDeliveryScheduler'),
): DeliveryScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_DELIVERY_INTERVAL_MS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_DELIVERY_INITIAL_DELAY_MS;

  let started = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<DeliverySweepSummary> | null = null;

  const runOnce = (): void => {
    if (inFlight) {
      logger.warn('Notification delivery sweep still in flight — skipping this tick.');
      return;
    }
    inFlight = worker
      .runOnce()
      .catch((error: unknown) => {
        logger.error(
          `Notification delivery sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          skipped: true,
          claimed: 0,
          sent: 0,
          failed: 0,
          abandoned: 0,
        } as DeliverySweepSummary;
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

  const api: DeliveryScheduler = {
    start() {
      const globalRef = globalThis as GlobalWithScheduler;
      if (globalRef[DELIVERY_SCHEDULER_KEY] && globalRef[DELIVERY_SCHEDULER_KEY] !== api) {
        logger.warn(
          'A notification delivery scheduler is already registered for this process — ignoring the duplicate start.',
        );
        return;
      }
      if (started || options.enabled === false) {
        if (options.enabled === false) {
          logger.log(
            'Notification delivery worker disabled by configuration (NOTIFICATION_OUTBOX_ENABLED=false).',
          );
        }
        return;
      }
      started = true;
      logger.log(
        `Notification delivery worker scheduled — first sweep in ${initialDelayMs}ms, then every ${intervalMs}ms.`,
      );
      initialTimer = setTimeout(() => {
        initialTimer = null;
        runOnce();
      }, initialDelayMs);
      intervalTimer = setInterval(runOnce, intervalMs);
      globalRef[DELIVERY_SCHEDULER_KEY] = api;
    },
    async stop() {
      const globalRef = globalThis as GlobalWithScheduler;
      if (globalRef[DELIVERY_SCHEDULER_KEY] === api) {
        delete globalRef[DELIVERY_SCHEDULER_KEY];
      }
      if (!started) {
        return;
      }
      started = false;
      clearTimers();
      logger.log('Notification delivery worker stopped.');
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

/** Starts the outbox scheduler for the server process (honours the env knob). */
export function startDeliveryScheduler(
  deps: { configService: ConfigService; sequelize: unknown | null },
  worker: DeliveryRunnable,
  options: DeliverySchedulerOptions = {},
): DeliveryScheduler {
  const logger = options.logger ?? new Logger('NotificationDeliveryScheduler');
  const intervalMs = deps.configService.get<number>(
    'notificationDelivery.intervalMs',
    DEFAULT_DELIVERY_INTERVAL_MS,
  );
  const initialDelayMs = deps.configService.get<number>(
    'notificationDelivery.initialDelayMs',
    DEFAULT_DELIVERY_INITIAL_DELAY_MS,
  );
  const enabled = deps.configService.get<boolean>('notificationDelivery.enabled', true);
  const scheduler = createDeliveryScheduler(
    worker,
    {
      ...options,
      intervalMs:
        options.intervalMs ??
        (Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_DELIVERY_INTERVAL_MS),
      initialDelayMs:
        options.initialDelayMs ??
        (Number.isFinite(initialDelayMs) && initialDelayMs >= 0
          ? initialDelayMs
          : DEFAULT_DELIVERY_INITIAL_DELAY_MS),
      enabled: options.enabled ?? enabled,
    },
    logger,
  );
  if (!deps.sequelize) {
    logger.warn(
      'Notification delivery scheduling skipped — this process has no database connection (stubbed bootstrap).',
    );
    return scheduler;
  }
  scheduler.start();
  return scheduler;
}

/** Stops and deregisters the outbox scheduler running for this process. */
export async function stopRegisteredDeliveryScheduler(): Promise<void> {
  const globalRef = globalThis as GlobalWithScheduler;
  const active = globalRef[DELIVERY_SCHEDULER_KEY];
  if (active) {
    await active.stop();
  }
}
