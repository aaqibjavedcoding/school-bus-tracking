'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `trip_stop_arrivals` table — one row per recorded stop-arrival
 * event of a trip (Task 22: dynamic ETA + geofence + stop arrival detection).
 *
 * A row is created only when an accepted GPS fix of the trip enters a route
 * stop's `geofence_radius_meters` (evaluated by the stop-arrivals pipeline).
 * It records the trip/stop pair, the server-side arrival time, the bus
 * position at the moment of arrival and the Haversine distance to the stop.
 *
 * Tenant safety mirrors every other domain table:
 * - `(school_id, trip_id)` is a composite foreign key into `trips`
 *   (`school_id`, `id`), enforced through `uq_trips_school_id`;
 * - `(school_id, stop_id)` is a composite foreign key into `stops`
 *   (`school_id`, `id`), enforced through `uq_stops_school_id`;
 * - the unique index `uq_trip_stop_arrivals_trip_stop` on
 *   `(school_id, trip_id, stop_id)` is the database-level duplicate
 *   protection: exactly one arrival event can ever exist per trip-stop,
 *   regardless of how many fixes land inside the geofence (or how many
 *   application instances race to record the same visit).
 *
 * Indexes:
 * - `uq_trip_stop_arrivals_trip_stop` — duplicate protection;
 * - `idx_trip_stop_arrivals_school_trip_arrived` — "arrivals of this trip in
 *   arrival order" (crew progress reads);
 * - `idx_trip_stop_arrivals_school_stop` — tenant/stop lookups.
 *
 * Physical bounds on latitude/longitude/distance mirror the service-layer
 * GPS schemas as defence in depth.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'trip_stop_arrivals',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        school_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        trip_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        stop_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        arrived_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        latitude: {
          type: DataTypes.DOUBLE,
          allowNull: false,
        },
        longitude: {
          type: DataTypes.DOUBLE,
          allowNull: false,
        },
        distance_meters: {
          type: DataTypes.DOUBLE,
          allowNull: false,
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

    // Tenant-pinned composite foreign keys — written as explicit SQL because
    // Sequelize v6 types describe `addConstraint` references as a single
    // column, whereas PostgreSQL needs both columns to enforce ownership.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "fk_trip_stop_arrivals_trip"
         FOREIGN KEY ("school_id", "trip_id")
         REFERENCES "trips" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "fk_trip_stop_arrivals_stop"
         FOREIGN KEY ("school_id", "stop_id")
         REFERENCES "stops" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // Physical bounds, mirroring the service-layer GPS schemas.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "ck_trip_stop_arrivals_latitude_range"
         CHECK ("latitude" >= -90 AND "latitude" <= 90);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "ck_trip_stop_arrivals_longitude_range"
         CHECK ("longitude" >= -180 AND "longitude" <= 180);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "ck_trip_stop_arrivals_distance_non_negative"
         CHECK ("distance_meters" >= 0);`,
      { transaction },
    );

    // Duplicate protection: one arrival event per (trip, stop) visit.
    await queryInterface.addIndex('trip_stop_arrivals', ['school_id', 'trip_id', 'stop_id'], {
      name: 'uq_trip_stop_arrivals_trip_stop',
      unique: true,
      transaction,
    });

    // Progress reads: "arrivals of this trip, in arrival order".
    await queryInterface.addIndex('trip_stop_arrivals', ['school_id', 'trip_id', 'arrived_at'], {
      name: 'idx_trip_stop_arrivals_school_trip_arrived',
      transaction,
    });

    // Tenant/stop lookups.
    await queryInterface.addIndex('trip_stop_arrivals', ['school_id', 'stop_id'], {
      name: 'idx_trip_stop_arrivals_school_stop',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('trip_stop_arrivals', { transaction });
  });
}
