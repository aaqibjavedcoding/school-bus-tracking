import { Logger } from '../framework';
import { ConfigService } from '../framework';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';

/**
 * Data retention configuration.
 */
export interface RetentionConfig {
  /** Days to keep GPS location data. */
  locationRetentionDays: number;
  /** Days to keep notifications. */
  notificationRetentionDays: number;
  /** Days to keep expired refresh tokens. */
  refreshTokenRetentionDays: number;
  /** Days to keep audit logs. */
  auditLogRetentionDays: number;
  /** Days to keep resolved/cancelled emergency events. */
  emergencyRetentionDays: number;
  /** Days to keep expired idempotency keys. */
  idempotencyKeyRetentionDays: number;
}

const DEFAULT_RETENTION: RetentionConfig = {
  locationRetentionDays: 90,
  notificationRetentionDays: 180,
  refreshTokenRetentionDays: 30,
  auditLogRetentionDays: 365,
  emergencyRetentionDays: 730,
  idempotencyKeyRetentionDays: 7,
};

/**
 * PostgreSQL-backed data retention worker.
 *
 * Cleans up old data to prevent unbounded growth, especially:
 * - GPS trip locations (can grow quickly)
 * - Old notifications
 * - Expired refresh tokens
 * - Old audit logs
 * - Resolved emergency events
 * - Expired idempotency keys
 *
 * Uses PostgreSQL for locking (advisory locks) so concurrent workers
 * don't duplicate cleanup.
 *
 * Configuration via environment variables:
 * - LOCATION_RETENTION_DAYS (default: 90)
 * - NOTIFICATION_RETENTION_DAYS (default: 180)
 * - REFRESH_TOKEN_RETENTION_DAYS (default: 30)
 * - AUDIT_LOG_RETENTION_DAYS (default: 365)
 * - EMERGENCY_RETENTION_DAYS (default: 730)
 * - IDEMPOTENCY_KEY_RETENTION_DAYS (default: 7)
 */
export class RetentionWorker {
  private readonly logger = new Logger(RetentionWorker.name);
  private readonly config: RetentionConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly sequelize: Sequelize,
  ) {
    this.config = {
      locationRetentionDays: this.configService.get<number>(
        'retention.locationDays',
        DEFAULT_RETENTION.locationRetentionDays,
      ),
      notificationRetentionDays: this.configService.get<number>(
        'retention.notificationDays',
        DEFAULT_RETENTION.notificationRetentionDays,
      ),
      refreshTokenRetentionDays: this.configService.get<number>(
        'retention.refreshTokenDays',
        DEFAULT_RETENTION.refreshTokenRetentionDays,
      ),
      auditLogRetentionDays: this.configService.get<number>(
        'retention.auditLogDays',
        DEFAULT_RETENTION.auditLogRetentionDays,
      ),
      emergencyRetentionDays: this.configService.get<number>(
        'retention.emergencyDays',
        DEFAULT_RETENTION.emergencyRetentionDays,
      ),
      idempotencyKeyRetentionDays: this.configService.get<number>(
        'retention.idempotencyKeyDays',
        DEFAULT_RETENTION.idempotencyKeyRetentionDays,
      ),
    };
  }

  /**
   * Runs all retention cleanup jobs.
   * Uses advisory lock to prevent concurrent execution.
   */
  async runAll(): Promise<RetentionResults> {
    // Advisory lock to prevent concurrent retention runs.
    const lockKey = 9876543210;
    const lockResult = await this.sequelize.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock(${lockKey})`,
      { type: QueryTypes.SELECT },
    );

    if (!lockResult[0]?.pg_try_advisory_lock) {
      this.logger.log('Retention worker skipped — another instance is running');
      return { skipped: true };
    }

    try {
      const results: RetentionResults = { skipped: false };

      results.locations = await this.cleanupTripLocations();
      results.notifications = await this.cleanupNotifications();
      results.refreshTokens = await this.cleanupRefreshTokens();
      results.auditLogs = await this.cleanupAuditLogs();
      results.emergencies = await this.cleanupEmergencies();
      results.idempotencyKeys = await this.cleanupIdempotencyKeys();

      this.logger.log(`Retention cleanup complete: ${JSON.stringify(results)}`);
      return results;
    } finally {
      await this.sequelize.query(`SELECT pg_advisory_unlock(${lockKey})`, {
        type: QueryTypes.SELECT,
      });
    }
  }

  /**
   * Cleans up old GPS trip locations.
   * This is the most important retention job because GPS data grows quickly.
   */
  async cleanupTripLocations(): Promise<number> {
    const cutoff = this.cutoffDate(this.config.locationRetentionDays);
    const result = await this.sequelize.query(
      `DELETE FROM trip_locations WHERE recorded_at < $cutoff`,
      { bind: { cutoff }, type: QueryTypes.DELETE },
    );
    const count = (result as unknown as [unknown, { rowCount: number }])[1]?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} trip locations older than ${this.config.locationRetentionDays} days`);
    }
    return count;
  }

  /**
   * Cleans up old notifications.
   */
  async cleanupNotifications(): Promise<number> {
    const cutoff = this.cutoffDate(this.config.notificationRetentionDays);
    const result = await this.sequelize.query(
      `DELETE FROM notifications WHERE created_at < $cutoff`,
      { bind: { cutoff }, type: QueryTypes.DELETE },
    );
    const count = (result as unknown as [unknown, { rowCount: number }])[1]?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} notifications older than ${this.config.notificationRetentionDays} days`);
    }
    return count;
  }

  /**
   * Cleans up expired refresh tokens.
   */
  async cleanupRefreshTokens(): Promise<number> {
    const cutoff = this.cutoffDate(this.config.refreshTokenRetentionDays);
    const result = await this.sequelize.query(
      `DELETE FROM refresh_tokens WHERE created_at < $cutoff`,
      { bind: { cutoff }, type: QueryTypes.DELETE },
    );
    const count = (result as unknown as [unknown, { rowCount: number }])[1]?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} refresh tokens older than ${this.config.refreshTokenRetentionDays} days`);
    }
    return count;
  }

  /**
   * Cleans up old audit logs.
   */
  async cleanupAuditLogs(): Promise<number> {
    const cutoff = this.cutoffDate(this.config.auditLogRetentionDays);
    const result = await this.sequelize.query(
      `DELETE FROM audit_logs WHERE created_at < $cutoff`,
      { bind: { cutoff }, type: QueryTypes.DELETE },
    );
    const count = (result as unknown as [unknown, { rowCount: number }])[1]?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} audit logs older than ${this.config.auditLogRetentionDays} days`);
    }
    return count;
  }

  /**
   * Cleans up old resolved/cancelled emergency events.
   */
  async cleanupEmergencies(): Promise<number> {
    const cutoff = this.cutoffDate(this.config.emergencyRetentionDays);
    const result = await this.sequelize.query(
      `DELETE FROM emergency_events WHERE status IN ('RESOLVED', 'CANCELLED') AND resolved_at < $cutoff`,
      { bind: { cutoff }, type: QueryTypes.DELETE },
    );
    const count = (result as unknown as [unknown, { rowCount: number }])[1]?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} resolved/cancelled emergencies older than ${this.config.emergencyRetentionDays} days`);
    }
    return count;
  }

  /**
   * Cleans up expired idempotency keys.
   */
  async cleanupIdempotencyKeys(): Promise<number> {
    const cutoff = this.cutoffDate(this.config.idempotencyKeyRetentionDays);
    const result = await this.sequelize.query(
      `DELETE FROM idempotency_keys WHERE expires_at < $cutoff`,
      { bind: { cutoff }, type: QueryTypes.DELETE },
    );
    const count = (result as unknown as [unknown, { rowCount: number }])[1]?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired idempotency keys`);
    }
    return count;
  }
  private cutoffDate(days: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff;
  }
}

export interface RetentionResults {
  skipped: boolean;
  locations?: number;
  notifications?: number;
  refreshTokens?: number;
  auditLogs?: number;
  emergencies?: number;
  idempotencyKeys?: number;
}
