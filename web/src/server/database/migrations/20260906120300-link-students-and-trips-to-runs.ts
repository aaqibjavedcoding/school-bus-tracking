'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op } from 'sequelize';

/**
 * Attaches `students` and `trips` to a run.
 *
 * Two nullable `run_id` columns, both tenant-pinned through the composite
 * foreign key `(school_id, run_id) → runs(school_id, id)` (enforced through
 * `uq_runs_school_id`), both indexed.
 *
 * ## Why nullable
 *
 * - `students.run_id`: a pupil can be enrolled before transport is allocated —
 *   the same reasoning that keeps `students.home_stop_id` nullable. PostgreSQL
 *   skips a composite foreign-key check while any referencing column is NULL,
 *   so an unassigned student stays valid, and once set the run is guaranteed to
 *   belong to the same school.
 * - `trips.run_id`: the column is added *before*
 *   `20260906120400-backfill-default-runs.ts` populates it, and a `NOT NULL`
 *   here would make the two steps impossible to separate. Migrations run in one
 *   transaction each, not as one transaction overall.
 *
 * Both are `ON DELETE SET NULL`: retiring a run unassigns its riders and
 * detaches its trips instead of deleting or blocking them. That is the only
 * behaviour safe to run unattended.
 *
 * One caveat, which applies to every composite `ON DELETE SET NULL` key in this
 * schema (11 shipped before this migration): PostgreSQL nulls *every*
 * referencing column of a multi-column key, `school_id` included, so a hard
 * delete of a referenced run is **refused** by the `school_id` NOT NULL rather
 * than silently orphaning the row. Fail-safe, and it never fires in normal
 * operation because every model is `paranoid` — but it does mean hard deletes
 * must remove referrers first. See `docs/operating-model.md` §3.7.
 *
 * ## Uniqueness
 *
 * `uq_trips_run_scheduled_start` is the run-level successor to
 * `uq_trips_route_scheduled_start`: one open trip per run per scheduled
 * departure. The `run_id IS NOT NULL` predicate keeps the index small during
 * the transition — rows with a NULL run are never in conflict anyway, because
 * NULLs are distinct in a PostgreSQL unique index — and it is what lets the
 * column stay nullable until the backfill lands.
 *
 * `uq_trips_route_scheduled_start` is deliberately **kept**. It is still true
 * and still useful: two runs of the same route should not depart at the same
 * instant, because their stops are shared and the resulting manifest would be
 * ambiguous. Dropping it here would remove a guarantee before the rule that
 * replaces it exists. `docs/operating-model.md` §3.5 records the decision and
 * leaves the call to Session 2.
 *
 * `home_stop_id` is not touched: the stop is still where the child is
 * physically picked up, and the ETA/geofence machinery is built on it.
 * `run_id` answers a different question — *which vehicle*.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // ---------------------------------------------------------------- students

    await queryInterface.addColumn(
      'students',
      'run_id',
      {
        type: DataTypes.UUID,
        allowNull: true,
      },
      { transaction },
    );

    // Composite (tenant-pinned) foreign keys are written as explicit SQL:
    // Sequelize v6 types describe `addConstraint` references as a single
    // column, whereas the runtime supports a column list. The statement is
    // exactly what `addConstraint` emits for a composite key.
    await queryInterface.sequelize.query(
      `ALTER TABLE "students"
         ADD CONSTRAINT "fk_students_run"
         FOREIGN KEY ("school_id", "run_id")
         REFERENCES "runs" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    // "Who rides this run?" — the manifest, and the plan for the parent view
    // that shows an exact bus number.
    await queryInterface.addIndex('students', ['school_id', 'run_id'], {
      name: 'idx_students_school_run',
      transaction,
    });

    // ------------------------------------------------------------------- trips

    await queryInterface.addColumn(
      'trips',
      'run_id',
      {
        type: DataTypes.UUID,
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "trips"
         ADD CONSTRAINT "fk_trips_run"
         FOREIGN KEY ("school_id", "run_id")
         REFERENCES "runs" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.addIndex('trips', ['run_id', 'scheduled_start_at'], {
      name: 'uq_trips_run_scheduled_start',
      unique: true,
      where: { deleted_at: null, run_id: { [Op.ne]: null } },
      transaction,
    });

    await queryInterface.addIndex('trips', ['school_id', 'run_id'], {
      name: 'idx_trips_school_run',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Trips first: nothing else references them, and the unique index has to
    // go before the column it is built on.
    await queryInterface.removeIndex('trips', 'idx_trips_school_run', { transaction });
    await queryInterface.removeIndex('trips', 'uq_trips_run_scheduled_start', { transaction });
    await queryInterface.removeColumn('trips', 'run_id', { transaction });

    await queryInterface.removeIndex('students', 'idx_students_school_run', { transaction });
    await queryInterface.removeColumn('students', 'run_id', { transaction });
  });
}
