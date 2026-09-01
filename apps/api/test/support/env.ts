/**
 * Shared environment bootstrap for the PostgreSQL-backed test suites.
 *
 * Import this module **first** in every integration/E2E spec: it fills in the
 * environment the API reads at import time (database connection, JWT secret,
 * CORS allowlist), so the specs configure a real application rather than
 * mutating internals.
 *
 * Connection settings come from the environment, in this order:
 *
 * ```text
 * TEST_DATABASE_URL=postgres://user:pass@host:port/dbname   (single URL), or
 * TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USERNAME /
 * TEST_DB_PASSWORD / TEST_DB_NAME                            (discrete vars)
 * ```
 *
 * Defaults target the `postgres` service of `infrastructure/docker-compose.yml`
 * (localhost:5432, postgres/postgres) with the dedicated database
 * `school_bus_tracking_test`. See `docs/testing.md`.
 */

export interface TestDatabaseSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  /** Maintenance database used to CREATE DATABASE when needed. */
  maintenanceDatabase: string;
}

let cached: TestDatabaseSettings | null = null;

export function testDatabaseSettings(): TestDatabaseSettings {
  if (cached) {
    return cached;
  }

  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url) {
    const parsed = new URL(url);
    cached = {
      host: parsed.hostname,
      port: Number.parseInt(parsed.port || '5432', 10),
      username: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || 'postgres'),
      database: parsed.pathname.replace(/^\//, '') || 'school_bus_tracking_test',
      maintenanceDatabase: process.env.TEST_DB_MAINTENANCE || 'postgres',
    };
  } else {
    cached = {
      host: process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.TEST_DB_PORT || process.env.DB_PORT || '5432', 10),
      username: process.env.TEST_DB_USERNAME || process.env.DB_USERNAME || 'postgres',
      password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'postgres',
      database: process.env.TEST_DB_NAME || process.env.DB_NAME_TEST || 'school_bus_tracking_test',
      maintenanceDatabase: process.env.TEST_DB_MAINTENANCE || 'postgres',
    };
  }

  return cached;
}

/** Web origin used by the CORS/CSRF end-to-end tests. */
export const TEST_WEB_ORIGIN = 'http://localhost:3000';

/** Applies the test environment. Idempotent. */
export function applyTestEnv(): TestDatabaseSettings {
  const settings = testDatabaseSettings();

  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DB_HOST = settings.host;
  process.env.DB_PORT = String(settings.port);
  process.env.DB_USERNAME = settings.username;
  process.env.DB_PASSWORD = settings.password;
  process.env.DB_NAME = settings.database;
  process.env.DB_NAME_TEST = settings.database;
  process.env.DB_AUTO_CONNECT = 'true';
  process.env.DB_ALLOW_NO_CONNECT = 'false';
  process.env.DB_LOGGING = process.env.DB_LOGGING || 'false';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret';
  process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || TEST_WEB_ORIGIN;

  // The suites log in far more often than a human ever would. Defaults are
  // relaxed so the limiter never masks the behaviour under test; the
  // rate-limit suite sets its own tight numbers before booting its app.
  process.env.RATE_LIMIT_AUTH_LOGIN_LIMIT = process.env.RATE_LIMIT_AUTH_LOGIN_LIMIT || '10000';
  process.env.RATE_LIMIT_LOGIN_IDENTITY_LIMIT =
    process.env.RATE_LIMIT_LOGIN_IDENTITY_LIMIT || '10000';
  process.env.RATE_LIMIT_AUTH_REFRESH_LIMIT = process.env.RATE_LIMIT_AUTH_REFRESH_LIMIT || '10000';
  process.env.RATE_LIMIT_AUTH_LOGOUT_LIMIT = process.env.RATE_LIMIT_AUTH_LOGOUT_LIMIT || '10000';
  process.env.RATE_LIMIT_READ_HEAVY_LIMIT = process.env.RATE_LIMIT_READ_HEAVY_LIMIT || '10000';

  return settings;
}

applyTestEnv();
