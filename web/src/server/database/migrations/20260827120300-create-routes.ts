'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `routes` table (a named route plan inside a school).
 *
 * `uq_routes_school_id` enables the tenant-pinned composite key
 * `(school_id, route_id)` used by `stops`, `route_assignments` and `trips`.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'routes',
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
        name: {
          type: DataTypes.STRING(150),
          allowNull: false,
        },
        code: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
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

    await queryInterface.addIndex('routes', ['school_id', 'id'], {
      name: 'uq_routes_school_id',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('routes', ['school_id', 'code'], {
      name: 'uq_routes_school_code',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('routes', ['school_id', 'is_active'], {
      name: 'idx_routes_school_active',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('routes');
}
