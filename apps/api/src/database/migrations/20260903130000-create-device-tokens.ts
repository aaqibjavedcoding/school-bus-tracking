'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `device_tokens` table — one row per push-capable device of one
 * user, pinned to its tenant (Firebase Cloud Messaging device registration).
 *
 * Ownership lives on the row as `(school_id, user_id)` and both values are
 * derived from the verified JWT by the registration endpoints — a client can
 * never register a token for another user or another school. The composite
 * foreign key pins the row to an actual account of the tenant; the unique
 * index on `token` (soft-delete aware) guarantees a device token is never
 * registered twice, so the push path can never send one device two copies of
 * the same notification.
 *
 * `is_active` is the delivery switch: logout, user change and FCM
 * invalid-token responses flip it off while the row remains as an audit trail
 * (same soft-delete convention as every other tenant table).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'device_tokens',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        school_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'schools', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        platform: {
          type: DataTypes.ENUM('android', 'ios'),
          allowNull: false,
        },
        token: {
          type: DataTypes.STRING(1024),
          allowNull: false,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        last_seen_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    // Composite (tenant-pinned) foreign key, matching every other tenant
    // table: the device row can only ever reference an account of the same
    // school at the database boundary.
    await queryInterface.sequelize.query(
      `ALTER TABLE "device_tokens"
         ADD CONSTRAINT "fk_device_tokens_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // "All active tokens of one user" — the hot path of push delivery.
    await queryInterface.addIndex('device_tokens', ['school_id', 'user_id', 'is_active'], {
      name: 'idx_device_tokens_school_user_active',
      transaction,
    });

    await queryInterface.addIndex('device_tokens', ['school_id', 'token'], {
      name: 'idx_device_tokens_school_token',
      transaction,
    });

    // One registration per token. Partial so a soft-deleted row stops
    // blocking the same device from registering again later.
    await queryInterface.addIndex('device_tokens', ['token'], {
      name: 'uq_device_tokens_token',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });
  });
}

/** Safe rollback: drops the table and the enum type it created. */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('device_tokens', { transaction });
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_device_tokens_platform";', {
      transaction,
    });
  });
}
