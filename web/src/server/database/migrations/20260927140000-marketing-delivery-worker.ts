'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Session 3 — durable marketing delivery.
 *
 * Three groups of changes, all additive:
 *
 * 1. **`email_campaign_recipients` becomes a real queue.** The Session 1
 *    table already had `status` / `attempts` / `next_attempt_at`; what a
 *    crash-safe worker needs on top is a *lease*: who claimed the row
 *    (`locked_by`), when the claim expires (`lease_expires_at`) and when the
 *    last attempt happened. A `PROCESSING` row whose lease has passed is
 *    claimable again — that single fact is what makes a killed container,
 *    a redeploy mid-send or an OOM recoverable without a human.
 *
 *    Engagement is counted here too (`click_count`, `first_clicked_at`,
 *    `unsubscribed_at`) rather than only in `email_events`, because "unique
 *    clicks" must be answerable without scanning the event log, and because
 *    `first_clicked_at IS NULL` is the condition that makes a repeat click
 *    idempotent for the unique counter.
 *
 * 2. **`email_campaigns` gets the rest of its progress counters.** The
 *    Session 1 row carried `sent`/`failed`/`clicked`/`unsubscribed`; the
 *    console also has to show queued, processing, retrying, suppressed,
 *    skipped, cancelled and expired, plus total (non-unique) clicks. Every
 *    counter is recomputed by aggregating the recipient rows — never
 *    incremented in place — so a worker retry or restart cannot double-count
 *    and no counter can drift negative.
 *
 * 3. **`idempotency_keys.school_id` becomes nullable.** Platform-level
 *    SUPER_ADMIN records have no tenant, so the old `NOT NULL` column made
 *    idempotency silently inapplicable to every marketing mutation. `NULL`
 *    is now the explicit platform scope, and the unique lookup index is
 *    replaced by two partial indexes — one per scope — because in
 *    PostgreSQL `NULL != NULL`, so a plain unique index over a nullable
 *    column would stop deduplicating exactly where it is needed most.
 */

/** Recipient columns added by this migration. */
const RECIPIENT_COLUMNS = {
  school_name: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: 'School name frozen at snapshot time; rendering never reads live school data.',
  },
  locked_by: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'Worker instance id holding the current claim (never a secret).',
  },
  lease_expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Claim deadline; a PROCESSING row past it is recoverable.',
  },
  last_attempt_at: { type: DataTypes.DATE, allowNull: true },
  click_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  first_clicked_at: { type: DataTypes.DATE, allowNull: true },
  unsubscribed_at: { type: DataTypes.DATE, allowNull: true },
} as const;

/** Campaign counter columns added by this migration. */
const CAMPAIGN_COUNTERS = [
  'queued_count',
  'processing_count',
  'retrying_count',
  'suppressed_count',
  'skipped_count',
  'cancelled_count',
  'expired_count',
  'total_click_count',
] as const;

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const [name, definition] of Object.entries(RECIPIENT_COLUMNS)) {
      await queryInterface.addColumn('email_campaign_recipients', name, definition, {
        transaction,
      });
    }

    // The lease-recovery scan: claimed rows whose lease has passed.
    await queryInterface.addIndex('email_campaign_recipients', {
      name: 'idx_email_campaign_recipients_lease',
      fields: ['status', 'lease_expires_at'],
      transaction,
    });

    for (const name of CAMPAIGN_COUNTERS) {
      await queryInterface.addColumn(
        'email_campaigns',
        name,
        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        { transaction },
      );
    }

    // Existing rows: everything that was snapshotted and not yet terminal is
    // queued. (Session 2 could only produce DRAFT/SCHEDULED campaigns, so in
    // practice this is `recipient_count` for scheduled ones and 0 otherwise.)
    await queryInterface.sequelize.query(
      `UPDATE email_campaigns
          SET queued_count = GREATEST(recipient_count - sent_count - failed_count, 0)`,
      { transaction },
    );

    // ---- platform-scoped idempotency ------------------------------------
    await queryInterface.removeIndex('idempotency_keys', 'idempotency_keys_unique_lookup', {
      transaction,
    });
    await queryInterface.changeColumn(
      'idempotency_keys',
      'school_id',
      {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'NULL is the explicit platform (SUPER_ADMIN) scope.',
      },
      { transaction },
    );
    // Tenant scope: one result per (school, user, endpoint, key). Written as
    // raw SQL because the predicate is what makes the pair of indexes correct
    // and it must be unambiguous.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX idempotency_keys_unique_lookup
         ON idempotency_keys (school_id, user_id, endpoint, idempotency_key)
       WHERE school_id IS NOT NULL`,
      { transaction },
    );
    // Platform scope: `NULL != NULL` in PostgreSQL, so the tenant index above
    // would never deduplicate platform rows. A second partial index keyed
    // only on (user, endpoint, key) does.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX idempotency_keys_unique_platform_lookup
         ON idempotency_keys (user_id, endpoint, idempotency_key)
       WHERE school_id IS NULL`,
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS idempotency_keys_unique_platform_lookup`,
      { transaction },
    );
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idempotency_keys_unique_lookup`, {
      transaction,
    });
    // Platform rows cannot survive a NOT NULL column.
    await queryInterface.sequelize.query(`DELETE FROM idempotency_keys WHERE school_id IS NULL`, {
      transaction,
    });
    await queryInterface.changeColumn(
      'idempotency_keys',
      'school_id',
      {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      { transaction },
    );
    await queryInterface.addIndex('idempotency_keys', {
      name: 'idempotency_keys_unique_lookup',
      fields: ['school_id', 'user_id', 'endpoint', 'idempotency_key'],
      unique: true,
      transaction,
    });

    for (const name of CAMPAIGN_COUNTERS) {
      await queryInterface.removeColumn('email_campaigns', name, { transaction });
    }
    await queryInterface.removeIndex(
      'email_campaign_recipients',
      'idx_email_campaign_recipients_lease',
      { transaction },
    );
    for (const name of Object.keys(RECIPIENT_COLUMNS)) {
      await queryInterface.removeColumn('email_campaign_recipients', name, { transaction });
    }
  });
}
