'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Extends `notifications` for Task 22 stop-arrival notifications.
 *
 * 1. Adds the nullable `stop_id` column so a notification can be scoped to a
 *    stop (arrival notifications are per (trip, stop, recipient)); the
 *    stop-arrival flow deduplicates on `(school_id, user_id, type, trip_id,
 *    stop_id)` so a replayed arrival can never notify a parent twice.
 * 2. Pins the column with the tenant-safe composite foreign key
 *    `(school_id, stop_id) → stops (school_id, id)` (enforced through
 *    `uq_stops_school_id`) and indexes it.
 * 3. Adds `STOP_ARRIVED` to the `enum_notifications_type` PostgreSQL enum.
 *
 * The `down` migration removes the column, constraint and index. The added
 * enum value is intentionally *not* removed on rollback: PostgreSQL cannot
 * drop an enum value without recreating the type, and an orphaned enum value
 * is harmless (inserts only ever use values the application knows about).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn(
      'notifications',
      'stop_id',
      {
        type: DataTypes.UUID,
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "notifications"
         ADD CONSTRAINT "fk_notifications_stop"
         FOREIGN KEY ("school_id", "stop_id")
         REFERENCES "stops" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.addIndex('notifications', ['school_id', 'stop_id'], {
      name: 'idx_notifications_school_stop',
      transaction,
    });

    // Stop-arrival notifications (Task 22). `ADD VALUE IF NOT EXISTS` keeps
    // the migration idempotent-safe; since PostgreSQL 12 the statement may
    // run inside a transaction block (the new value just cannot be *used*
    // within the same transaction, which this migration never does).
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS 'STOP_ARRIVED';`,
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeIndex('notifications', 'idx_notifications_school_stop', {
      transaction,
    });
    await queryInterface.removeColumn('notifications', 'stop_id', { transaction });
  });
}
