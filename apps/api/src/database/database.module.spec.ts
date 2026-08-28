import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseModule } from './database.module';

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
  });

  it('keeps the explicit opt-out for in-memory tests and smoke scripts', () => {
    process.env.DB_AUTO_CONNECT = 'false';

    const dynamicModule = DatabaseModule.forRoot();

    assert.equal(dynamicModule.imports, undefined);
  });
});
