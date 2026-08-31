'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `emergency_events` table — the crew SOS / emergency record
 * (Task 44).
 *
 * A driver or conductor raises an SOS from the mobile app; the backend writes
 * one row here with the **server** clock and broadcasts it over the
 * self-hosted Socket.IO gateway. No SMS gateway, push vendor or any other
 * paid third party is involved anywhere in the flow.
 *
 * Design notes:
 *
 * - **The event time is server-owned.** `triggered_at` is written by the API,
 *   never accepted from a client, so an incident can be neither back-dated
 *   nor pre-dated.
 * - **The crew identity is token-owned.** `raised_by_user_id` /
 *   `raised_by_role` come from the verified JWT, and `raised_by_role` is
 *   constrained to the two crew roles.
 * - **The trip context is snapshotted.** `bus_id` / `route_id` are copied
 *   from the trip so the incident stays readable after a roster or route
 *   change, while a missing trip (`NULL`) still yields a valid off-duty SOS.
 * - **History is never deleted.** Resolving or cancelling moves the row
 *   through its lifecycle (`OPEN → ACKNOWLEDGED → RESOLVED / CANCELLED`);
 *   the audit columns record who acted and when.
 * - Coordinates are `DOUBLE PRECISION` (not `NUMERIC`) so the driver returns
 *   real JavaScript numbers, and they stay nullable: an SOS must always be
 *   possible, even without a GPS fix — but a position is never invented.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'emergency_events',
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
          allowNull: true,
        },
        bus_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        route_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        raised_by_user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        raised_by_role: {
          type: DataTypes.ENUM('DRIVER', 'CONDUCTOR'),
          allowNull: false,
        },
        type: {
          type: DataTypes.ENUM(
            'ACCIDENT',
            'BREAKDOWN',
            'MEDICAL',
            'STUDENT_INCIDENT',
            'SECURITY',
            'OTHER',
          ),
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'OPEN',
        },
        message: {
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
        accuracy: {
          type: DataTypes.DOUBLE,
          allowNull: true,
        },
        triggered_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        acknowledged_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        acknowledged_by_user_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        resolved_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        resolved_by_user_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        resolution_note: {
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

    // ---- Foreign keys (all tenant-pinned) -------------------------------
    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "fk_emergency_events_trip"
         FOREIGN KEY ("school_id", "trip_id")
         REFERENCES "trips" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "fk_emergency_events_bus"
         FOREIGN KEY ("school_id", "bus_id")
         REFERENCES "buses" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "fk_emergency_events_route"
         FOREIGN KEY ("school_id", "route_id")
         REFERENCES "routes" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "fk_emergency_events_raised_by"
         FOREIGN KEY ("school_id", "raised_by_user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // ---- Indexes --------------------------------------------------------
    // "What is open right now?" — the admin cockpit query.
    await queryInterface.addIndex('emergency_events', ['school_id', 'status'], {
      name: 'idx_emergency_events_school_status',
      transaction,
    });

    // History: "this school's incidents, newest first".
    await queryInterface.addIndex('emergency_events', ['school_id', 'triggered_at'], {
      name: 'idx_emergency_events_school_triggered',
      transaction,
    });

    await queryInterface.addIndex('emergency_events', ['school_id', 'trip_id'], {
      name: 'idx_emergency_events_school_trip',
      transaction,
    });

    await queryInterface.addIndex('emergency_events', ['school_id', 'bus_id'], {
      name: 'idx_emergency_events_school_bus',
      transaction,
    });

    // A crew member's own SOS history.
    await queryInterface.addIndex('emergency_events', ['school_id', 'raised_by_user_id'], {
      name: 'idx_emergency_events_school_raised_by',
      transaction,
    });

    // ---- Check constraints ---------------------------------------------
    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "ck_emergency_events_coordinates_pair"
         CHECK (("latitude" IS NULL) = ("longitude" IS NULL));`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "ck_emergency_events_latitude_range"
         CHECK ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90));`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "ck_emergency_events_longitude_range"
         CHECK ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180));`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "ck_emergency_events_accuracy_range"
         CHECK ("accuracy" IS NULL OR "accuracy" >= 0);`,
      { transaction },
    );

    // A resolved event always records when and by whom it was closed.
    await queryInterface.sequelize.query(
      `ALTER TABLE "emergency_events"
         ADD CONSTRAINT "ck_emergency_events_resolved_audit"
         CHECK ("resolved_at" IS NULL OR "resolved_by_user_id" IS NOT NULL);`,
      { transaction },
    );
  });
}

/** Safe rollback: drops the table and the two enum types it created. */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('emergency_events', { transaction });
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_emergency_events_type";', {
      transaction,
    });
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_emergency_events_status";', {
      transaction,
    });
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_emergency_events_raised_by_role";',
      { transaction },
    );
  });
}
