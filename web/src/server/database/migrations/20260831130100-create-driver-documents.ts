'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Creates the `driver_documents` table — the compliance documents of one crew
 * member (Task 44).
 *
 * The driving licence is the headline document (`DRIVING_LICENSE` with its
 * `document_number` = the licence number), and the same table carries the
 * other documents a school may require: medical certificate, police
 * verification, training certificate, ID proof or anything else (`OTHER`).
 *
 * The rules are identical to `bus_documents` — derived validity, no stored
 * status, renewals as new rows, file references instead of blobs — so the two
 * tables stay symmetric and the compliance engine can treat them alike:
 *
 * - `expiry_date IS NULL` → the document never expires (status `VALID`).
 * - Otherwise `VALID` / `EXPIRING_SOON` / `EXPIRED` come from the real date.
 *
 * The crew reference is tenant-pinned (`(school_id, driver_id)` → `users
 * (school_id, id)`), so a document can never be attached to another school's
 * employee.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'driver_documents',
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
        driver_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        document_type: {
          type: DataTypes.ENUM(
            'DRIVING_LICENSE',
            'MEDICAL_CERTIFICATE',
            'POLICE_VERIFICATION',
            'TRAINING_CERTIFICATE',
            'ID_PROOF',
            'OTHER',
          ),
          allowNull: false,
        },
        document_number: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        issue_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        expiry_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        file_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        file_url: {
          type: DataTypes.STRING(512),
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

    await queryInterface.sequelize.query(
      `ALTER TABLE "driver_documents"
         ADD CONSTRAINT "fk_driver_documents_driver"
         FOREIGN KEY ("school_id", "driver_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // ---- Indexes --------------------------------------------------------
    await queryInterface.addIndex('driver_documents', ['school_id', 'driver_id'], {
      name: 'idx_driver_documents_school_driver',
      transaction,
    });

    await queryInterface.addIndex(
      'driver_documents',
      ['school_id', 'document_type', 'expiry_date'],
      { name: 'idx_driver_documents_school_type_expiry', transaction },
    );

    await queryInterface.addIndex('driver_documents', ['school_id', 'expiry_date'], {
      name: 'idx_driver_documents_school_expiry',
      transaction,
    });

    // ---- Check constraints ---------------------------------------------
    await queryInterface.addConstraint('driver_documents', {
      type: 'check',
      name: 'ck_driver_documents_date_range',
      fields: ['expiry_date'],
      where: {
        [Op.or]: [
          { issue_date: { [Op.eq]: null } },
          { expiry_date: { [Op.eq]: null } },
          { expiry_date: { [Op.gte]: { [Op.col]: 'driver_documents.issue_date' } } },
        ],
      },
      transaction,
    });

    await queryInterface.sequelize.query(
      `ALTER TABLE "driver_documents"
         ADD CONSTRAINT "ck_driver_documents_file_url_scheme"
         CHECK ("file_url" IS NULL OR "file_url" LIKE 'http://%' OR "file_url" LIKE 'https://%');`,
      { transaction },
    );
  });
}

/** Safe rollback: drops the table and the enum type it created. */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('driver_documents', { transaction });
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_driver_documents_document_type";',
      { transaction },
    );
  });
}
