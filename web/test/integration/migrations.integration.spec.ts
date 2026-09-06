import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  createTestSequelize,
  ensureTestDatabase,
  resetSchema,
  runMigrations,
  undoAllMigrations,
} from '../support/database';

/**
 * Migration integration test — real PostgreSQL, real sequelize-cli runner.
 *
 * Proves that the shipped migrations bring an **empty** database up to the
 * full schema (and back down again), which is exactly what a fresh
 * environment or a CI job does.
 */
describe('migrations against a real PostgreSQL database', () => {
  let sequelize: Sequelize;

  before(async () => {
    await ensureTestDatabase();
    await resetSchema();
    runMigrations();
    sequelize = createTestSequelize({ withModels: false });
    await sequelize.authenticate();
  });

  after(async () => {
    await sequelize?.close();
  });

  it('creates every expected table from an empty database', async () => {
    const rows = await sequelize.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      { type: QueryTypes.SELECT },
    );
    const tables = new Set(rows.map((row) => row.tablename));

    for (const expected of [
      'schools',
      'users',
      'buses',
      'routes',
      'stops',
      'students',
      'student_guardians',
      'route_assignments',
      'shifts',
      'runs',
      'run_crew',
      'trips',
      'trip_student_attendance',
      'trip_locations',
      'trip_stop_arrivals',
      'refresh_tokens',
      'notifications',
      'plans',
      'school_subscriptions',
      'bus_documents',
      'driver_documents',
      'document_requirements',
      'emergency_events',
      'SequelizeMeta',
    ]) {
      assert.ok(tables.has(expected), `missing table: ${expected}`);
    }
  });

  it('records every migration file exactly once', async () => {
    const applied = await sequelize.query<{ name: string }>(
      'SELECT name FROM "SequelizeMeta" ORDER BY name',
      { type: QueryTypes.SELECT },
    );
    const names = applied.map((row) => row.name);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.length >= 23, `expected the full migration set, got ${names.length}`);
    assert.ok(
      names.includes('20260906120400-backfill-default-runs.ts'),
      'the default-run backfill must be part of the applied set',
    );
    assert.ok(names[0].startsWith('20260827120000-create-schools'));
  });

  it('is idempotent: re-running the migrator applies nothing new', async () => {
    const before = await sequelize.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "SequelizeMeta"',
      { type: QueryTypes.SELECT },
    );
    runMigrations();
    const after = await sequelize.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "SequelizeMeta"',
      { type: QueryTypes.SELECT },
    );
    assert.equal(after[0].count, before[0].count);
  });

  it('creates the tenant-critical indexes and constraints', async () => {
    const indexes = await sequelize.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      { type: QueryTypes.SELECT },
    );
    const names = new Set(indexes.map((row) => row.indexname));
    assert.ok(names.has('uq_school_subscriptions_live_school'));

    const constraints = await sequelize.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint`,
      { type: QueryTypes.SELECT },
    );
    const conNames = new Set(constraints.map((row) => row.conname));
    assert.ok(conNames.has('ck_school_subscriptions_status_not_none'));
    assert.ok(conNames.has('fk_school_subscriptions_school'));
    assert.ok(conNames.has('fk_school_subscriptions_plan'));
  });

  it('creates the operating-model indexes and constraints', async () => {
    const indexes = await sequelize.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      { type: QueryTypes.SELECT },
    );
    const names = new Set(indexes.map((row) => row.indexname));

    // `uq_<table>_school_id` is what makes the tenant-pinned composite foreign
    // keys possible, so it has to exist on every new table.
    for (const expected of ['uq_shifts_school_id', 'uq_runs_school_id']) {
      assert.ok(names.has(expected), `missing index: ${expected}`);
    }
    for (const expected of [
      // One default run per route — the back-compat invariant.
      'uq_runs_route_default',
      'uq_runs_school_code',
      'uq_run_crew_run_user_role',
      'uq_shifts_school_name',
      'uq_trips_run_scheduled_start',
      'idx_runs_school_bus',
      'idx_runs_school_shift',
      'idx_students_school_run',
      'idx_trips_school_run',
    ]) {
      assert.ok(names.has(expected), `missing index: ${expected}`);
    }

    const constraints = await sequelize.query<{ conname: string; condef: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS condef FROM pg_constraint`,
      { type: QueryTypes.SELECT },
    );
    const byName = new Map(constraints.map((row) => [row.conname, row.condef]));

    assert.ok(byName.has('ck_shifts_window'));
    assert.ok(byName.has('ck_run_crew_effective_range'));

    // Every new entity reference must be tenant-pinned, i.e. composite on
    // (school_id, <entity>_id). A single-column key here would let one school's
    // rows point at another school's resources.
    for (const name of [
      'fk_runs_route',
      'fk_runs_shift',
      'fk_runs_bus',
      'fk_run_crew_run',
      'fk_run_crew_user',
      'fk_students_run',
      'fk_trips_run',
    ]) {
      const definition = byName.get(name);
      assert.ok(definition, `missing constraint: ${name}`);
      assert.match(definition!, /FOREIGN KEY \(school_id, /, `${name} is not tenant-pinned`);
    }
  });

  it('keeps run_crew on its own enum type so it can evolve separately', async () => {
    const types = await sequelize.query<{ typname: string }>(
      `SELECT t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('enum_run_crew_role', 'enum_route_assignments_role')
        GROUP BY t.typname`,
      { type: QueryTypes.SELECT },
    );
    assert.deepEqual(
      types.map((row) => row.typname).sort(),
      ['enum_route_assignments_role', 'enum_run_crew_role'],
    );
  });

  it('rolls all the way back down and up again', async () => {
    undoAllMigrations();
    const remaining = await sequelize.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'SequelizeMeta'`,
      { type: QueryTypes.SELECT },
    );
    assert.deepEqual(remaining, []);

    runMigrations();
    const rebuilt = await sequelize.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schools'`,
      { type: QueryTypes.SELECT },
    );
    assert.equal(rebuilt.length, 1);
  });
});
