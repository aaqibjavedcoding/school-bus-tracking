import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { models } from '../../src/server/database/models';
import { applyTestEnv, testDatabaseSettings } from './env';

const API_ROOT = resolve(__dirname, '../..');

export const DATABASE_UNAVAILABLE_HINT = `
A real PostgreSQL server is required for the integration/E2E suites.

  docker compose -f infrastructure/docker-compose.yml up -d postgres
  createdb school_bus_tracking_test   # or let the suite create it

Override the connection with TEST_DATABASE_URL or TEST_DB_HOST/PORT/USERNAME/
PASSWORD/NAME. See docs/testing.md.
`.trim();

/** Connects to the maintenance database and creates the test database if absent. */
export async function ensureTestDatabase(): Promise<void> {
  const settings = applyTestEnv();
  const admin = new Sequelize({
    dialect: 'postgres',
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    database: settings.maintenanceDatabase,
    logging: false,
  });

  try {
    await admin.authenticate();
    const existing = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = $name',
      { bind: { name: settings.database }, type: QueryTypes.SELECT },
    );
    if (existing.length === 0) {
      await admin.query(`CREATE DATABASE "${settings.database}"`);
    }
  } catch (error) {
    throw new Error(
      `${DATABASE_UNAVAILABLE_HINT}\n\nUnderlying error: ${(error as Error).message}`,
    );
  } finally {
    await admin.close();
  }
}

/** Drops every table/type so the next migration run starts from an empty database. */
export async function resetSchema(): Promise<void> {
  const sequelize = createTestSequelize();
  try {
    await sequelize.query('DROP SCHEMA IF EXISTS public CASCADE');
    await sequelize.query('CREATE SCHEMA public');
  } finally {
    await sequelize.close();
  }
}

/**
 * Runs the real migration path (`npm run db:migrate` → sequelize-cli → the
 * TypeScript migrations in `src/database/migrations`) against the test
 * database. Using the production runner — rather than `sequelize.sync()` or a
 * bespoke loader — is what makes "migrations apply cleanly from an empty
 * database" a meaningful assertion.
 */
export function runMigrations(): string {
  const settings = testDatabaseSettings();
  return execFileSync(process.execPath, ['scripts/sequelize-cli.js', 'db:migrate'], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: settings.host,
      DB_PORT: String(settings.port),
      DB_USERNAME: settings.username,
      DB_PASSWORD: settings.password,
      DB_NAME: settings.database,
      DB_NAME_TEST: settings.database,
    },
  });
}

/** Rolls every migration back (used by the migration round-trip test). */
export function undoAllMigrations(): string {
  const settings = testDatabaseSettings();
  return execFileSync(process.execPath, ['scripts/sequelize-cli.js', 'db:migrate:undo:all'], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: settings.host,
      DB_PORT: String(settings.port),
      DB_USERNAME: settings.username,
      DB_PASSWORD: settings.password,
      DB_NAME: settings.database,
      DB_NAME_TEST: settings.database,
    },
  });
}

/**
 * Rolls back exactly one migration — `name` when given (e.g.
 * `20260906120400-backfill-default-runs`), otherwise the most recently applied
 * one.
 *
 * Needed by suites that have to observe a migration's *effect* on data that
 * already exists: the sequence is migrate → seed → undo the data migration →
 * migrate again. `undoAllMigrations()` cannot express that.
 *
 * Passing `name` keeps the helper targeted when later migrations are added on
 * top of the migration under test; without it, only "the last one" is
 * reverting.
 *
 * **Prefer `undoThroughMigration`** in new code: it calls this internally and
 * then re-applies every migration so the database is in a clean, reproducible
 * state, not stuck at "one migration undone".
 */
export function undoMigration(name?: string): string {
  const settings = testDatabaseSettings();
  const args = ['scripts/sequelize-cli.js', 'db:migrate:undo'];
  if (name) {
    args.push('--name', name);
  }
  return execFileSync(process.execPath, args, {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: settings.host,
      DB_PORT: String(settings.port),
      DB_USERNAME: settings.username,
      DB_PASSWORD: settings.password,
      DB_NAME: settings.database,
      DB_NAME_TEST: settings.database,
    },
  });
}

/** Back-compat alias: `undoMigration()` reverts the most recent migration. */
export function undoLastMigration(): string {
  return undoMigration();
}

/**
 * Undoes a migration (default: the most recently applied one) and then
 * re-applies every migration.
 *
 * This restores a clean migration state — equivalent to `runMigrations()` on a
 * freshly-migrated database — while exercising the `down()` of the migration
 * that was just undone.
 *
 * The canonical use is: migrate → seed → `undoThroughMigration()` → verify the
 * `down()` removed exactly what `up()` added (e.g. the backfill's default runs).
 * Calling `undoMigration()` alone leaves the database at "one migration
 * behind" which is hard to reason about in subsequent tests.
 *
 * Pass the migration file name to target a specific migration rather than
 * whatever happens to be newest.
 */
export function undoThroughMigration(name?: string): void {
  undoMigration(name);
  runMigrations();
}

/** A Sequelize instance bound to the test database with every model attached. */
export function createTestSequelize(options: { withModels?: boolean } = {}): Sequelize {
  const settings = testDatabaseSettings();
  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    database: settings.database,
    logging: false,
    pool: { max: 10, min: 0, acquire: 30_000, idle: 10_000 },
    ...(options.withModels === false ? {} : { models: [...models] }),
  });
  return sequelize;
}

/** Prepares a migrated, empty database and returns a connected Sequelize. */
export async function prepareDatabase(): Promise<Sequelize> {
  await ensureTestDatabase();
  await resetSchema();
  runMigrations();
  const sequelize = createTestSequelize();
  await sequelize.authenticate();
  return sequelize;
}

/** Truncates all domain tables, keeping the schema (fast per-test reset). */
export async function truncateAll(sequelize: Sequelize): Promise<void> {
  const tables = await sequelize.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'SequelizeMeta'`,
    { type: QueryTypes.SELECT },
  );
  if (tables.length === 0) {
    return;
  }
  const list = tables.map((row) => `"${row.tablename}"`).join(', ');
  await sequelize.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
