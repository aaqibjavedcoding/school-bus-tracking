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
