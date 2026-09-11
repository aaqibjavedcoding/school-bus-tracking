import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { assertSafeProductionDatabaseConfig } from './database.config';

const originalNodeEnv = process.env.NODE_ENV;
const originalDbHost = process.env.DB_HOST;
const originalDbName = process.env.DB_NAME;
const originalDbUsername = process.env.DB_USERNAME;
const originalDbPassword = process.env.DB_PASSWORD;
const originalDbSsl = process.env.DB_SSL;

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  setEnv('NODE_ENV', originalNodeEnv);
  setEnv('DB_HOST', originalDbHost);
  setEnv('DB_NAME', originalDbName);
  setEnv('DB_USERNAME', originalDbUsername);
  setEnv('DB_PASSWORD', originalDbPassword);
  setEnv('DB_SSL', originalDbSsl);
});

/** A fully explicit, safe production configuration. */
function setSafeProductionEnv(): void {
  process.env.NODE_ENV = 'production';
  process.env.DB_HOST = 'db.internal.example';
  process.env.DB_NAME = 'school_bus_tracking_prod';
  process.env.DB_USERNAME = 'sbt_app';
  process.env.DB_PASSWORD = 'a-strong-production-password';
  process.env.DB_SSL = 'true';
}

describe('assertSafeProductionDatabaseConfig', () => {
  it('accepts an explicit, TLS-enabled production configuration', () => {
    setSafeProductionEnv();

    assert.doesNotThrow(() => assertSafeProductionDatabaseConfig());
  });

  it('is a no-op outside production so local development keeps its defaults', () => {
    delete process.env.NODE_ENV;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USERNAME;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_SSL;

    assert.doesNotThrow(() => assertSafeProductionDatabaseConfig());

    process.env.NODE_ENV = 'test';
    assert.doesNotThrow(() => assertSafeProductionDatabaseConfig());
  });

  it('fails fast when production would fall back to an insecure default', () => {
    setSafeProductionEnv();
    delete process.env.DB_USERNAME;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_SSL;

    assert.throws(
      () => assertSafeProductionDatabaseConfig(),
      (error: Error) => {
        assert.match(error.message, /Unsafe production database configuration/);
        assert.match(error.message, /DB_USERNAME is not set/);
        assert.match(error.message, /DB_PASSWORD is not set/);
        assert.match(error.message, /DB_SSL must be "true"/);
        return true;
      },
    );
  });

  it('rejects blank production values, not just missing ones', () => {
    setSafeProductionEnv();
    process.env.DB_PASSWORD = '   ';

    assert.throws(() => assertSafeProductionDatabaseConfig(), /DB_PASSWORD is not set/);
  });

  it('refuses DB_SSL=false in production instead of silently disabling TLS', () => {
    setSafeProductionEnv();
    process.env.DB_SSL = 'false';

    assert.throws(() => assertSafeProductionDatabaseConfig(), /DB_SSL must be "true"/);
  });

  it('reports every problem in one startup error', () => {
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;

    assert.throws(
      () => assertSafeProductionDatabaseConfig(),
      (error: Error) => {
        assert.match(error.message, /DB_HOST is not set/);
        assert.match(error.message, /DB_NAME is not set/);
        assert.match(error.message, /DB_SSL must be "true"/);
        return true;
      },
    );
  });
});
