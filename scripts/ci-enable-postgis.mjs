#!/usr/bin/env node
/**
 * CI-only database preparation.
 *
 * The integration/E2E harness (`web/test/support/database.ts`) creates the
 * test database itself with `CREATE DATABASE`, which copies `template1`.
 * GitHub Actions service containers do not run the project's
 * `infrastructure/postgres/init.sql`, so this script reproduces exactly that
 * file against the CI PostgreSQL service:
 *
 *   CREATE EXTENSION "uuid-ossp";
 *   CREATE EXTENSION postgis;
 *
 * Installing into `template1` means the harness-created test database inherits
 * PostGIS parity with the development image (`postgis/postgis:16-3.4`); the
 * same extensions are also installed directly in the pre-created test
 * database for good measure. It is safe to run repeatedly
 * (`IF NOT EXISTS`).
 *
 * Connection settings reuse the harness's own TEST_DB_* variables (see
 * web/test/support/env.ts), defaulting to the GitHub Actions service
 * container.
 */
import { Client } from 'pg';

const connection = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: Number.parseInt(process.env.TEST_DB_PORT || '5432', 10),
  user: process.env.TEST_DB_USERNAME || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres',
};

const testDatabase = process.env.TEST_DB_NAME || 'school_bus_tracking_test';

async function enableExtensions(database) {
  const client = new Client({ ...connection, database });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    const { rows } = await client.query(
      `SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis', 'uuid-ossp') ORDER BY extname`,
    );
    console.log(
      `[ci-postgis] ${database}: ${rows
        .map((row) => `${row.extname} ${row.extversion}`)
        .join(', ')}`,
    );
  } finally {
    await client.end();
  }
}

async function main() {
  for (const database of ['template1', testDatabase]) {
    await enableExtensions(database);
  }
}

main().catch((error) => {
  console.error('[ci-postgis] Failed to enable PostGIS extensions:', error);
  process.exitCode = 1;
});
