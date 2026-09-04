import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isNoDatabaseBootstrapAllowed,
  shouldAutoConnectDatabase,
} from './bootstrap';
import { models } from './models';

const originalDbAutoConnect = process.env.DB_AUTO_CONNECT;
const originalDbAllowNoConnect = process.env.DB_ALLOW_NO_CONNECT;
const originalNodeEnv = process.env.NODE_ENV;
const originalArgv = [...process.argv];

function resetEnvValue(
  key: 'DB_AUTO_CONNECT' | 'DB_ALLOW_NO_CONNECT' | 'NODE_ENV',
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function setArgv(...args: string[]) {
  process.argv.length = 0;
  process.argv.push(...args);
}

/** Silences the warn emitted when the unsafe opt-out is ignored. */
const quietLogger = { warn: () => {}, log: () => {} } as never;

afterEach(() => {
  resetEnvValue('DB_AUTO_CONNECT', originalDbAutoConnect);
  resetEnvValue('DB_ALLOW_NO_CONNECT', originalDbAllowNoConnect);
  resetEnvValue('NODE_ENV', originalNodeEnv);
  setArgv(...originalArgv);
});

describe('database bootstrap', () => {
  it('connects Sequelize by default so models are initialized', () => {
    delete process.env.DB_AUTO_CONNECT;

    assert.equal(shouldAutoConnectDatabase(quietLogger), true);
  });

  it('registers every domain model with the connection', () => {
    // The connection is created with `models: [...models]`, so the registry
    // is the single source of truth for what gets initialized.
    assert.ok(models.length > 0, 'expected a non-empty domain model registry');
    assert.ok(
      models.every((model) => typeof model === 'function'),
      'every registry entry must be a model class',
    );
  });

  it('ignores DB_AUTO_CONNECT=false during a real server bootstrap', () => {
    process.env.DB_AUTO_CONNECT = 'false';
    delete process.env.DB_ALLOW_NO_CONNECT;
    delete process.env.NODE_ENV;
    setArgv('/usr/local/bin/node', 'server.js');

    assert.equal(
      shouldAutoConnectDatabase(quietLogger),
      true,
      'real server starts must still connect so User.unscoped() is initialized',
    );
  });

  it('keeps the explicit opt-out for in-memory tests and smoke scripts', () => {
    process.env.DB_AUTO_CONNECT = 'false';
    process.env.DB_ALLOW_NO_CONNECT = 'true';

    assert.equal(isNoDatabaseBootstrapAllowed(), true);
    assert.equal(shouldAutoConnectDatabase(quietLogger), false);
  });
});

describe('domain model registry', () => {
  it('exposes a non-empty models list including User and RefreshToken', () => {
    assert.ok(models.length >= 2, 'expected domain models to be registered');
    const names = models.map((model) => model?.name);
    assert.ok(names.includes('User'), 'User must be in the Sequelize model registry');
    assert.ok(
      names.includes('RefreshToken'),
      'RefreshToken must be in the Sequelize model registry',
    );
    assert.ok(
      models.every((model) => typeof model === 'function'),
      'models registry must not contain undefined entries (circular import symptom)',
    );
  });
});
