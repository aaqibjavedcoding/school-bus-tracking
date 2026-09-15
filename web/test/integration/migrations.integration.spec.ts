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
      'crew_pairing_tokens',
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

  /**
   * Crew PIN + QR pairing schema (Mobile-UX Phase 4).
   *
   * These are the assertions that only a real PostgreSQL can make: that the
   * columns are genuinely nullable (so every pre-existing user is untouched),
   * that the crew-only CHECK constraint is installed *and actually refuses a
   * PIN on a non-crew row*, and that the pairing table's foreign key is
   * tenant-pinned the way every other entity reference in this schema is.
   */
  it('creates the crew PIN columns as nullable and leaves existing users untouched', async () => {
    const columns = await sequelize.query<{
      column_name: string;
      is_nullable: string;
      data_type: string;
    }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN ('pin_hash', 'pin_updated_at')`,
      { type: QueryTypes.SELECT },
    );
    const byName = new Map(columns.map((row) => [row.column_name, row]));

    for (const name of ['pin_hash', 'pin_updated_at']) {
      assert.ok(byName.has(name), `users.${name} must exist`);
      assert.equal(byName.get(name)!.is_nullable, 'YES', `users.${name} must be nullable`);
    }
    assert.equal(byName.get('pin_hash')!.data_type, 'character varying');
    assert.equal(byName.get('pin_updated_at')!.data_type, 'timestamp with time zone');

    // The migration must not backfill: no user — driver or otherwise — gets a
    // PIN they did not ask for.
    const withPin = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE pin_hash IS NOT NULL`,
      { type: QueryTypes.SELECT },
    );
    assert.equal(withPin[0].count, '0');
  });

  it('installs the crew-only PIN CHECK constraint with the right definition', async () => {
    const constraints = await sequelize.query<{ conname: string; condef: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS condef FROM pg_constraint
        WHERE conname = 'ck_users_pin_hash_crew_only'`,
      { type: QueryTypes.SELECT },
    );
    assert.equal(constraints.length, 1, 'the CHECK constraint must be installed');
    // `NULL OR role IN (…)` — the NULL escape is what makes the column safe for
    // the 99% of users who are not crew.
    assert.match(constraints[0].condef, /IS NULL/);
    assert.match(constraints[0].condef, /DRIVER/);
    assert.match(constraints[0].condef, /CONDUCTOR/);
    // That the constraint actually *fires* is asserted with fixtures in
    // `constraints.integration.spec.ts`; a freshly migrated database has no rows,
    // so a row-level CHECK can never be triggered here.
  });

  it('installs the pin_hash / pin_updated_at pairing CHECK with the right definition', async () => {
    const constraints = await sequelize.query<{ conname: string; condef: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS condef FROM pg_constraint
        WHERE conname = 'ck_users_pin_hash_matches_pin_updated_at'`,
      { type: QueryTypes.SELECT },
    );
    assert.equal(constraints.length, 1, 'the CHECK constraint must be installed');
    // Postgres renders `(pin_hash IS NULL) = (pin_updated_at IS NULL)` back with
    // its own spacing, so assert the two null-tests and the equality rather than
    // the literal string.
    assert.match(constraints[0].condef, /pin_hash IS NULL/);
    assert.match(constraints[0].condef, /pin_updated_at IS NULL/);
    assert.match(constraints[0].condef, /=/, 'the rule is that the two agree');
    // What it buys: `staff.service.ts` derives `pin_set` from `pin_updated_at`
    // because `pin_hash` is outside the default scope. That substitution is only
    // sound while the database guarantees the columns cannot disagree — see the
    // firing assertions in `constraints.integration.spec.ts`.
  });

  it('creates the crew pairing table tenant-pinned and single-use capable', async () => {
    const indexes = await sequelize.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'crew_pairing_tokens'`,
      { type: QueryTypes.SELECT },
    );
    const names = new Set(indexes.map((row) => row.indexname));
    for (const expected of [
      'uq_crew_pairing_tokens_token_hash',
      'idx_crew_pairing_tokens_school_user',
      'idx_crew_pairing_tokens_expires_at',
    ]) {
      assert.ok(names.has(expected), `missing index: ${expected}`);
    }

    const constraints = await sequelize.query<{ conname: string; condef: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS condef FROM pg_constraint
        WHERE conrelid = 'crew_pairing_tokens'::regclass`,
      { type: QueryTypes.SELECT },
    );
    const byName = new Map(constraints.map((row) => [row.conname, row.condef]));
    const fk = byName.get('fk_crew_pairing_tokens_user');
    assert.ok(fk, 'the tenant-pinned composite foreign key must exist');
    assert.match(fk!, /FOREIGN KEY \(school_id, user_id\)/, 'a pairing code must be tenant-pinned');
    assert.match(fk!, /ON DELETE CASCADE/);
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
