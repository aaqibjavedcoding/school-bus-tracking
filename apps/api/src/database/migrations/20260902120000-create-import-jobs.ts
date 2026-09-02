'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `import_jobs` table — the audit trail of every bulk Excel/CSV
 * import run (validation dry run and real import alike).
 *
 * Design notes:
 *
 * - **The uploaded file is never stored.** Keeping thousands of spreadsheets
 *   full of pupil data would be a data-protection liability and would require
 *   object storage this deployment does not have. Only the counters, the
 *   rejected rows (so the error workbook can be regenerated) and the actor are
 *   retained.
 * - **`school_id` is denormalised and tenant-pinned.** The actor foreign key is
 *   the composite `(school_id, imported_by) → users(school_id, id)`, so a run
 *   can never be attributed to a user of another tenant.
 * - **`module` / `mode` / `status` are plain VARCHARs, not PostgreSQL enums.**
 *   New importable modules are added by shipping a new definition file; a
 *   VARCHAR keeps that a code-only change, while the API validates the value
 *   against the shared `ImportModule` enum before writing.
 * - **JSONB payloads are bounded by the service** (the stored error list is
 *   capped) so a pathological upload cannot grow a row without limit.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'import_jobs',
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
        imported_by: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        module: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        mode: {
          type: DataTypes.STRING(16),
          allowNull: false,
        },
        file_name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
        },
        dry_run: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        total_rows: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        valid_rows: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        invalid_rows: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        created_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        updated_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        skipped_count: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        summary: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        errors: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: [],
        },
        unknown_columns: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: [],
        },
        missing_columns: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: [],
        },
        failure_reason: {
          type: DataTypes.STRING(500),
          allowNull: true,
        },
        completed_at: {
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

    // Tenant-pinned actor reference: the composite target guarantees the
    // uploader belongs to the same school as the job.
    await queryInterface.sequelize.query(
      `ALTER TABLE "import_jobs"
         ADD CONSTRAINT "fk_import_jobs_imported_by"
         FOREIGN KEY ("school_id", "imported_by")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    // History screen: "this school's runs, newest first".
    await queryInterface.addIndex('import_jobs', ['school_id', 'created_at'], {
      name: 'idx_import_jobs_school_created',
      transaction,
    });

    // Module filter on the history screen.
    await queryInterface.addIndex('import_jobs', ['school_id', 'module'], {
      name: 'idx_import_jobs_school_module',
      transaction,
    });

    // "What did this admin import?"
    await queryInterface.addIndex('import_jobs', ['school_id', 'imported_by'], {
      name: 'idx_import_jobs_school_actor',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('import_jobs');
}
