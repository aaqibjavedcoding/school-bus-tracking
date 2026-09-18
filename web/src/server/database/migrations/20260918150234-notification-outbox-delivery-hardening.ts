'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Phase 2 — durable push delivery (database-backed outbox) over the existing
 * `notifications` table. No new tables and no new dependencies: the durable
 * "job" is the notification row itself, and the in-process delivery worker
 * (see `web/src/server/modules/notifications/outbox/`) claims rows with a
 * resort-free per-school advisory lock exactly like the retention worker.
 *
 * Columns added (owned by the delivery pipeline, never by the reads):
 *
 * - `push_expires_at`           event-specific expiry — a proximity/attendance
 *                               alert is only meaningful for a bounded window,
 *                               so the worker abandons a row whose deadline
 *                               passed instead of delivering "Bus near stop"
 *                               minutes after the trip ended;
 * - `delivered_tokens`          string[] of device tokens the provider
 *                               *accepted* the message for (per-device,
 *                               honest partial-success tracking — never a
 *                               claim of on-device display);
 * - `delivery_failure_kind`     `transient` (retry with backoff) vs
 *                               `permanent` (abandon, e.g. provider refused
 *                               every token / payload invalid);
 * - `delivery_abandoned_reason` short reason when the outbox stopped trying;
 * - `next_attempt_at`           due clock of the outbox sweep; backfilled to
 *                               NOW() so legacy `pending` rows leave the
 *                               wire-once window and become durable jobs;
 * - `dedup_key`                 stable natural key of the event
 *                               (`<type>:<trip>:<student>:<stop>`), backing
 *                               the unique index below.
 *
 * Indexes:
 * - `idx_notifications_outbox_school` drives the per-school claim loop (the
 *   advisory lock is keyed by `school_id`), ordered by `next_attempt_at`;
 * - `idx_notifications_outbox_due` keeps a plain global "what is due now"
 *   lookup available for diagnostics;
 * - `uq_notifications_dedup` enforces at most one row per
 *   `(school_id, user_id, dedup_key)` — the database-level idempotency
 *   backstop, so a retried event idempotency re-check can never insert two
 *   rows even under a concurrent race.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn('notifications', 'push_expires_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('notifications', 'delivered_tokens', {
      type: DataTypes.ARRAY(DataTypes.STRING(1024)),
      allowNull: true,
    });
    await queryInterface.addColumn('notifications', 'delivery_failure_kind', {
      type: DataTypes.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn('notifications', 'delivery_abandoned_reason', {
      type: DataTypes.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('notifications', 'next_attempt_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('notifications', 'dedup_key', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });

    await queryInterface.addIndex(
      'notifications',
      ['school_id', 'email_status', 'push_status', 'next_attempt_at'],
      { name: 'idx_notifications_outbox_school', transaction },
    );
    await queryInterface.addIndex('notifications', ['push_status', 'next_attempt_at'], {
      name: 'idx_notifications_outbox_due',
      transaction,
    });
    await queryInterface.addIndex('notifications', ['school_id', 'user_id', 'dedup_key'], {
      name: 'uq_notifications_dedup',
      unique: true,
      where: { deleted_at: null, dedup_key: { [Op.ne]: null } },
      transaction,
    });

    // Legacy rows (wire-once delivery) become valid outbox jobs due now.
    await queryInterface.sequelize.query(
      `UPDATE "notifications" SET "next_attempt_at" = NOW() WHERE "next_attempt_at" IS NULL`,
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (_transaction) => {
    await queryInterface.removeIndex('notifications', 'uq_notifications_dedup');
    await queryInterface.removeIndex('notifications', 'idx_notifications_outbox_due');
    await queryInterface.removeIndex('notifications', 'idx_notifications_outbox_school');
    await queryInterface.removeColumn('notifications', 'dedup_key');
    await queryInterface.removeColumn('notifications', 'next_attempt_at');
    await queryInterface.removeColumn('notifications', 'delivery_abandoned_reason');
    await queryInterface.removeColumn('notifications', 'delivery_failure_kind');
    await queryInterface.removeColumn('notifications', 'delivered_tokens');
    await queryInterface.removeColumn('notifications', 'push_expires_at');
  });
}
