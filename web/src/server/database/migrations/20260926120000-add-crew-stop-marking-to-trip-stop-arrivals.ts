'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Crew stop marking — the manual counterpart of the geofence pipeline.
 *
 * Until now a stop could only be recorded by GPS: an accepted fix entering
 * the stop's `geofence_radius_meters`. With the phone's GPS off, the signal
 * weak or the bus parked 150 m away, the run simply stuck — the crew could
 * *see* the next stop but had no way to say "we were there". The two new
 * endpoints (`POST /trips/:tripId/stops/:stopId/arrive` and `.../skip`) write
 * into **this same table**, deliberately: one progress frontier, one arrivals
 * read, one place the ETA looks. A second table would have meant every
 * consumer learning about a second source of truth.
 *
 * Columns added:
 *
 * - `source` — `'geofence'` (the GPS pipeline) or `'crew'` (a driver or
 *   conductor pressed the button). `NOT NULL DEFAULT 'geofence'`, so every
 *   pre-existing row keeps exactly the meaning it already had and no backfill
 *   is needed.
 * - `skip_reason` — the crew's own words, non-null **only** on a skip. A skip
 *   is still a row in this table (the run must move past the stop), so this
 *   column is the single test for "passed without serving": the arrivals read
 *   shows it to the admin, and the notification fan-out is not run for it, so
 *   no parent is ever told their child's stop was "reached".
 * - `recorded_by` — the crew member who marked it; null for geofence rows.
 *   Tenant-pinned composite FK into `users (school_id, id)`, matching
 *   `trip_student_attendance.boarded_by`.
 *
 * Columns relaxed:
 *
 * - `latitude`, `longitude`, `distance_meters` become nullable. A crew mark
 *   has no measurement behind it, and writing the stop's own coordinates (or
 *   a 0/0 placeholder) would be indistinguishable downstream from a real fix.
 *   Existing rows are untouched and the geofence path still always writes all
 *   three, so no read that already worked can see a new null for an old row.
 *
 * The existing `uq_trip_stop_arrivals_trip_stop` unique index keeps doing the
 * duplicate protection for both sources at once: a stop already recorded by
 * GPS cannot be re-recorded by a crew tap, and a replayed offline queue item
 * cannot create a second row.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn(
      'trip_stop_arrivals',
      'source',
      {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'geofence',
      },
      { transaction },
    );

    await queryInterface.addColumn(
      'trip_stop_arrivals',
      'skip_reason',
      { type: DataTypes.TEXT, allowNull: true },
      { transaction },
    );

    await queryInterface.addColumn(
      'trip_stop_arrivals',
      'recorded_by',
      { type: DataTypes.UUID, allowNull: true },
      { transaction },
    );

    // A crew mark carries no GPS evidence; the geofence path still writes all
    // three on every row it creates.
    await queryInterface.changeColumn(
      'trip_stop_arrivals',
      'latitude',
      { type: DataTypes.DOUBLE, allowNull: true },
      { transaction },
    );
    await queryInterface.changeColumn(
      'trip_stop_arrivals',
      'longitude',
      { type: DataTypes.DOUBLE, allowNull: true },
      { transaction },
    );
    await queryInterface.changeColumn(
      'trip_stop_arrivals',
      'distance_meters',
      { type: DataTypes.DOUBLE, allowNull: true },
      { transaction },
    );

    // Only the two known sources may ever be stored.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "ck_trip_stop_arrivals_source"
         CHECK ("source" IN ('geofence', 'crew'));`,
      { transaction },
    );

    // Only a crew mark can carry a skip reason — the GPS pipeline has no
    // concept of skipping, so a geofence row with one would be corruption.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "ck_trip_stop_arrivals_skip_reason_crew_only"
         CHECK ("skip_reason" IS NULL OR "source" = 'crew');`,
      { transaction },
    );

    // Tenant-pinned composite foreign key, written as explicit SQL for the
    // same reason as the table's other two (Sequelize v6 types describe
    // `addConstraint` references as a single column).
    //
    // `ON DELETE NO ACTION`: a deactivated crew member must not silently
    // erase the authorship of an operational record (see
    // `20260906130000-composite-set-null-to-no-action.ts`).
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         ADD CONSTRAINT "fk_trip_stop_arrivals_recorded_by"
         FOREIGN KEY ("school_id", "recorded_by")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE NO ACTION;`,
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         DROP CONSTRAINT IF EXISTS "fk_trip_stop_arrivals_recorded_by";`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         DROP CONSTRAINT IF EXISTS "ck_trip_stop_arrivals_skip_reason_crew_only";`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_stop_arrivals"
         DROP CONSTRAINT IF EXISTS "ck_trip_stop_arrivals_source";`,
      { transaction },
    );

    // Rows written by the crew have no coordinates, so they must go before
    // the columns become NOT NULL again.
    await queryInterface.sequelize.query(
      `DELETE FROM "trip_stop_arrivals" WHERE "latitude" IS NULL OR "longitude" IS NULL
         OR "distance_meters" IS NULL;`,
      { transaction },
    );
    await queryInterface.changeColumn(
      'trip_stop_arrivals',
      'latitude',
      { type: DataTypes.DOUBLE, allowNull: false },
      { transaction },
    );
    await queryInterface.changeColumn(
      'trip_stop_arrivals',
      'longitude',
      { type: DataTypes.DOUBLE, allowNull: false },
      { transaction },
    );
    await queryInterface.changeColumn(
      'trip_stop_arrivals',
      'distance_meters',
      { type: DataTypes.DOUBLE, allowNull: false },
      { transaction },
    );

    await queryInterface.removeColumn('trip_stop_arrivals', 'recorded_by', { transaction });
    await queryInterface.removeColumn('trip_stop_arrivals', 'skip_reason', { transaction });
    await queryInterface.removeColumn('trip_stop_arrivals', 'source', { transaction });
  });
}
