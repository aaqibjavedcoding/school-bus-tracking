'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `trip_locations` table — the append-only history of accepted
 * GPS fixes for a trip (Phase 5, live tracking).
 *
 * A row is one observation of the bus position: the device-reported fix
 * (`latitude`, `longitude`, `accuracy`, `speed`, `heading`, `recorded_at`)
 * plus the server receipt time (`received_at`). `received_at` is written by
 * the API from its own clock; a client can only ever supply `recorded_at`,
 * and the service layer bounds how far it may sit ahead of it.
 *
 * The table stores no credentials and no personal data — only coordinates
 * tied to a trip. Every reference is tenant-pinned:
 * `(school_id, trip_id)` is a composite foreign key into `trips`
 * (`school_id`, `id`), enforced through the `uq_trips_school_id` unique
 * index created by the trips migration, before any child migration can add
 * this foreign key.
 *
 * Indexes:
 * - `idx_trip_locations_school_trip_recorded` — chronological history scan
 *   (`school_id, trip_id, recorded_at`);
 * - `idx_trip_locations_school_trip_received` — latest-location lookup
 *   (newest fix of a trip first, ordered by `received_at`);
 * - `idx_trip_locations_school_trip` — plain tenant/trip lookup.
 *
 * The check constraints are the database-level defence in depth behind the
 * service-layer Zod schemas: coordinates and readings must stay within
 * physical bounds, and `recorded_at` may never wander far from the server
 * clock (loose 24 h / 15 min bounds — the service enforces the tighter,
 * configurable skew windows).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'trip_locations',
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
        latitude: {
          type: DataTypes.DOUBLE,
          allowNull: false,
        },
        longitude: {
          type: DataTypes.DOUBLE,
          allowNull: false,
        },
        accuracy: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        speed: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        heading: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        recorded_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        received_at: {
          type: DataTypes.DATE,
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

    // Tenant-pinned composite foreign key: a fix can never reference a trip
    // from another school. Written as explicit SQL because Sequelize v6
    // types describe `addConstraint` references as a single column.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_locations"
         ADD CONSTRAINT "fk_trip_locations_trip"
         FOREIGN KEY ("school_id", "trip_id")
         REFERENCES "trips" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // Physical bounds, mirroring the service-layer GPS schemas.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_locations"
         ADD CONSTRAINT "ck_trip_locations_latitude_range"
         CHECK ("latitude" >= -90 AND "latitude" <= 90);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_locations"
         ADD CONSTRAINT "ck_trip_locations_longitude_range"
         CHECK ("longitude" >= -180 AND "longitude" <= 180);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_locations"
         ADD CONSTRAINT "ck_trip_locations_reading_bounds"
         CHECK (
           ("accuracy" IS NULL OR ("accuracy" >= 0 AND "accuracy" <= 10000))
           AND ("speed" IS NULL OR ("speed" >= 0 AND "speed" <= 300))
           AND ("heading" IS NULL OR ("heading" >= 0 AND "heading" <= 360))
         );`,
      { transaction },
    );

    // The device clock may lag (network delay) or lead (clock skew) the
    // server clock only within loose absolute bounds; tighter, configurable
    // windows are enforced by the tracking service.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_locations"
         ADD CONSTRAINT "ck_trip_locations_timestamp_plausibility"
         CHECK (
           "recorded_at" >= "received_at" - INTERVAL '24 hours'
           AND "recorded_at" <= "received_at" + INTERVAL '15 minutes'
         );`,
      { transaction },
    );

    await queryInterface.addIndex('trip_locations', ['school_id', 'trip_id', 'recorded_at'], {
      name: 'idx_trip_locations_school_trip_recorded',
      transaction,
    });

    await queryInterface.addIndex('trip_locations', ['school_id', 'trip_id', 'received_at'], {
      name: 'idx_trip_locations_school_trip_received',
      transaction,
    });

    await queryInterface.addIndex('trip_locations', ['school_id', 'trip_id'], {
      name: 'idx_trip_locations_school_trip',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('trip_locations', { transaction });
  });
}
