'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Creates the `schools` table — the tenant root of the platform.
 *
 * Every other table references `schools.id`, so this migration must run first.
 * `code` and `subdomain` are unique only among non soft-deleted rows so that a
 * removed tenant never blocks the reuse of its identifiers.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'schools',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(150),
          allowNull: false,
        },
        code: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        subdomain: {
          type: DataTypes.STRING(63),
          allowNull: true,
        },
        email: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING(32),
          allowNull: true,
        },
        address_line1: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        address_line2: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        city: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        state: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        postal_code: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },
        country: {
          type: DataTypes.STRING(2),
          allowNull: true,
        },
        timezone: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: 'UTC',
        },
        latitude: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        longitude: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        // Timestamps carry no database default: Sequelize always writes them
        // through the `@CreatedAt` / `@UpdatedAt` decorators on BaseModel.
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

    await queryInterface.addConstraint('schools', {
      type: 'check',
      name: 'ck_schools_latitude_range',
      fields: ['latitude'],
      where: { latitude: { [Op.between]: [-90, 90] } },
      transaction,
    });

    await queryInterface.addConstraint('schools', {
      type: 'check',
      name: 'ck_schools_longitude_range',
      fields: ['longitude'],
      where: { longitude: { [Op.between]: [-180, 180] } },
      transaction,
    });

    await queryInterface.addIndex('schools', ['code'], {
      name: 'uq_schools_code',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('schools', ['subdomain'], {
      name: 'uq_schools_subdomain',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('schools');
}
