import { QueryInterface } from 'sequelize';

/**
 * Allows platform operators to be recorded as the actor of an import run.
 *
 * `import_jobs` previously pinned its actor with the composite foreign key
 * `(school_id, imported_by) → users(school_id, id)` so a run could never be
 * attributed to a user of another tenant. That composite can never match a
 * platform `SUPER_ADMIN` (their `users.school_id` is NULL), so an assisted
 * import run through `Super Admin → Manage Data` would violate the constraint
 * and lose its history row.
 *
 * The reference becomes a plain `imported_by → users(id)`. Attribution is
 * still correct: the application layer forces `school_id` from the guarded
 * route and `imported_by` from the verified JWT — neither is client-sourced —
 * and the history queries are tenant-pinned as before. `ON DELETE SET NULL`
 * keeps every run after its actor account is removed.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE "import_jobs"
       DROP CONSTRAINT IF EXISTS "fk_import_jobs_imported_by";`,
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE "import_jobs"
       ADD CONSTRAINT "fk_import_jobs_imported_by"
       FOREIGN KEY ("imported_by")
       REFERENCES "users" ("id")
       ON UPDATE CASCADE
       ON DELETE SET NULL;`,
  );
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // Runs whose actor is a platform operator (users.school_id IS NULL) block
  // the composite constraint; detach them first, mirroring the column staying
  // nullable.
  await queryInterface.sequelize.query(
    `UPDATE "import_jobs"
        SET "imported_by" = NULL
      WHERE "imported_by" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "users"
           WHERE "users"."id" = "import_jobs"."imported_by"
             AND "users"."school_id" = "import_jobs"."school_id"
        );`,
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE "import_jobs"
       DROP CONSTRAINT IF EXISTS "fk_import_jobs_imported_by";`,
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE "import_jobs"
       ADD CONSTRAINT "fk_import_jobs_imported_by"
       FOREIGN KEY ("school_id", "imported_by")
       REFERENCES "users" ("school_id", "id")
       ON UPDATE CASCADE
       ON DELETE SET NULL;`,
  );
}
