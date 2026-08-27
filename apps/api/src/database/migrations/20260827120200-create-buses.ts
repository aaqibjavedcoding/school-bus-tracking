'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Creates the `buses` table (fleet owned by a school).
 *
 * `uq_buses_school_id` is not a lookup optimisation — it is the unique index
 * that lets `route_assignments` and `trips` reference a bus with the
 * tenant-pinned composite key `(school_id, bus_id)`.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'buses',
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
        registration_number: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        bus_number: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        capacity: {
          type: DataTypes.INTEGER,
          allowNull: false,
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

    await queryInterface.addConstraint('buses', {
      type: 'check',
      name: 'ck_buses_capacity_positive',
      fields: ['capacity'],
      where: { capacity: { [Op.gt]: 0 } },
      transaction,
    });

    await queryInterface.addIndex('buses', ['school_id', 'id'], {
      name: 'uq_buses_school_id',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('buses', ['school_id', 'registration_number'], {
      name: 'uq_buses_school_registration',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('buses', ['school_id', 'bus_number'], {
      name: 'uq_buses_school_bus_number',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('buses', ['school_id', 'is_active'], {
      name: 'idx_buses_school_active',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('buses');
}
