'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `document_requirements` table — the per-school required /
 * optional configuration of the compliance catalogue (Task 44).
 *
 * This is what turns "has this bus got everything?" into an answerable
 * question: a requirement says a document type is **mandatory** for buses (or
 * drivers) in this school, and the compliance engine then reports a
 * `MISSING` state for every required type with no document on file.
 *
 * Design notes:
 *
 * - **Overrides only.** A school stores a row only for a document type it has
 *   configured; every other type falls back to the built-in catalogue default
 *   in `@school-bus-tracking/shared-types`. New schools therefore need no
 *   seeding, and the product can still revise its defaults later without
 *   rewriting tenant data.
 * - **`document_type` is text, not an enum**, because one table serves both
 *   catalogues (`BusDocumentType` and `DriverDocumentType`) which PostgreSQL
 *   could not express with a single enum type. `owner_type` selects the
 *   catalogue and the API validates the value against it.
 * - **`expiry_warning_days` is per requirement**, so a school can watch an
 *   annual insurance policy (60 days) differently from a quarterly PUC
 *   (7 days).
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'document_requirements',
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
        owner_type: {
          type: DataTypes.ENUM('BUS', 'DRIVER'),
          allowNull: false,
        },
        document_type: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        is_required: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        expiry_warning_days: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 30,
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

    // ---- Indexes --------------------------------------------------------
    // One configuration row per document type per resource kind per school.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "uq_document_requirements_school_owner_type"
         ON "document_requirements" ("school_id", "owner_type", "document_type")
         WHERE "deleted_at" IS NULL;`,
      { transaction },
    );

    await queryInterface.addIndex('document_requirements', ['school_id', 'owner_type'], {
      name: 'idx_document_requirements_school_owner',
      transaction,
    });

    // ---- Check constraints ---------------------------------------------
    await queryInterface.sequelize.query(
      `ALTER TABLE "document_requirements"
         ADD CONSTRAINT "ck_document_requirements_warning_days"
         CHECK ("expiry_warning_days" BETWEEN 1 AND 365);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "document_requirements"
         ADD CONSTRAINT "ck_document_requirements_document_type"
         CHECK ("document_type" <> '');`,
      { transaction },
    );
  });
}

/** Safe rollback: drops the table and the enum type it created. */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('document_requirements', { transaction });
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_document_requirements_owner_type";',
      { transaction },
    );
  });
}
