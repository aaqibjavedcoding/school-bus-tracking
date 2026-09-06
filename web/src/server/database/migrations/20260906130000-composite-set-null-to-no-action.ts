'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Converts 15 composite foreign keys from `ON DELETE SET NULL` to
 * `ON DELETE NO ACTION`.
 *
 * ## Why this matters
 *
 * PostgreSQL's `ON DELETE SET NULL` on a **multi-column** foreign key nulls
 * *every* referencing column, including the non-nullable `school_id`. Because
 * `school_id IS NOT NULL` on every tenant table, a hard delete of a referenced
 * row is *refused* by the not-null constraint rather than silently orphaning
 * the row — but the error is a not-null violation, not a named foreign-key
 * error, which makes it confusing to debug.
 *
 * `ON DELETE NO ACTION` produces the same *behaviour* (the delete is refused
 * while referrers exist) but PostgreSQL names the constraint in the error:
 *
 *   ERROR: 23503: update or delete on table "runs" violates foreign key
 *   constraint "fk_students_run" on table "students"
 *
 * This is strictly better: the operator can see exactly which constraint is
 * blocking the delete and which table is referencing the row.
 *
 * The migration converts all 15 composite SET NULL keys across the schema:
 *
 *  1. fk_students_home_stop           students
 *  2. fk_route_assignments_bus        route_assignments
 *  3. fk_trips_bus                    trips
 *  4. fk_trips_driver                 trips
 *  5. fk_trips_conductor              trips
 *  6. fk_trip_student_attendance_stop       trip_student_attendance
 *  7. fk_trip_student_attendance_boarded_by trip_student_attendance
 *  8. fk_trip_student_attendance_dropped_by trip_student_attendance
 *  9. fk_runs_shift                   runs
 * 10. fk_runs_bus                     runs
 * 11. fk_students_run                 students
 * 12. fk_trips_run                    trips
 * 13. fk_emergency_events_trip        emergency_events
 * 14. fk_emergency_events_bus         emergency_events
 * 15. fk_emergency_events_route       emergency_events
 *
 * `fk_import_jobs_imported_by` is intentionally excluded: it was converted to a
 * single-column key by `20260903120200-relax-import-jobs-actor-fk.ts` so that
 * platform `SUPER_ADMIN` rows (whose `school_id IS NULL`) can be actors. A
 * single-column SET NULL on `imported_by` alone is safe — nulling `imported_by`
 * is the intended behaviour when the actor account is removed.
 *
 * The `down()` reverses the change, restoring SET NULL so that the
 * backfill's `undoThroughMigration()` path is intact and the test suite's
 * `undoThroughMigration` helper still targets the backfill correctly.
 *
 * @see docs/operating-model.md §3.7 (the hazard this migration fixes)
 */

/** All composite FKs with ON DELETE SET NULL that must become NO ACTION. */
const COMPOSITE_SET_NULL_FKS: Array<{
  table: string;
  constraint: string;
  columns: string[];
  targetTable: string;
  targetColumns: string[];
}> = [
  {
    table: 'students',
    constraint: 'fk_students_home_stop',
    columns: ['school_id', 'home_stop_id'],
    targetTable: 'stops',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'route_assignments',
    constraint: 'fk_route_assignments_bus',
    columns: ['school_id', 'bus_id'],
    targetTable: 'buses',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trips',
    constraint: 'fk_trips_bus',
    columns: ['school_id', 'bus_id'],
    targetTable: 'buses',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trips',
    constraint: 'fk_trips_driver',
    columns: ['school_id', 'driver_id'],
    targetTable: 'users',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trips',
    constraint: 'fk_trips_conductor',
    columns: ['school_id', 'conductor_id'],
    targetTable: 'users',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trip_student_attendance',
    constraint: 'fk_trip_student_attendance_stop',
    columns: ['school_id', 'stop_id'],
    targetTable: 'stops',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trip_student_attendance',
    constraint: 'fk_trip_student_attendance_boarded_by',
    columns: ['school_id', 'boarded_by'],
    targetTable: 'users',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trip_student_attendance',
    constraint: 'fk_trip_student_attendance_dropped_by',
    columns: ['school_id', 'dropped_by'],
    targetTable: 'users',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'runs',
    constraint: 'fk_runs_shift',
    columns: ['school_id', 'shift_id'],
    targetTable: 'shifts',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'runs',
    constraint: 'fk_runs_bus',
    columns: ['school_id', 'bus_id'],
    targetTable: 'buses',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'students',
    constraint: 'fk_students_run',
    columns: ['school_id', 'run_id'],
    targetTable: 'runs',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'trips',
    constraint: 'fk_trips_run',
    columns: ['school_id', 'run_id'],
    targetTable: 'runs',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'emergency_events',
    constraint: 'fk_emergency_events_trip',
    columns: ['school_id', 'trip_id'],
    targetTable: 'trips',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'emergency_events',
    constraint: 'fk_emergency_events_bus',
    columns: ['school_id', 'bus_id'],
    targetTable: 'buses',
    targetColumns: ['school_id', 'id'],
  },
  {
    table: 'emergency_events',
    constraint: 'fk_emergency_events_route',
    columns: ['school_id', 'route_id'],
    targetTable: 'routes',
    targetColumns: ['school_id', 'id'],
  },
];

function alterFk(
  table: string,
  constraint: string,
  columns: string[],
  targetTable: string,
  targetColumns: string[],
  onDelete: 'SET NULL' | 'NO ACTION',
): string {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const target = targetColumns.map((c) => `"${c}"`).join(', ');
  return `
  ALTER TABLE "${table}"
    DROP CONSTRAINT IF EXISTS "${constraint}";
  ALTER TABLE "${table}"
    ADD CONSTRAINT "${constraint}"
    FOREIGN KEY (${cols})
    REFERENCES "${targetTable}" (${target})
    ON UPDATE CASCADE
    ON DELETE ${onDelete};`.trim();
}

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const fk of COMPOSITE_SET_NULL_FKS) {
      await queryInterface.sequelize.query(
        alterFk(
          fk.table,
          fk.constraint,
          fk.columns,
          fk.targetTable,
          fk.targetColumns,
          'NO ACTION',
        ),
        { transaction },
      );
    }
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const fk of COMPOSITE_SET_NULL_FKS) {
      await queryInterface.sequelize.query(
        alterFk(
          fk.table,
          fk.constraint,
          fk.columns,
          fk.targetTable,
          fk.targetColumns,
          'SET NULL',
        ),
        { transaction },
      );
    }
  });
}
