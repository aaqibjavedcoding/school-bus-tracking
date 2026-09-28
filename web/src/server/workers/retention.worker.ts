import { Logger } from '../framework';
import { ConfigService } from '../framework';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, type Transaction } from 'sequelize';

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
  /** Days to keep marketing email/click events. */
  marketingEventRetentionDays: number;
  /** Days to keep identifying lead data (then anonymized, never deleted). */
  marketingLeadRetentionDays: number;
  /** Days to keep campaign recipient PII (then anonymized in place). */
  marketingRecipientPiiRetentionDays: number;
  /** Days to keep terminal marketing notification jobs. */
  marketingNotificationJobRetentionDays: number;
  /** Days to keep provider feedback event records. */
  marketingProviderEventRetentionDays: number;
}

const DEFAULT_RETENTION: RetentionConfig = {
  locationRetentionDays: 90,
  notificationRetentionDays: 180,
  refreshTokenRetentionDays: 30,
  auditLogRetentionDays: 365,
  emergencyRetentionDays: 730,
  idempotencyKeyRetentionDays: 7,
  marketingEventRetentionDays: 365,
  marketingLeadRetentionDays: 730,
  marketingRecipientPiiRetentionDays: 180,
  marketingNotificationJobRetentionDays: 90,
  marketingProviderEventRetentionDays: 180,
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
      marketingEventRetentionDays: this.configService.get<number>(
        'retention.marketingEventDays',
        DEFAULT_RETENTION.marketingEventRetentionDays,
      ),
      marketingLeadRetentionDays: this.configService.get<number>(
        'retention.marketingLeadDays',
        DEFAULT_RETENTION.marketingLeadRetentionDays,
      ),
      marketingRecipientPiiRetentionDays: this.configService.get<number>(
        'retention.marketingRecipientPiiDays',
        DEFAULT_RETENTION.marketingRecipientPiiRetentionDays,
      ),
      marketingNotificationJobRetentionDays: this.configService.get<number>(
        'retention.marketingNotificationJobDays',
        DEFAULT_RETENTION.marketingNotificationJobRetentionDays,
      ),
      marketingProviderEventRetentionDays: this.configService.get<number>(
        'retention.marketingProviderEventDays',
        DEFAULT_RETENTION.marketingProviderEventRetentionDays,
      ),
    };
  }

  /**
   * Runs all retention cleanup jobs.
   *
   * Uses a PostgreSQL **transaction-scoped** advisory lock
   * (`pg_try_advisory_xact_lock`) so concurrent workers don't duplicate
   * cleanup. The transaction matters: a session-level
   * `pg_try_advisory_lock`/`pg_advisory_unlock` pair issued through a
   * connection *pool* can land on two different connections, silently leaking
   * the lock. Inside a transaction the lock lives on the transaction's single
   * connection and is released automatically at commit/rollback.
   */
  async runAll(): Promise<RetentionResults> {
    // Advisory lock to prevent concurrent retention runs.
    const lockKey = 9876543210;
    return this.sequelize.transaction(async (transaction) => {
      const lockResult = await this.sequelize.query<{ pg_try_advisory_xact_lock: boolean }>(
        `SELECT pg_try_advisory_xact_lock(${lockKey})`,
        { type: QueryTypes.SELECT, transaction },
      );

      if (!lockResult[0]?.pg_try_advisory_xact_lock) {
        this.logger.log('Retention worker skipped — another instance is running');
        return { skipped: true };
      }

      const results: RetentionResults = { skipped: false };

      results.locations = await this.cleanupTripLocations(transaction);
      results.notifications = await this.cleanupNotifications(transaction);
      results.refreshTokens = await this.cleanupRefreshTokens(transaction);
      results.auditLogs = await this.cleanupAuditLogs(transaction);
      results.emergencies = await this.cleanupEmergencies(transaction);
      results.idempotencyKeys = await this.cleanupIdempotencyKeys(transaction);
      results.marketingEvents = await this.cleanupMarketingEvents(transaction);
      results.marketingRecipientPii = await this.anonymizeMarketingRecipientPii(transaction);
      results.marketingLeads = await this.anonymizeMarketingLeads(transaction);
      results.marketingNotificationJobs = await this.cleanupMarketingNotificationJobs(transaction);
      results.marketingProviderEvents = await this.cleanupMarketingProviderEvents(transaction);
      results.marketingAttributions = await this.cleanupMarketingAttributions(transaction);

      this.logger.log(`Retention cleanup complete: ${JSON.stringify(results)}`);
      return results;
    });
  }

  /**
   * Cleans up old GPS trip locations.
   * This is the most important retention job because GPS data grows quickly.
   */
  async cleanupTripLocations(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.locationRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM trip_locations WHERE recorded_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(
        `Cleaned up ${count} trip locations older than ${this.config.locationRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Cleans up old notifications.
   */
  async cleanupNotifications(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.notificationRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM notifications WHERE created_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(
        `Cleaned up ${count} notifications older than ${this.config.notificationRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Cleans up expired refresh tokens.
   */
  async cleanupRefreshTokens(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.refreshTokenRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM refresh_tokens WHERE created_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(
        `Cleaned up ${count} refresh tokens older than ${this.config.refreshTokenRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Cleans up old audit logs.
   */
  async cleanupAuditLogs(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.auditLogRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM audit_logs WHERE created_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(
        `Cleaned up ${count} audit logs older than ${this.config.auditLogRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Cleans up old resolved/cancelled emergency events.
   */
  async cleanupEmergencies(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.emergencyRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM emergency_events WHERE status IN ('RESOLVED', 'CANCELLED') AND resolved_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(
        `Cleaned up ${count} resolved/cancelled emergencies older than ${this.config.emergencyRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Cleans up expired idempotency keys.
   */
  async cleanupIdempotencyKeys(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.idempotencyKeyRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM idempotency_keys WHERE expires_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired idempotency keys`);
    }
    return count;
  }

  // ------------------------------------------------------------ marketing
  //
  // The marketing policies differ from the ones above in one important way:
  // they **anonymize more than they delete**, because campaign counters,
  // consent evidence and suppression instructions have to outlive the
  // personal data they were derived from. Every statement is idempotent
  // (guarded by a marker column or a terminal status) and none of them can
  // touch work that is still owed:
  //
  // - suppression rows are never aged out — an opt-out, a hard bounce and a
  //   complaint are permanent instructions, not telemetry;
  // - `email_campaigns` counters are columns on the campaign row and are
  //   never recomputed here, so aggregate analytics survive the cleanup;
  // - only terminal recipient rows are anonymized, so a pending or retrying
  //   send can never lose the address it is about to be delivered to;
  // - only terminal notification jobs are deleted, so a pending admin
  //   notification is never dropped by retention.

  /**
   * Deletes marketing analytics events (sends, clicks, unsubscribes,
   * bounces) past the event retention window.
   *
   * The *aggregate* view of a campaign lives in `email_campaigns` counters,
   * which this never touches — so a two-year-old campaign still reports how
   * many messages it sent and how many were clicked after its per-event rows
   * are gone.
   */
  async cleanupMarketingEvents(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.marketingEventRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM email_events WHERE occurred_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(
        `Cleaned up ${count} marketing events older than ${this.config.marketingEventRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Anonymizes the contact PII of terminal campaign recipient rows.
   *
   * The row survives (it is the delivery audit record and the denominator of
   * every campaign rate); the address and display name are replaced with a
   * non-routable placeholder derived from the row id, which keeps the
   * `(campaign_id, normalized_email)` uniqueness intact. `pii_anonymized_at`
   * makes the statement idempotent — a second pass matches nothing.
   */
  async anonymizeMarketingRecipientPii(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.marketingRecipientPiiRetentionDays);
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE email_campaign_recipients
          SET normalized_email = 'redacted-' || id::text || '@invalid',
              recipient_name = NULL,
              pii_anonymized_at = NOW(),
              updated_at = NOW()
        WHERE pii_anonymized_at IS NULL
          AND created_at < $cutoff
          AND status NOT IN ('PENDING', 'PROCESSING', 'RETRYING')
        RETURNING id`,
      { bind: { cutoff }, type: QueryTypes.SELECT, transaction },
    );
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      this.logger.log(
        `Anonymized ${count} campaign recipients older than ${this.config.marketingRecipientPiiRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Anonymizes lead PII past the lead retention window and strips the
   * metadata of their timeline events.
   *
   * Same reasoning as the erasure action: the consent record and the
   * pipeline history are the evidence a retention policy is supposed to
   * leave behind; the name, address, phone and free text are what it is
   * supposed to remove.
   */
  async anonymizeMarketingLeads(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.marketingLeadRetentionDays);
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE marketing_leads
          SET full_name = '[erased]',
              normalized_email = 'erased-' || id::text || '@invalid',
              institution_name = NULL,
              phone = NULL,
              city = NULL,
              country = NULL,
              message = NULL,
              preferred_contact_time = NULL,
              utm = NULL,
              submission_fingerprint = NULL,
              erased_at = NOW(),
              updated_at = NOW()
        WHERE erased_at IS NULL
          AND created_at < $cutoff
        RETURNING id`,
      { bind: { cutoff }, type: QueryTypes.SELECT, transaction },
    );
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      await this.sequelize.query(
        `UPDATE marketing_lead_events
            SET metadata = NULL
          WHERE metadata IS NOT NULL
            AND created_at < $cutoff`,
        { bind: { cutoff }, type: QueryTypes.UPDATE, transaction },
      );
      this.logger.log(
        `Anonymized ${count} marketing leads older than ${this.config.marketingLeadRetentionDays} days`,
      );
    }
    return count;
  }

  /**
   * Deletes **terminal** notification jobs only.
   *
   * A `PENDING`, `RETRYING` or `PROCESSING` job is work the platform still
   * owes an operator; retention must never be able to silently drop it,
   * however old it looks.
   */
  async cleanupMarketingNotificationJobs(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.marketingNotificationJobRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM marketing_notification_jobs
        WHERE status IN ('SENT', 'FAILED', 'EXPIRED')
          AND created_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} terminal marketing notification jobs`);
    }
    return count;
  }

  /** Deletes stored provider feedback events past their window. */
  async cleanupMarketingProviderEvents(transaction?: Transaction): Promise<number> {
    const cutoff = this.cutoffDate(this.config.marketingProviderEventRetentionDays);
    const count = await this.deleteOldRows(
      `DELETE FROM marketing_provider_events WHERE received_at < $cutoff`,
      cutoff,
      transaction,
    );
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} marketing provider events`);
    }
    return count;
  }

  /**
   * Drops expired attribution grants.
   *
   * These are pure click-tracking material with a 30-day lifetime; once the
   * grant has expired it can never attribute anything again, so keeping it
   * would only retain a correlation between a recipient and a browser.
   */
  async cleanupMarketingAttributions(transaction?: Transaction): Promise<number> {
    const count = await this.deleteOldRows(
      `DELETE FROM marketing_attributions WHERE expires_at < $cutoff`,
      new Date(),
      transaction,
    );
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired marketing attribution grants`);
    }
    return count;
  }

  /**
   * Runs one policy DELETE and returns the number of rows it removed.
   *
   * `RETURNING id` + `QueryTypes.SELECT` is deliberate: Sequelize's Postgres
   * dialect returns `[]` (no rowCount metadata) for `QueryTypes.DELETE`, so
   * the affected-row count would silently read as 0 and every cleanup log
   * would lie. Returning the deleted ids makes the count real and keeps the
   * query inside the caller's transaction.
   */
  private async deleteOldRows(
    sql: string,
    cutoff: Date,
    transaction?: Transaction,
  ): Promise<number> {
    const deleted = await this.sequelize.query<{ id: string }>(`${sql} RETURNING id`, {
      bind: { cutoff },
      type: QueryTypes.SELECT,
      transaction,
    });
    const count = Array.isArray(deleted) ? deleted.length : 0;
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
  marketingEvents?: number;
  marketingRecipientPii?: number;
  marketingLeads?: number;
  marketingNotificationJobs?: number;
  marketingProviderEvents?: number;
  marketingAttributions?: number;
}
