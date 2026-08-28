'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op, col } from 'sequelize';

/**
 * Creates the `trips` table — one concrete execution of a route.
 *
 * The trip stores both the plan (`scheduled_*`) and what actually happened
 * (`actual_*`, `status`, cancellation audit columns) so reporting never
 * depends on mutable route data.
 *
 * `status` is the PostgreSQL enum `enum_trips_status` (Sequelize's automatic
 * name for the `TripStatus` lifecycle in `database/models/enums.ts`):
 * SCHEDULED → BOARDING → IN_PROGRESS → COMPLETED, with CANCELLED reachable
 * from any non-terminal state. The state machine itself is enforced in the
 * service layer; the database guarantees the value set and the time ordering.
 *
 * Uniqueness: one open trip per route per scheduled departure.
 *
 * The `(school_id, id)` unique index is created here, alongside the trips
 * table, because it is the target key for the later tenant-pinned attendance
 * and live-location foreign keys. A primary key on `id` alone is not
 * sufficient for a composite foreign key.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'trips',
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
        bus_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        driver_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        conductor_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        status: {
          type: DataTypes.ENUM('SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'SCHEDULED',
        },
        scheduled_start_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        scheduled_end_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        actual_start_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        actual_end_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        cancelled_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        cancellation_reason: {
          type: DataTypes.TEXT,
          allowNull: true,
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

    // Composite (tenant-pinned) foreign keys are written as explicit SQL:
    // Sequelize v6 types describe `addConstraint` references as a single
    // column, whereas the runtime supports a column list. The statement is
    // exactly what `addConstraint` emits for a composite key.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trips"
         ADD CONSTRAINT "fk_trips_route"
         FOREIGN KEY ("school_id", "route_id")
         REFERENCES "routes" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trips"
         ADD CONSTRAINT "fk_trips_bus"
         FOREIGN KEY ("school_id", "bus_id")
         REFERENCES "buses" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trips"
         ADD CONSTRAINT "fk_trips_driver"
         FOREIGN KEY ("school_id", "driver_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trips"
         ADD CONSTRAINT "fk_trips_conductor"
         FOREIGN KEY ("school_id", "conductor_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.addConstraint('trips', {
      type: 'check',
      name: 'ck_trips_scheduled_range',
      fields: ['scheduled_end_at'],
      where: {
        [Op.or]: [
          { scheduled_end_at: { [Op.eq]: null } },
          { scheduled_end_at: { [Op.gte]: col('scheduled_start_at') } },
        ],
      },
      transaction,
    });

    await queryInterface.addConstraint('trips', {
      type: 'check',
      name: 'ck_trips_actual_range',
      fields: ['actual_end_at'],
      where: {
        [Op.or]: [
          { actual_end_at: { [Op.eq]: null } },
          { actual_start_at: { [Op.eq]: null } },
          { actual_end_at: { [Op.gte]: col('actual_start_at') } },
        ],
      },
      transaction,
    });

    // This is the referenced key for tenant-pinned trip foreign keys. It must
    // be non-partial: PostgreSQL cannot use the soft-delete trip uniqueness
    // index below as the target of a foreign key.
    await queryInterface.addIndex('trips', ['school_id', 'id'], {
      name: 'uq_trips_school_id',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('trips', ['route_id', 'scheduled_start_at'], {
      name: 'uq_trips_route_scheduled_start',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('trips', ['school_id', 'scheduled_start_at'], {
      name: 'idx_trips_school_scheduled_start',
      transaction,
    });

    await queryInterface.addIndex('trips', ['school_id', 'status'], {
      name: 'idx_trips_school_status',
      transaction,
    });

    await queryInterface.addIndex('trips', ['school_id', 'bus_id'], {
      name: 'idx_trips_school_bus',
      transaction,
    });

    await queryInterface.addIndex('trips', ['school_id', 'driver_id'], {
      name: 'idx_trips_school_driver',
      transaction,
    });

    await queryInterface.addIndex('trips', ['school_id', 'conductor_id'], {
      name: 'idx_trips_school_conductor',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('trips');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_trips_status";');
}
