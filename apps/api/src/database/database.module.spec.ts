import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseModule } from './database.module';
import { models } from './models';

const originalDbAutoConnect = process.env.DB_AUTO_CONNECT;

afterEach(() => {
  if (originalDbAutoConnect === undefined) {
    delete process.env.DB_AUTO_CONNECT;
  } else {
    process.env.DB_AUTO_CONNECT = originalDbAutoConnect;
  }
});

describe('DatabaseModule.forRoot', () => {
  it('registers Sequelize by default so API models are initialized', () => {
    delete process.env.DB_AUTO_CONNECT;

    const dynamicModule = DatabaseModule.forRoot();

    assert.ok(dynamicModule.imports?.length, 'expected a Sequelize root module');
    // Root async connection + forFeature(models) — both required so
    // @nestjs/sequelize's autoLoadModels path actually receives the domain
    // models (forFeature writes them into EntitiesMetadataStorage).
    assert.equal(dynamicModule.imports?.length, 2, 'expected forRootAsync + forFeature');
  });

  it('registers every domain model through SequelizeModule.forFeature', () => {
    delete process.env.DB_AUTO_CONNECT;

    const dynamicModule = DatabaseModule.forRoot();
    const featureModule = dynamicModule.imports?.[1] as {
      providers?: Array<{ provide?: string }>;
    };

    assert.ok(featureModule, 'expected a forFeature dynamic module');
    // Each model becomes a `*Repository` provider (e.g. UserRepository).
    const providerCount = featureModule.providers?.length ?? 0;
    assert.equal(
      providerCount,
      models.length,
      `expected one repository provider per domain model (got ${providerCount}, models=${models.length})`,
    );
  });

  it('exports SequelizeModule so feature modules share the connection', () => {
    delete process.env.DB_AUTO_CONNECT;

    const dynamicModule = DatabaseModule.forRoot();
    assert.ok(
      Array.isArray(dynamicModule.exports) && dynamicModule.exports.length >= 1,
      'expected Sequelize exports so AuthModule repositories resolve initialized models',
    );
  });

  it('keeps the explicit opt-out for in-memory tests and smoke scripts', () => {
    process.env.DB_AUTO_CONNECT = 'false';

    const dynamicModule = DatabaseModule.forRoot();

    assert.equal(dynamicModule.imports, undefined);
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
