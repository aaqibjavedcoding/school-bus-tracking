import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Sequelize } from 'sequelize-typescript';
import type { Transaction } from 'sequelize';
import { ConfigService } from '../framework';
import { RetentionWorker, type RetentionResults } from './retention.worker';

/**
 * The worker's SQL is verified against the real engine by nothing yet (the
 * integration suite truncates tables directly), so these specs pin the parts
 * a mock can prove: the transaction-scoped advisory lock is acquired and
 * released on the *transaction*, every policy DELETE runs inside that
 * transaction, a not-acquired lock skips the whole pass without deleting
 * anything, and the configured day counts drive the cutoffs.
 */

interface Query {
  sql: string;
  options: { transaction?: Transaction; bind?: Record<string, unknown> };
}

function makeSequelize(handlers: {
  /** Return value for the lock probe; defaults to acquired. */
  lockAcquired?: boolean;
  /** Rows "deleted" per table (the RETURNING id rows), keyed by table name. */
  deletedRows?: Record<string, Array<{ id: string }>>;
  /** Rows "updated" per table for the anonymization policies. */
  updatedRows?: Record<string, Array<{ id: string }>>;
  /** Reject the transaction callback (simulating a failed DELETE). */
  failQuery?: RegExp;
}) {
  const queries: Query[] = [];
  let transactionCommitted = false;
  let transactionRolledBack = false;

  const transaction = {
    commit: async () => {
      transactionCommitted = true;
    },
    rollback: async () => {
      transactionRolledBack = true;
    },
  } as unknown as Transaction;

  const sequelize = {
    queries,
    transactionCommitted: () => transactionCommitted,
    transactionRolledBack: () => transactionRolledBack,
    async query(sql: string, options: Query['options'] = {}) {
      queries.push({ sql, options });
      if (handlers.failQuery && handlers.failQuery.test(sql)) {
        throw new Error(`boom: ${sql}`);
      }
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return [{ pg_try_advisory_xact_lock: handlers.lockAcquired ?? true }];
      }
      // The worker appends `RETURNING id` and counts the returned rows.
      const deleted = /DELETE FROM (\w+)/.exec(sql)?.[1];
      if (deleted) {
        return handlers.deletedRows?.[deleted] ?? [];
      }
      // The marketing policies anonymize in place: `UPDATE … RETURNING id`.
      const updated = /UPDATE\s+(\w+)/.exec(sql)?.[1];
      if (updated) {
        return handlers.updatedRows?.[updated] ?? [];
      }
      return [];
    },
    async transaction<T>(callback: (t: Transaction) => Promise<T>): Promise<T> {
      // Sequelize commits when the callback resolves, rolls back on throw.
      try {
        const value = await callback(transaction);
        await transaction.commit();
        return value;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
  } as unknown as Sequelize & {
    queries: Query[];
    transactionCommitted: () => boolean;
    transactionRolledBack: () => boolean;
  };

  return {
    sequelize,
    queries,
    transactionCommitted: () => transactionCommitted,
    transactionRolledBack: () => transactionRolledBack,
  };
}

function makeWorker(sequelize: Sequelize, config: Record<string, unknown> = {}): RetentionWorker {
  const configService = new ConfigService({ retention: config });
  return new RetentionWorker(configService, sequelize);
}

describe('RetentionWorker', () => {
  it('runs every policy delete inside one transaction-scoped advisory lock', async () => {
    const db = makeSequelize({
      deletedRows: {
        trip_locations: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        notifications: [{ id: 'a' }, { id: 'b' }],
        refresh_tokens: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      },
    });
    const worker = makeWorker(db.sequelize);

    const results: RetentionResults = await worker.runAll();

    assert.equal(results.skipped, false);
    assert.equal(results.locations, 3);
    assert.equal(results.notifications, 2);
    assert.equal(results.refreshTokens, 5);
    assert.equal(results.auditLogs, 0);
    assert.equal(results.emergencies, 0);
    assert.equal(results.idempotencyKeys, 0);

    // Lock acquired on the transaction, released by the COMMIT (no session
    // unlock query that could land on a different pool connection).
    const lock = db.queries.find((q) => q.sql.includes('pg_try_advisory_xact_lock'));
    assert.ok(lock, 'the transaction-scoped lock must be probed');
    assert.ok(lock.options.transaction, 'the lock probe must run on the transaction');
    assert.equal(db.transactionCommitted(), true);
    assert.equal(
      db.queries.some((q) => q.sql.includes('pg_advisory_unlock')),
      false,
      'the session-level unlock must not be used',
    );

    // All six policy deletes ran, all on the same transaction.
    const tables = [
      'trip_locations',
      'notifications',
      'refresh_tokens',
      'audit_logs',
      'emergency_events',
      'idempotency_keys',
    ];
    for (const table of tables) {
      const del = db.queries.find((q) => q.sql.startsWith(`DELETE FROM ${table}`));
      assert.ok(del, `a DELETE for ${table} must run`);
      assert.equal(del.options.transaction, lock.options.transaction);
    }
  });

  it('skips the whole pass when another instance holds the lock', async () => {
    const db = makeSequelize({ lockAcquired: false });
    const worker = makeWorker(db.sequelize);

    const results = await worker.runAll();

    assert.deepEqual(results, { skipped: true });
    assert.equal(
      db.queries.some((q) => q.sql.startsWith('DELETE FROM')),
      false,
      'no delete may run when the lock is not acquired',
    );
    assert.equal(db.transactionCommitted(), true);
  });

  it('derives the cutoffs from the configured retention days', async () => {
    const db = makeSequelize({});
    const worker = makeWorker(db.sequelize, { locationDays: 45, idempotencyKeyDays: 1 });

    await worker.runAll();

    const locations = db.queries.find((q) => q.sql.startsWith('DELETE FROM trip_locations'));
    const cutoff = locations?.options.bind?.cutoff as Date;
    const expected = new Date();
    expected.setDate(expected.getDate() - 45);
    assert.ok(cutoff instanceof Date);
    assert.ok(
      Math.abs(cutoff.getTime() - expected.getTime()) < 5_000,
      'the location cutoff must be 45 days back',
    );

    const keys = db.queries.find((q) => q.sql.startsWith('DELETE FROM idempotency_keys'));
    assert.match(String(keys?.sql), /expires_at/, 'idempotency keys expire by TTL column');
  });

  it('propagates a failing delete after rolling the transaction back', async () => {
    const db = makeSequelize({ failQuery: /DELETE FROM notifications/ });
    const worker = makeWorker(db.sequelize);

    await assert.rejects(worker.runAll(), /boom: DELETE FROM notifications/);
    assert.equal(db.transactionRolledBack(), true);
    assert.equal(db.transactionCommitted(), false);
  });

  it('resolves the retention policies from the environment-derived config', () => {
    const db = makeSequelize({});
    const worker = makeWorker(db.sequelize, {
      locationDays: 30,
      notificationDays: 60,
      refreshTokenDays: 14,
      auditLogDays: 180,
      emergencyDays: 365,
      idempotencyKeyDays: 2,
    });
    // The config snapshot is private; assert it through the cutoff maths.
    const cutoff = worker['cutoffDate'](30);
    const expected = new Date();
    expected.setDate(expected.getDate() - 30);
    assert.ok(Math.abs(cutoff.getTime() - expected.getTime()) < 5_000);
  });
});

/**
 * The Hardening 5B marketing policies.
 *
 * These differ from the ones above in kind, not just in table: they
 * **anonymize more than they delete**, because consent evidence, campaign
 * counters and suppression instructions have to outlive the personal data
 * they were derived from. The assertions below are the promises that
 * distinguish a retention policy from data loss.
 */
describe('RetentionWorker — marketing policies', () => {
  const MARKETING_CONFIG = {
    marketingEventDays: 365,
    marketingLeadDays: 730,
    marketingRecipientPiiDays: 180,
    marketingNotificationJobDays: 90,
    marketingProviderEventDays: 180,
  };

  it('runs every marketing policy inside the same locked transaction', async () => {
    const db = makeSequelize({
      deletedRows: {
        email_events: [{ id: 'a' }, { id: 'b' }],
        marketing_notification_jobs: [{ id: 'a' }],
        marketing_provider_events: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        marketing_attributions: [{ id: 'a' }],
      },
      updatedRows: {
        email_campaign_recipients: [{ id: 'a' }, { id: 'b' }],
        marketing_leads: [{ id: 'a' }],
      },
    });
    const worker = makeWorker(db.sequelize, MARKETING_CONFIG);

    const results = await worker.runAll();

    assert.equal(results.marketingEvents, 2);
    assert.equal(results.marketingRecipientPii, 2);
    assert.equal(results.marketingLeads, 1);
    assert.equal(results.marketingNotificationJobs, 1);
    assert.equal(results.marketingProviderEvents, 3);
    assert.equal(results.marketingAttributions, 1);

    const lock = db.queries.find((q) => q.sql.includes('pg_try_advisory_xact_lock'));
    for (const query of db.queries) {
      assert.equal(
        query.options.transaction,
        lock?.options.transaction,
        'no marketing statement may escape the advisory-locked transaction',
      );
    }
  });

  it('never deletes a suppression — an opt-out is an instruction, not telemetry', async () => {
    const db = makeSequelize({});
    await makeWorker(db.sequelize, MARKETING_CONFIG).runAll();

    assert.equal(
      db.queries.some((q) => /marketing_suppressions/.test(q.sql)),
      false,
      'the retention worker must not touch the suppression list at all',
    );
  });

  it('never drops campaign work that is still owed', async () => {
    const db = makeSequelize({});
    await makeWorker(db.sequelize, MARKETING_CONFIG).runAll();

    const recipients = db.queries.find((q) =>
      q.sql.startsWith('UPDATE email_campaign_recipients'),
    );
    assert.ok(recipients);
    assert.match(
      String(recipients.sql),
      /status NOT IN \('PENDING', 'PROCESSING', 'RETRYING'\)/,
      'an unsent recipient must keep the address it is about to be delivered to',
    );

    const jobs = db.queries.find((q) => q.sql.startsWith('DELETE FROM marketing_notification_jobs'));
    assert.ok(jobs);
    assert.match(
      String(jobs.sql),
      /status IN \('SENT', 'FAILED', 'EXPIRED'\)/,
      'a pending admin notification is never dropped by retention',
    );
  });

  it('is idempotent: both anonymization passes are guarded by their marker', async () => {
    const db = makeSequelize({});
    await makeWorker(db.sequelize, MARKETING_CONFIG).runAll();

    const recipients = db.queries.find((q) =>
      q.sql.startsWith('UPDATE email_campaign_recipients'),
    );
    assert.match(String(recipients?.sql), /pii_anonymized_at IS NULL/);
    const leads = db.queries.find((q) => q.sql.startsWith('UPDATE marketing_leads'));
    assert.match(String(leads?.sql), /erased_at IS NULL/);
  });

  it('anonymizes rather than deletes leads and recipients, preserving the evidence', async () => {
    const db = makeSequelize({ updatedRows: { marketing_leads: [{ id: 'a' }] } });
    await makeWorker(db.sequelize, MARKETING_CONFIG).runAll();

    assert.equal(
      db.queries.some((q) => q.sql.startsWith('DELETE FROM marketing_leads')),
      false,
      'the consent record must survive its personal data',
    );
    assert.equal(
      db.queries.some((q) => q.sql.startsWith('DELETE FROM email_campaign_recipients')),
      false,
      'recipient rows are the denominator of every campaign rate',
    );

    const leads = db.queries.find((q) => q.sql.startsWith('UPDATE marketing_leads'));
    for (const field of ['full_name', 'phone', 'message', 'utm', 'submission_fingerprint']) {
      assert.match(String(leads?.sql), new RegExp(field), `${field} is cleared`);
    }
    assert.match(String(leads?.sql), /@invalid/, 'the placeholder address is non-routable');

    // The timeline metadata of anonymized leads is stripped too.
    assert.ok(
      db.queries.some((q) => /UPDATE marketing_lead_events/.test(q.sql)),
      'free text in lead events is removed with the lead',
    );
  });

  it('never recomputes or clears a campaign counter', async () => {
    const db = makeSequelize({});
    await makeWorker(db.sequelize, MARKETING_CONFIG).runAll();

    assert.equal(
      db.queries.some((q) => /UPDATE email_campaigns|DELETE FROM email_campaigns/.test(q.sql)),
      false,
      'aggregate analytics outlive the per-event rows they were derived from',
    );
  });

  it('derives each marketing cutoff from its own configured window', async () => {
    const db = makeSequelize({});
    await makeWorker(db.sequelize, { ...MARKETING_CONFIG, marketingEventDays: 10 }).runAll();

    const events = db.queries.find((q) => q.sql.startsWith('DELETE FROM email_events'));
    const cutoff = events?.options.bind?.cutoff as Date;
    const expected = new Date();
    expected.setDate(expected.getDate() - 10);
    assert.ok(Math.abs(cutoff.getTime() - expected.getTime()) < 5_000);

    const attributions = db.queries.find((q) =>
      q.sql.startsWith('DELETE FROM marketing_attributions'),
    );
    assert.match(
      String(attributions?.sql),
      /expires_at < \$cutoff/,
      'attribution grants age out on their own expiry, not a day count',
    );
  });
});
