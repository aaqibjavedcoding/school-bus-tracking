'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `notifications` table — one row per recipient parent per event
 * (Task 21: parent real-time notifications + trip alerts).
 *
 * Ownership is stored on the row itself as `(school_id, user_id)`; the read
 * APIs derive both values from the verified JWT and never from client input.
 * Every entity reference is a tenant-pinned composite foreign key
 * (`(school_id, user_id) → users`, `(school_id, trip_id) → trips`,
 * `(school_id, student_id) → students`), so a notification can never point at
 * a trip, child or account of another school.
 *
 * `type` is the PostgreSQL enum `enum_notifications_type` (Sequelize's
 * automatic name for the `NotificationType` enum of
 * `@school-bus-tracking/shared-types`): STUDENT_BOARDED, STUDENT_DROPPED,
 * TRIP_BOARDING, TRIP_IN_PROGRESS, TRIP_COMPLETED, TRIP_CANCELLED. ETA,
 * geofence and push-channel notifications are deliberately out of scope.
 *
 * The `(school_id, user_id, is_read, created_at)` index backs the hot path of
 * `GET /api/v1/parent/notifications` — page scans, the unread filter and the
 * `unread_count` aggregation all walk it without touching the table.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'notifications',
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
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        type: {
          type: DataTypes.ENUM(
            'STUDENT_BOARDED',
            'STUDENT_DROPPED',
            'TRIP_BOARDING',
            'TRIP_IN_PROGRESS',
            'TRIP_COMPLETED',
            'TRIP_CANCELLED',
          ),
          allowNull: false,
        },
        trip_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        student_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        title: {
          type: DataTypes.STRING(160),
          allowNull: false,
        },
        message: {
          type: DataTypes.STRING(500),
          allowNull: false,
        },
        payload: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        is_read: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        read_at: {
          type: DataTypes.DATE,
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
    // Nullable columns (trip_id / student_id) simply skip the constraint
    // while NULL.
    await queryInterface.sequelize.query(
      `ALTER TABLE "notifications"
         ADD CONSTRAINT "fk_notifications_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "notifications"
         ADD CONSTRAINT "fk_notifications_trip"
         FOREIGN KEY ("school_id", "trip_id")
         REFERENCES "trips" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "notifications"
         ADD CONSTRAINT "fk_notifications_student"
         FOREIGN KEY ("school_id", "student_id")
         REFERENCES "students" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // Read-state consistency: a read notification always carries its read
    // timestamp, an unread one never does.
    await queryInterface.sequelize.query(
      `ALTER TABLE "notifications"
         ADD CONSTRAINT "ck_notifications_read_state"
         CHECK (
           ("is_read" = false AND "read_at" IS NULL)
           OR ("is_read" = true AND "read_at" IS NOT NULL)
         );`,
      { transaction },
    );

    // Hot path of the parent list endpoint (pagination, unread filter and
    // unread_count in one index scan per query).
    await queryInterface.addIndex(
      'notifications',
      ['school_id', 'user_id', 'is_read', 'created_at'],
      {
        name: 'idx_notifications_school_user_read_created',
        transaction,
      },
    );

    await queryInterface.addIndex('notifications', ['school_id', 'user_id', 'created_at'], {
      name: 'idx_notifications_school_user_created',
      transaction,
    });

    await queryInterface.addIndex('notifications', ['school_id', 'trip_id'], {
      name: 'idx_notifications_school_trip',
      transaction,
    });

    await queryInterface.addIndex('notifications', ['school_id', 'student_id'], {
      name: 'idx_notifications_school_student',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('notifications', { transaction });
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_notifications_type";', {
      transaction,
    });
  });
}
