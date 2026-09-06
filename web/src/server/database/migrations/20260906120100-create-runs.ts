'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `runs` table — one vehicle's timed pass over one route.
 *
 * This is the table the operating-model refactor (`docs/operating-model.md`)
 * exists to add. Until now `routes` owned both the path *and* the resources
 * driving it, so one route could only ever hold one bus and one crew pair:
 * the conflict engine compares `route_assignments.effective_from/to`, which are
 * `DATEONLY`, and therefore treats "the same bus at 07:00 and at 13:00" as a
 * clash. Splitting the *path* (`routes`) from the *pass* (`runs`) is what makes
 * several runs — and so tiering — expressible at all.
 *
 * A run's clock is its shift; it deliberately carries no times of its own.
 * Storing a window on both `runs` and `shifts` would create two sources of
 * truth that eventually disagree.
 *
 * ## Column decisions
 *
 * - `shift_id` is nullable. The backfill in
 *   `20260906120400-backfill-default-runs.ts` creates one default run per
 *   pre-existing route, and those schools have not defined a single shift yet.
 *   Inventing a synthetic "Default" shift inside a data migration would write
 *   reference data no operator chose. A `NULL` shift is treated by the Session
 *   2 conflict rules as *occupying the whole day*, which reproduces today's
 *   behaviour exactly for every legacy route — see `docs/operating-model.md`
 *   §4.3. Tightening this to `NOT NULL` is a later migration with its own
 *   `down()`.
 * - `bus_id` is nullable for the same reason `route_assignments.bus_id` is: the
 *   fleet can be undecided when a run is first planned. `ON DELETE SET NULL`
 *   keeps the run (and its trips and riders) when a bus is retired.
 * - `is_default` marks the auto-provisioned back-compat run. It is server-only
 *   and is never accepted from a client. `uq_runs_route_default` makes the
 *   back-compat invariant — *at most one default run per route* — a database
 *   guarantee rather than a convention.
 *
 * All three entity references (`route_id`, `shift_id`, `bus_id`) are
 * tenant-pinned composite foreign keys on `(school_id, <entity>_id)`, so a run
 * can never combine a route, shift or vehicle from another school.
 *
 * The non-partial `uq_runs_school_id` index is created here because it is the
 * target key for the tenant-pinned composite foreign keys from `run_crew`,
 * `trips` and `students` added by the migrations that follow. A primary key on
 * `id` alone is not sufficient for a composite foreign key.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'runs',
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
        route_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        shift_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        bus_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        code: {
          type: DataTypes.STRING(32),
          allowNull: false,
        },
        is_default: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
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
      `ALTER TABLE "runs"
         ADD CONSTRAINT "fk_runs_route"
         FOREIGN KEY ("school_id", "route_id")
         REFERENCES "routes" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "runs"
         ADD CONSTRAINT "fk_runs_shift"
         FOREIGN KEY ("school_id", "shift_id")
         REFERENCES "shifts" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE "runs"
         ADD CONSTRAINT "fk_runs_bus"
         FOREIGN KEY ("school_id", "bus_id")
         REFERENCES "buses" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE SET NULL;`,
      { transaction },
    );

    await queryInterface.addIndex('runs', ['school_id', 'id'], {
      name: 'uq_runs_school_id',
      unique: true,
      transaction,
    });

    // A parent must never be told "bus R-01" when two live runs share a code.
    await queryInterface.addIndex('runs', ['school_id', 'code'], {
      name: 'uq_runs_school_code',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // The back-compat invariant: one default run per route, enforced here
    // rather than in application code so no future write path can break it.
    await queryInterface.addIndex('runs', ['route_id'], {
      name: 'uq_runs_route_default',
      unique: true,
      where: { deleted_at: null, is_default: true },
      transaction,
    });

    // "All runs of this route."
    await queryInterface.addIndex('runs', ['school_id', 'route_id'], {
      name: 'idx_runs_school_route',
      transaction,
    });

    // "Everything in the morning shift."
    await queryInterface.addIndex('runs', ['school_id', 'shift_id'], {
      name: 'idx_runs_school_shift',
      transaction,
    });

    // "What is this bus doing today?" — the tiering / bus day view.
    await queryInterface.addIndex('runs', ['school_id', 'bus_id'], {
      name: 'idx_runs_school_bus',
      transaction,
    });

    // Plan-limit usage counts active rows only.
    await queryInterface.addIndex('runs', ['school_id', 'is_active'], {
      name: 'idx_runs_school_active',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('runs');
}
