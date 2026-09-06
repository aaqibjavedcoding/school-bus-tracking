'use strict';

import { Op, type QueryInterface } from 'sequelize';

/**
 * Adds the Session 2B dual-write mirror link: `route_assignments.run_crew_id`.
 *
 * During the migration period (`docs/operating-model.md` §6.3) `run_crew` is
 * the authoritative per-run roster and every create/update goes through
 * `RunCrewService`; `route_assignments` stays readable (legacy reads, reports)
 * and is now **written as a mirror** of the row it mirrors. Without a link the
 * service would have to match mirrors by a natural key that several crew rows
 * can legitimately share (two runs of one route can roster the same person in
 * the same role from the same date), so an update/delete could not reliably
 * find "its" mirror. The column is an internal, nullable bookkeeping field:
 * it never appears in API responses and `route_assignments` semantics for
 * existing clients are unchanged.
 *
 * The foreign key is composite and tenant pinned like every other reference,
 * and `ON DELETE NO ACTION` (the convention established by
 * `20260906130000-composite-set-null-to-no-action.ts`) so a hard delete of a
 * crew row names this constraint instead of failing on `school_id IS NOT
 * NULL`. Soft deletes (the only path the application uses) fire no FK action
 * at all. Seeder purges already delete `route_assignments` before `run_crew`
 * (`purgeSchool`), so the deletion ordering constraint of §3.7 is satisfied.
 *
 * The partial unique index keeps the mirror 1:1 at the database level: one
 * `route_assignments` row mirrors at most one `run_crew` row.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // The composite FK below references `(school_id, id)`, so `run_crew`
    // needs the same non-partial unique index every other tenant-pinned
    // table has (see 20260906120000/20260906120100).
    await queryInterface.addIndex('run_crew', ['school_id', 'id'], {
      name: 'uq_run_crew_school_id',
      unique: true,
      transaction,
    });
    await queryInterface.addColumn(
      'route_assignments',
      'run_crew_id',
      { type: 'UUID', allowNull: true },
      { transaction },
    );
    await queryInterface.addIndex('route_assignments', ['run_crew_id'], {
      name: 'uq_route_assignments_run_crew',
      unique: true,
      where: { run_crew_id: { [Op.ne]: null } },
      transaction,
    });
    await queryInterface.sequelize.query(
      `ALTER TABLE "route_assignments"
        ADD CONSTRAINT "fk_route_assignments_run_crew"
        FOREIGN KEY ("school_id", "run_crew_id")
        REFERENCES "run_crew" ("school_id", "id")
        ON UPDATE CASCADE
        ON DELETE NO ACTION;`,
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE "route_assignments" DROP CONSTRAINT IF EXISTS "fk_route_assignments_run_crew";',
      { transaction },
    );
    await queryInterface.removeIndex('route_assignments', 'uq_route_assignments_run_crew', {
      transaction,
    });
    await queryInterface.removeColumn('route_assignments', 'run_crew_id', { transaction });
    await queryInterface.removeIndex('run_crew', 'uq_run_crew_school_id', { transaction });
  });
}
