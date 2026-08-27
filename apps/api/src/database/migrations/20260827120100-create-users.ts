'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `users` table.
 *
 * Holds the people that act inside a tenant (school admin, driver, conductor,
 * parent). No credentials live here — authentication is a separate task.
 *
 * `role` is a PostgreSQL enum. Sequelize names enum types
 * `enum_<table>_<column>`, creates them automatically when the column is
 * created, and does *not* drop them with the table, hence the explicit
 * `DROP TYPE` in `down`.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'users',
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
        role: {
          type: DataTypes.ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'DRIVER', 'CONDUCTOR', 'PARENT'),
          allowNull: false,
        },
        first_name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        last_name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        email: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
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

    // Target of the tenant-pinned foreign keys used by route_assignments and
    // trips: (school_id, user_id) -> users(school_id, id).
    await queryInterface.addIndex('users', ['school_id', 'id'], {
      name: 'uq_users_school_id',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('users', ['school_id', 'email'], {
      name: 'uq_users_school_email',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // No standalone (school_id) index: `uq_users_school_id` already covers
    // tenant-scoped lookups as its leftmost prefix.
    await queryInterface.addIndex('users', ['school_id', 'role'], {
      name: 'idx_users_school_role',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('users');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_role";');
}
