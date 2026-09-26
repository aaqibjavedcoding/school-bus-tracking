'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `password_reset_tokens` table.
 *
 * Backs the **SCHOOL_ADMIN-only** self-service "Forgot password" flow:
 * `POST /auth/forgot-password` mints one row, the raw token travels only
 * inside the emailed `{APP_URL}/reset-password?token=…` link, and
 * `POST /auth/reset-password` redeems it. No other role reaches this table —
 * crew (DRIVER / CONDUCTOR) sign in with a PIN or a QR pairing code and their
 * credentials are managed by a school admin, and SUPER_ADMIN / PARENT
 * self-service reset is deliberately out of scope.
 *
 * Security & data integrity:
 *
 * - `token_hash` stores the **SHA-256 digest** of a 256-bit random token —
 *   the same `generateRefreshToken()` / `hashToken()` pair `refresh_tokens`
 *   and `crew_pairing_tokens` use. The plaintext is never persisted, so a
 *   database read or a leaked backup cannot resurrect a live reset link.
 * - Single use is enforced by `used_at` plus the **unique** index on
 *   `token_hash`: redemption is one atomic
 *   `UPDATE … WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()`,
 *   so of N concurrent clicks on the same link exactly one updates a row.
 * - `used_at` also records *supersession*: issuing a new token marks the
 *   user's previous unused one used, which is what makes "one active link at
 *   a time" a property of the data rather than of application ordering.
 * - `expires_at` bounds the link to the configured TTL (30–60 minutes, see
 *   `password-reset-tokens.ts`) and is checked in that same statement, so an
 *   expired link cannot be redeemed even if the application forgets the clock.
 * - `requested_ip` is **audit-only**. It is written by the mint and read by
 *   nobody: the model's default scope and `toJSON()` both strip it, and no
 *   endpoint returns it.
 *
 * ### Why `user_id` references `users(id)` and there is no `school_id`
 *
 * A reset token is looked up by nothing but its digest, from an
 * unauthenticated request that carries no tenant. A denormalised `school_id`
 * would be a copy of `users.school_id` that no query filters on and a second
 * place for the two to disagree; the tenant is read from the user row the
 * token points at. `audit_logs` and `idempotency_keys` reference `users(id)`
 * directly for the same reason.
 *
 * ### No `updated_at` / `deleted_at`
 *
 * `used_at` is the only state transition a row has and `created_at` is its
 * birth, so the table is append-plus-one-update, like `audit_logs` is
 * append-only. Expired and spent rows are purged when the same user requests
 * another reset, which is what the `expires_at` index makes a range scan.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'password_reset_tokens',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        token_hash: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        expires_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        used_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        requested_ip: {
          type: DataTypes.STRING(45),
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      { transaction },
    );

    // Unique digest — also what makes single-use redemption resolve to at most
    // one row under concurrency.
    await queryInterface.addIndex('password_reset_tokens', ['token_hash'], {
      name: 'uq_password_reset_tokens_token_hash',
      unique: true,
      transaction,
    });

    // "Outstanding links for this admin" — the supersede-on-reissue query.
    await queryInterface.addIndex('password_reset_tokens', ['user_id', 'used_at'], {
      name: 'idx_password_reset_tokens_user_used',
      transaction,
    });

    // Expired-row purge is a range scan on the clock.
    await queryInterface.addIndex('password_reset_tokens', ['expires_at'], {
      name: 'idx_password_reset_tokens_expires_at',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // `dropTable` removes the columns, all three indexes and the foreign key
  // with them, so the migration is fully reversible and touches nothing
  // outside this table.
  await queryInterface.dropTable('password_reset_tokens');
}
