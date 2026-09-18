import { registerAs } from '../framework';

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Outbox delivery workflow configuration (Phase 2).
 *
 * The worker runs inside the API server process (same model as the retention
 * worker) and claims rows with a per-school advisory lock, so any number of
 * instances stay safe without a queue service.
 *
 *   NOTIFICATION_OUTBOX_ENABLED            false → never schedule (default on)
 *   NOTIFICATION_OUTBOX_INTERVAL_MS        sweep cadence (default 4000)
 *   NOTIFICATION_OUTBOX_INITIAL_DELAY_MS   delay before the first sweep (default 3000)
 *   NOTIFICATION_OUTBOX_BATCH_SIZE         rows processed per sweep (default 50)
 *
 * Delivery policy (exponential backoff + event expiry):
 *
 *   NOTIFICATION_DELIVERY_MAX_ATTEMPTS     upper bound after which a still-failing
 *                                          row is abandoned (default 8)
 *   NOTIFICATION_DELIVERY_BASE_BACKOFF_MS  first retry delay; doubles per attempt
 *                                          (default 2000, max 90s)
 *   NOTIFICATION_DELIVERY_EXPIRY_MS        how long after creation a proximity /
 *                                          attendance alert stays deliverable,
 *                                          regardless of schedule (default 10 min;
 *                                          stop-arrival alerts additionally drop
 *                                          once the trip is no longer tracking)
 */
export default registerAs('notificationDelivery', () => ({
  enabled: process.env.NOTIFICATION_OUTBOX_ENABLED?.trim().toLowerCase() !== 'false',
  intervalMs: positiveInt(process.env.NOTIFICATION_OUTBOX_INTERVAL_MS, 4000),
  initialDelayMs: positiveInt(process.env.NOTIFICATION_OUTBOX_INITIAL_DELAY_MS, 3000),
  batchSize: positiveInt(process.env.NOTIFICATION_OUTBOX_BATCH_SIZE, 50),
  maxAttempts: positiveInt(process.env.NOTIFICATION_DELIVERY_MAX_ATTEMPTS, 8),
  baseBackoffMs: positiveInt(process.env.NOTIFICATION_DELIVERY_BASE_BACKOFF_MS, 2000),
  expiryMs: positiveInt(process.env.NOTIFICATION_DELIVERY_EXPIRY_MS, 10 * 60 * 1000),
}));
