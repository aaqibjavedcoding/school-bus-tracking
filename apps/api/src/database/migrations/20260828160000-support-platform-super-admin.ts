'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Platform-level SUPER_ADMIN support.
 *
 * `SUPER_ADMIN` already exists in the `enum_users_role` type (Task 1) and the
 * JWT/role machinery understands it, but the physical schema still forces
 * every user row into a school tenant:
 *
 * - `users.school_id` is NOT NULL with a foreign key to `schools`;
 * - `refresh_tokens.school_id` is NOT NULL with a composite foreign key to
 *   `users(school_id, id)`.
 *
 * A platform owner is explicitly NOT a member of any tenant, so both columns
 * are relaxed to nullable. No existing row is changed — every school-scoped
 * user keeps its `school_id`, and all foreign keys, composite unique indexes
 * and tenant-pinned constraints remain untouched.
 *
 * Additionally, platform accounts need a login identity: `uq_users_school_email`
 * is `(school_id, email)` and PostgreSQL treats each NULL `school_id` as
 * distinct, so it cannot guarantee a single platform login per email. This
 * migration adds the partial unique index `uq_users_super_admin_email` over
 * `(email)` for rows with `role = 'SUPER_ADMIN' AND deleted_at IS NULL`.
 *
 * The migration is reversible and preserves all tenant data: `down` drops the
 * index, removes the platform-only rows (SUPER_ADMIN sessions/accounts, which
 * cannot exist in the old schema) and restores the NOT NULL constraints.
 * School-scoped rows are never null and therefore never touched.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Platform accounts (SUPER_ADMIN) belong to no tenant. The column stays
    // UUID-typed and keeps its foreign key — a null simply means "platform".
    await queryInterface.changeColumn(
      'users',
      'school_id',
      {
        type: 'UUID',
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.changeColumn(
      'refresh_tokens',
      'school_id',
      {
        type: 'UUID',
        allowNull: true,
      },
      { transaction },
    );

    // Platform-wide unique login email for SUPER_ADMIN accounts (one login per
    // email). Partial index: school users continue to be governed by the
    // tenant-scoped `uq_users_school_email`.
    await queryInterface.addIndex('users', ['email'], {
      name: 'uq_users_super_admin_email',
      unique: true,
      where: { role: 'SUPER_ADMIN', deleted_at: null },
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeIndex('users', 'uq_users_super_admin_email', {
      transaction,
    });

    // Remove platform-only rows that could not exist under the old schema:
    // their school_id is null and would violate the restored NOT NULL
    // constraints. These are SUPER_ADMIN sessions/accounts; every
    // school-scoped row (school_id non-null) is left untouched.
    await queryInterface.sequelize.query(
      `DELETE FROM "refresh_tokens" WHERE "school_id" IS NULL;`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "users" WHERE "role" = 'SUPER_ADMIN' AND "school_id" IS NULL;`,
      { transaction },
    );

    await queryInterface.changeColumn(
      'refresh_tokens',
      'school_id',
      {
        type: 'UUID',
        allowNull: false,
      },
      { transaction },
    );

    await queryInterface.changeColumn(
      'users',
      'school_id',
      {
        type: 'UUID',
        allowNull: false,
      },
      { transaction },
    );
  });
}
