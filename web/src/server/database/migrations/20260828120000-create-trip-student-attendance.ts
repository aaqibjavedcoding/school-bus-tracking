'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `trip_student_attendance` table — boarding and drop events of a
 * student on one concrete trip.
 *
 * The manifest itself is **not** persisted: it is derived at read time from
 * the trip's route, its ordered stops and the students whose home stop sits on
 * that route. Only the events the crew actually recorded are stored, so a
 * student without a row is implicitly `PENDING`.
 *
 * `status` is the PostgreSQL enum `enum_trip_student_attendance_status`
 * (Sequelize's automatic name for `TripAttendanceStatus` in
 * `database/models/enums.ts`): PENDING → BOARDED → DROPPED. The one-way
 * progression is enforced by the service layer, while the check constraints
 * below guarantee that the stored timestamps can never contradict the status.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'trip_student_attendance',
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
        trip_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        student_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        stop_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        status: {
          type: DataTypes.ENUM('PENDING', 'BOARDED', 'DROPPED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        boarded_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        boarded_by: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        dropped_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        dropped_by: {
          type: DataTypes.UUID,
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
    // column, whereas PostgreSQL needs both columns to enforce ownership.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "fk_trip_student_attendance_trip"
         FOREIGN KEY ("school_id", "trip_id")
         REFERENCES "trips" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "fk_trip_student_attendance_student"
         FOREIGN KEY ("school_id", "student_id")
         REFERENCES "students" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "fk_trip_student_attendance_stop"
         FOREIGN KEY ("school_id", "stop_id")
         REFERENCES "stops" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "fk_trip_student_attendance_boarded_by"
         FOREIGN KEY ("school_id", "boarded_by")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "fk_trip_student_attendance_dropped_by"
         FOREIGN KEY ("school_id", "dropped_by")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    // The status and the timestamps must always tell the same story: a
    // BOARDED row has a boarding time and no drop time, a DROPPED row has
    // both, and a PENDING row has neither.
    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "ck_trip_student_attendance_status_timestamps"
         CHECK (
           ("status" = 'PENDING' AND "boarded_at" IS NULL AND "dropped_at" IS NULL)
           OR ("status" = 'BOARDED' AND "boarded_at" IS NOT NULL AND "dropped_at" IS NULL)
           OR ("status" = 'DROPPED' AND "boarded_at" IS NOT NULL AND "dropped_at" IS NOT NULL)
         );`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trip_student_attendance"
         ADD CONSTRAINT "ck_trip_student_attendance_event_order"
         CHECK ("dropped_at" IS NULL OR "boarded_at" IS NULL OR "dropped_at" >= "boarded_at");`,
      { transaction },
    );

    // One live attendance row per student and trip. A soft-deleted row can be
    // recreated later without losing the historical record.
    await queryInterface.addIndex(
      'trip_student_attendance',
      ['school_id', 'trip_id', 'student_id'],
      {
        name: 'uq_trip_student_attendance_trip_student',
        unique: true,
        where: { deleted_at: null },
        transaction,
      },
    );

    await queryInterface.addIndex('trip_student_attendance', ['school_id', 'trip_id'], {
      name: 'idx_trip_student_attendance_school_trip',
      transaction,
    });

    await queryInterface.addIndex('trip_student_attendance', ['school_id', 'student_id'], {
      name: 'idx_trip_student_attendance_school_student',
      transaction,
    });

    await queryInterface.addIndex('trip_student_attendance', ['school_id', 'stop_id'], {
      name: 'idx_trip_student_attendance_school_stop',
      transaction,
    });

    await queryInterface.addIndex('trip_student_attendance', ['school_id', 'status'], {
      name: 'idx_trip_student_attendance_school_status',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('trip_student_attendance', { transaction });
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_trip_student_attendance_status";',
      { transaction },
    );
  });
}
