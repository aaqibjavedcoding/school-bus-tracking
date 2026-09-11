import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiConfigurationError, resolveApiBaseUrl, type ApiEnv } from './api.ts';

/**
 * Pins the API base-URL resolution: env override wins, then the Metro
 * dev-server host (LAN IP for physical devices), then per-platform defaults
 * for emulators/web. These cases are exactly the ones that broke login on
 * physical phones — the old hardcoded `10.0.2.2` default only ever worked on
 * the Android emulator.
 */

function env(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return { dev: true, platform: 'ios', devHost: 'localhost:8081', ...overrides };
}

const OLD_EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL;
const OLD_EXPO_PUBLIC_API_PORT = process.env.EXPO_PUBLIC_API_PORT;

beforeEach(() => {
  if (OLD_EXPO_PUBLIC_API_URL === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = OLD_EXPO_PUBLIC_API_URL;
  if (OLD_EXPO_PUBLIC_API_PORT === undefined) delete process.env.EXPO_PUBLIC_API_PORT;
  else process.env.EXPO_PUBLIC_API_PORT = OLD_EXPO_PUBLIC_API_PORT;
});

describe('resolveApiBaseUrl', () => {
  it('lets EXPO_PUBLIC_API_URL override everything', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/api/v1';
    assert.equal(
      resolveApiBaseUrl(env({ devHost: '192.168.1.20:8081', platform: 'android' })),
      'https://api.example.com/api/v1',
    );
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/api/v1/';
    assert.equal(resolveApiBaseUrl(env()), 'https://api.example.com/api/v1');
  });

  it('uses the Metro dev-server LAN IP on physical devices', () => {
    assert.equal(
      resolveApiBaseUrl(env({ devHost: '192.168.1.20:8081' })),
      'http://192.168.1.20:3001/api/v1',
    );
  });

  it('supports an explicit API port override', () => {
    process.env.EXPO_PUBLIC_API_PORT = '4000';
    assert.equal(
      resolveApiBaseUrl(env({ devHost: '192.168.1.20:8081' })),
      'http://192.168.1.20:4000/api/v1',
    );
  });

  it('falls back to 10.0.2.2 on the Android emulator when Metro is loopback', () => {
    assert.equal(
      resolveApiBaseUrl(env({ devHost: 'localhost:8081', platform: 'android' })),
      'http://10.0.2.2:3001/api/v1',
    );
  });

  it('falls back to localhost only on dev runtimes (iOS simulator, web)', () => {
    assert.equal(resolveApiBaseUrl(env({ devHost: 'localhost:8081' })), 'http://localhost:3001/api/v1');
  });

  it('never falls back to localhost in a release build: missing URL is a configuration error', () => {
    assert.throws(
      () => resolveApiBaseUrl(env({ devHost: '192.168.1.20:8081', dev: false })),
      (error: unknown) =>
        error instanceof ApiConfigurationError &&
        /EXPO_PUBLIC_API_URL/.test((error as Error).message),
    );
    assert.throws(
      () => resolveApiBaseUrl({ dev: false, platform: null, devHost: null }),
      (error: unknown) => error instanceof ApiConfigurationError,
    );
  });

  it('rejects a loopback EXPO_PUBLIC_API_URL in a release build', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
    assert.throws(
      () => resolveApiBaseUrl({ dev: false, platform: 'android', devHost: null }),
      (error: unknown) =>
        error instanceof ApiConfigurationError && /localhost/.test((error as Error).message),
    );
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:3001/api/v1';
    assert.throws(
      () => resolveApiBaseUrl({ dev: false, platform: 'android', devHost: null }),
      (error: unknown) => error instanceof ApiConfigurationError,
    );
  });

  it('accepts a real EXPO_PUBLIC_API_URL in a release build', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/api/v1';
    assert.equal(
      resolveApiBaseUrl({ dev: false, platform: 'android', devHost: null }),
      'https://api.example.com/api/v1',
    );
  });

  it('treats an empty EXPO_PUBLIC_API_URL as missing', () => {
    process.env.EXPO_PUBLIC_API_URL = '   ';
    assert.throws(
      () => resolveApiBaseUrl({ dev: false, platform: 'android', devHost: null }),
      (error: unknown) => error instanceof ApiConfigurationError,
    );
    assert.equal(resolveApiBaseUrl(env()), 'http://localhost:3001/api/v1');
  });
});
