import { registerAs } from '../framework';

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Data-retention policies plus the scheduling knobs of the in-process
 * retention worker (`server.js` starts it after the database bootstrap — see
 * `retention.scheduler.ts`).
 *
 * Policies (rows older than N days are deleted):
 *
 * ```text
 * LOCATION_RETENTION_DAYS         GPS trip locations        (default 90)
 * NOTIFICATION_RETENTION_DAYS     notifications             (default 180)
 * REFRESH_TOKEN_RETENTION_DAYS    expired refresh tokens    (default 30)
 * AUDIT_LOG_RETENTION_DAYS        audit logs                (default 365)
 * EMERGENCY_RETENTION_DAYS        resolved emergencies      (default 730)
 * IDEMPOTENCY_KEY_RETENTION_DAYS  expired idempotency keys  (default 7)
 * ```
 *
 * Cadence:
 *
 * ```text
 * RETENTION_ENABLED               set `false` to never schedule (default on)
 * RETENTION_INTERVAL_MS           pass cadence                (default 6h)
 * RETENTION_INITIAL_DELAY_MS      delay before the first pass (default 30s)
 * ```
 */
export default registerAs('retention', () => ({
  enabled: process.env.RETENTION_ENABLED?.trim().toLowerCase() !== 'false',
  /** The scheduler is also seeded with these two: */
  intervalMs: positiveInt(process.env.RETENTION_INTERVAL_MS, 6 * 60 * 60 * 1000),
  initialDelayMs: positiveInt(process.env.RETENTION_INITIAL_DELAY_MS, 30_000),
  locationDays: positiveInt(process.env.LOCATION_RETENTION_DAYS, 90),
  notificationDays: positiveInt(process.env.NOTIFICATION_RETENTION_DAYS, 180),
  refreshTokenDays: positiveInt(process.env.REFRESH_TOKEN_RETENTION_DAYS, 30),
  auditLogDays: positiveInt(process.env.AUDIT_LOG_RETENTION_DAYS, 365),
  emergencyDays: positiveInt(process.env.EMERGENCY_RETENTION_DAYS, 730),
  idempotencyKeyDays: positiveInt(process.env.IDEMPOTENCY_KEY_RETENTION_DAYS, 7),
}));
