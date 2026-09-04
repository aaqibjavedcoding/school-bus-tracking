'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Creates the `stops` table (ordered boarding points of a route).
 *
 * Tenant pinning: besides the plain `school_id` foreign key, the route
 * reference is a *composite* foreign key `(school_id, route_id) →
 * routes(school_id, id)`. A row can therefore only point at a route that
 * belongs to the very same school, which makes cross-tenant wiring impossible
 * even if application code passes the wrong ids.
 *
 * `uq_stops_school_id` exists so `students.home_stop_id` can use the same
 * tenant-pinned pattern.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'stops',
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
        route_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING(150),
          allowNull: false,
        },
        address: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        latitude: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        longitude: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        geofence_radius_meters: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 100,
        },
        sequence_number: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        estimated_arrival_time: {
          type: DataTypes.TIME,
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

    // Tenant-pinned route reference (see the migration header).
    //
    // Composite (tenant-pinned) foreign keys are written as explicit SQL:
    // Sequelize v6 types describe `addConstraint` references as a single
    // column, whereas the runtime supports a column list. The statement is
    // exactly what `addConstraint` emits for a composite key.
    await queryInterface.sequelize.query(
      `ALTER TABLE "stops"
         ADD CONSTRAINT "fk_stops_route"
         FOREIGN KEY ("school_id", "route_id")
         REFERENCES "routes" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.addConstraint('stops', {
      type: 'check',
      name: 'ck_stops_latitude_range',
      fields: ['latitude'],
      where: { latitude: { [Op.between]: [-90, 90] } },
      transaction,
    });

    await queryInterface.addConstraint('stops', {
      type: 'check',
      name: 'ck_stops_longitude_range',
      fields: ['longitude'],
      where: { longitude: { [Op.between]: [-180, 180] } },
      transaction,
    });

    await queryInterface.addConstraint('stops', {
      type: 'check',
      name: 'ck_stops_geofence_radius_range',
      fields: ['geofence_radius_meters'],
      where: { geofence_radius_meters: { [Op.between]: [10, 2000] } },
      transaction,
    });

    await queryInterface.addConstraint('stops', {
      type: 'check',
      name: 'ck_stops_sequence_positive',
      fields: ['sequence_number'],
      where: { sequence_number: { [Op.gte]: 1 } },
      transaction,
    });

    await queryInterface.addIndex('stops', ['school_id', 'id'], {
      name: 'uq_stops_school_id',
      unique: true,
      transaction,
    });

    // A stop position may only be taken once per route (soft-deleted stops
    // release their position so routes can be renumbered).
    await queryInterface.addIndex('stops', ['route_id', 'sequence_number'], {
      name: 'uq_stops_route_sequence',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('stops', ['school_id', 'route_id'], {
      name: 'idx_stops_school_route',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('stops');
}
