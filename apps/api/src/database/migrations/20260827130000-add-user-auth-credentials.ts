'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Adds the minimum credential columns required for password authentication.
 *
 * - `password_hash` is nullable so existing user rows remain valid.
 * - `email_verified_at` is nullable until a later verification flow sets it.
 * - `email` already exists and stays nullable; tenant-aware uniqueness is
 *   already enforced by `uq_users_school_email` (school_id, email) WHERE
 *   deleted_at IS NULL. This migration does **not** add a global unique
 *   constraint on email.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn(
      'users',
      'password_hash',
      {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.addColumn(
      'users',
      'email_verified_at',
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeColumn('users', 'email_verified_at', { transaction });
    await queryInterface.removeColumn('users', 'password_hash', { transaction });
  });
}
