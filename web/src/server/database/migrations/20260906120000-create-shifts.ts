'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes, Op, col } from 'sequelize';

/**
 * Creates the `shifts` table — a school's bell windows (07:00–11:00,
 * 12:00–17:00).
 *
 * A shift is the *time* half of the operating model described in
 * `docs/operating-model.md`. A route is a path; a `run` is one vehicle's timed
 * pass over that path, and its clock is its shift. Because two shifts are
 * disjoint by construction, the same bus and the same crew member can legally
 * hold runs in both — that is tiering, and it is the whole reason this table
 * exists.
 *
 * `start_time` / `end_time` are `time`, deliberately not `timestamptz`: a bell
 * window is a wall-clock rule that repeats every day, so it must not carry an
 * instant (and therefore a timezone or DST question) into reference data. The
 * instant a concrete trip departs stays `timestamptz` on
 * `trips.scheduled_start_at`.
 *
 * `ck_shifts_window` rejects a zero-length or inverted window. Overnight
 * windows are not a school-transport concept; if they ever become one, this
 * check is the single line to revisit.
 *
 * The non-partial `uq_shifts_school_id` index is created here because it is the
 * target key for the tenant-pinned composite foreign key
 * `runs(school_id, shift_id) → shifts(school_id, id)`. A primary key on `id`
 * alone is not sufficient for a composite foreign key.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'shifts',
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
        name: {
          type: DataTypes.STRING(80),
          allowNull: false,
        },
        start_time: {
          type: DataTypes.TIME,
          allowNull: false,
        },
        end_time: {
          type: DataTypes.TIME,
          allowNull: false,
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

    // Same `addConstraint` + `col()` form the other range guards in this
    // schema use (`ck_route_assignments_effective_range`,
    // `ck_trips_scheduled_range`), so every CHECK reads the same way.
    await queryInterface.addConstraint('shifts', {
      type: 'check',
      name: 'ck_shifts_window',
      fields: ['end_time'],
      where: {
        end_time: { [Op.gt]: col('start_time') },
      },
      transaction,
    });

    await queryInterface.addIndex('shifts', ['school_id', 'id'], {
      name: 'uq_shifts_school_id',
      unique: true,
      transaction,
    });

    await queryInterface.addIndex('shifts', ['school_id', 'name'], {
      name: 'uq_shifts_school_name',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    await queryInterface.addIndex('shifts', ['school_id', 'is_active'], {
      name: 'idx_shifts_school_active',
      transaction,
    });

    // "Which shifts cover 09:00?" — the window query the tiering rules run.
    await queryInterface.addIndex('shifts', ['school_id', 'start_time', 'end_time'], {
      name: 'idx_shifts_school_window',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('shifts');
}
