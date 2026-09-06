'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op, col } from 'sequelize';

/**
 * Creates the `run_crew` table — one person, one role, one run, one effective
 * period.
 *
 * Structurally this is the same shape as `route_assignments`; the difference is
 * *what it points at*. `route_assignments` rosters a person onto a **route**,
 * which is why a route could only ever carry one driver: two rows for the same
 * role on the same route is `ROUTE_ROLE`, rejected outright. `run_crew`
 * rosters a person onto a **run**, so a route with three runs has three
 * drivers and the old rule simply no longer applies. See
 * `docs/operating-model.md` §4.2.
 *
 * One row = one person in one role for one period, which still covers:
 * - a driver *and* a conductor on the same run (two rows),
 * - crew rotation over time (`effective_from` / `effective_to`),
 * - the same person serving several runs sequentially — and, once Session 2
 *   moves the overlap test from dates to shift windows, several runs on the
 *   *same* day in disjoint bell windows.
 *
 * `effective_from` / `effective_to` stay `DATEONLY` on purpose: they answer
 * "who is rostered on this run this term?", a week/term-scale fact. The
 * intra-day question that unlocks tiering is answered by
 * `runs.shift_id → shifts.start_time/end_time`, not by these columns.
 *
 * Both references (`run_id`, `user_id`) are tenant-pinned composite foreign
 * keys on `(school_id, <entity>_id)`, so a roster entry can never combine a run
 * or a person from another school.
 *
 * ## Why a new enum type
 *
 * `enum_run_crew_role` has exactly the same values as the existing
 * `enum_route_assignments_role`. Reusing that type would save one
 * `CREATE TYPE` and cost independent evolution: `run_crew` is the roster that
 * will grow (a bus attendant/escort is a live requirement), while
 * `route_assignments` is frozen and on its way out. Sharing the type would make
 * a value added for one silently legal in the other. The values themselves stay
 * declared in `database/models/enums.ts`; the literals are repeated here
 * because a migration is an immutable record of a released schema.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'run_crew',
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
        run_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        role: {
          type: DataTypes.ENUM('DRIVER', 'CONDUCTOR'),
          allowNull: false,
        },
        effective_from: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        effective_to: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        is_active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
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
    // column, whereas the runtime supports a column list. The statement is
    // exactly what `addConstraint` emits for a composite key.
    await queryInterface.sequelize.query(
      `ALTER TABLE "run_crew"
         ADD CONSTRAINT "fk_run_crew_run"
         FOREIGN KEY ("school_id", "run_id")
         REFERENCES "runs" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "run_crew"
         ADD CONSTRAINT "fk_run_crew_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.addConstraint('run_crew', {
      type: 'check',
      name: 'ck_run_crew_effective_range',
      fields: ['effective_to'],
      where: {
        [Op.or]: [
          { effective_to: { [Op.eq]: null } },
          { effective_to: { [Op.gte]: col('effective_from') } },
        ],
      },
      transaction,
    });

    // The same person cannot be rostered twice for the same role on the same
    // run starting on the same day. Mirrors
    // `uq_route_assignments_route_user_role`.
    await queryInterface.addIndex('run_crew', ['run_id', 'user_id', 'role', 'effective_from'], {
      name: 'uq_run_crew_run_user_role',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // "Who drives run X today?"
    await queryInterface.addIndex('run_crew', ['run_id', 'role'], {
      name: 'idx_run_crew_run_role',
      transaction,
    });

    // The two (school_id, <entity>_id) indexes back the tenant-pinned
    // composite foreign keys and the tenant-scoped lookups.
    await queryInterface.addIndex('run_crew', ['school_id', 'run_id'], {
      name: 'idx_run_crew_school_run',
      transaction,
    });

    // "Which runs is this driver rostered on?" — the crew day view.
    await queryInterface.addIndex('run_crew', ['school_id', 'user_id'], {
      name: 'idx_run_crew_school_user',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('run_crew');
  await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_run_crew_role";');
}
