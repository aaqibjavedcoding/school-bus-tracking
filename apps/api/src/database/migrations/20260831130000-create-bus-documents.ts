'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';
import { Op } from 'sequelize';

/**
 * Creates the `bus_documents` table — the compliance documents of one school
 * bus (Task 44).
 *
 * Design notes:
 *
 * - **Validity is not a column.** Only `issue_date` / `expiry_date` are
 *   stored; the `VALID` / `EXPIRING_SOON` / `EXPIRED` status is derived on
 *   every read from `expiry_date`, so an expired certificate can never be
 *   presented as valid. A `NULL` expiry means the document has no expiry date
 *   (a lifetime registration, for example) and therefore never expires.
 * - **Renewals are new rows.** The table keeps the full history of a
 *   document type on a bus; the API computes compliance from the newest row
 *   of each type, so re-issuing an insurance policy never destroys evidence.
 * - **Files are references, not blobs.** `file_name` / `file_url` point at a
 *   document in the school's own store — the self-hosted stack has no object
 *   storage of its own, so no upload pipeline is introduced here.
 * - Dates are `DATEONLY`: a certificate expires on a calendar day, and
 *   storing a plain date removes every timezone ambiguity from compliance
 *   maths.
 *
 * The vehicle reference is tenant-pinned (`(school_id, bus_id)` → `buses
 * (school_id, id)`) and cascades, so deleting a bus removes its documents.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'bus_documents',
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
        bus_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        document_type: {
          type: DataTypes.ENUM(
            'REGISTRATION_CERTIFICATE',
            'INSURANCE',
            'FITNESS_CERTIFICATE',
            'PERMIT',
            'POLLUTION_CERTIFICATE',
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

    // Tenant-pinned composite foreign keys (Sequelize v6 types only describe a
    // single-column `addConstraint` reference, so the composite form is
    // written as the exact SQL the runtime would emit).
    await queryInterface.sequelize.query(
      `ALTER TABLE "bus_documents"
         ADD CONSTRAINT "fk_bus_documents_bus"
         FOREIGN KEY ("school_id", "bus_id")
         REFERENCES "buses" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // ---- Indexes --------------------------------------------------------
    await queryInterface.addIndex('bus_documents', ['school_id', 'bus_id'], {
      name: 'idx_bus_documents_school_bus',
      transaction,
    });

    // Compliance sweeps: "every insurance policy of this school".
    await queryInterface.addIndex('bus_documents', ['school_id', 'document_type', 'expiry_date'], {
      name: 'idx_bus_documents_school_type_expiry',
      transaction,
    });

    // "Everything of this school that expires in the next N days".
    await queryInterface.addIndex('bus_documents', ['school_id', 'expiry_date'], {
      name: 'idx_bus_documents_school_expiry',
      transaction,
    });

    // ---- Check constraints ---------------------------------------------
    await queryInterface.addConstraint('bus_documents', {
      type: 'check',
      name: 'ck_bus_documents_date_range',
      fields: ['expiry_date'],
      where: {
        [Op.or]: [
          { issue_date: { [Op.eq]: null } },
          { expiry_date: { [Op.eq]: null } },
          { expiry_date: { [Op.gte]: { [Op.col]: 'bus_documents.issue_date' } } },
        ],
      },
      transaction,
    });

    // A reference URL is only useful if it is an http(s) link.
    await queryInterface.sequelize.query(
      `ALTER TABLE "bus_documents"
         ADD CONSTRAINT "ck_bus_documents_file_url_scheme"
         CHECK ("file_url" IS NULL OR "file_url" LIKE 'http://%' OR "file_url" LIKE 'https://%');`,
      { transaction },
    );
  });
}

/** Safe rollback: drops the table and the enum type it created. */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('bus_documents', { transaction });
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_bus_documents_document_type";',
      {
        transaction,
      },
    );
  });
}
