'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `refresh_tokens` table.
 *
 * Persists hashed refresh token sessions.
 *
 * Security & Data Integrity:
 * - `token_hash` stores the SHA-256 digest of high-entropy random tokens.
 *   Plaintext tokens are never stored.
 * - Multi-tenant isolation: `school_id` references `schools(id)` and the
 *   composite foreign key `(school_id, user_id)` references `users(school_id, id)`
 *   so a token session can never mix users and schools across tenants.
 * - `revoked_at` tracks revocation (logout, rotation or security revocation).
 * - `replaced_by_token_id` tracks rotation lineage for auditability and reuse detection.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'refresh_tokens',
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
        token_hash: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        expires_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        revoked_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        replaced_by_token_id: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'refresh_tokens', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
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

    // Tenant-pinned composite foreign key: (school_id, user_id) -> users(school_id, id)
    await queryInterface.sequelize.query(
      `ALTER TABLE "refresh_tokens"
         ADD CONSTRAINT "fk_refresh_tokens_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // Unique index on token_hash for active records
    await queryInterface.addIndex('refresh_tokens', ['token_hash'], {
      name: 'uq_refresh_tokens_token_hash',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // Lookup index for tenant and user sessions
    await queryInterface.addIndex('refresh_tokens', ['school_id', 'user_id'], {
      name: 'idx_refresh_tokens_school_user',
      transaction,
    });

    // Expiration cleanup index
    await queryInterface.addIndex('refresh_tokens', ['expires_at'], {
      name: 'idx_refresh_tokens_expires_at',
      transaction,
    });

    // Active token lookup index per user
    await queryInterface.addIndex('refresh_tokens', ['user_id', 'revoked_at'], {
      name: 'idx_refresh_tokens_user_revoked',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('refresh_tokens');
}
