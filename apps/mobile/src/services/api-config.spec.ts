import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolveApiBaseUrl, type ApiEnv } from './api.ts';

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

  it('falls back to localhost on iOS simulator, web and non-dev runtimes', () => {
    assert.equal(resolveApiBaseUrl(env({ devHost: 'localhost:8081' })), 'http://localhost:3001/api/v1');
    assert.equal(
      resolveApiBaseUrl(env({ devHost: '192.168.1.20:8081', dev: false })),
      'http://localhost:3001/api/v1',
    );
    assert.equal(resolveApiBaseUrl({ dev: false, platform: null, devHost: null }), 'http://localhost:3001/api/v1');
  });
});
