import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiConfigurationError, isTunnelHost, resolveApiBaseUrl, type ApiEnv } from './api.ts';

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
    assert.equal(
      resolveApiBaseUrl(env({ devHost: 'localhost:8081' })),
      'http://localhost:3001/api/v1',
    );
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

  /**
   * `expo start --tunnel` serves Metro through a public hostname that forwards
   * the dev-server port only. Swapping that port for the API's used to produce
   * `http://<tunnel>:3001/api/v1` — an address nothing answers on — so the
   * phone showed a bare "Unable to connect" at sign-in with no hint that the
   * tunnel was the cause. The resolver now refuses with the cause and the fix.
   */
  describe('tunnelled Metro (expo start --tunnel)', () => {
    it('refuses to derive the API URL from an Expo tunnel host and names the fix', () => {
      assert.throws(
        () =>
          resolveApiBaseUrl(
            env({ devHost: 'abc123-anonymous-8081.exp.direct', platform: 'android' }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof ApiConfigurationError);
          const message = (error as Error).message;
          assert.match(message, /abc123-anonymous-8081\.exp\.direct/);
          assert.match(message, /EXPO_PUBLIC_API_URL/);
          assert.match(message, /3001/);
          assert.match(message, /http:\/\/<your-lan-ip>:3001\/api\/v1/);
          return true;
        },
      );
    });

    it('names the overridden API port in the tunnel message', () => {
      process.env.EXPO_PUBLIC_API_PORT = '4000';
      assert.throws(
        () => resolveApiBaseUrl(env({ devHost: 'abc123-anonymous-8081.exp.direct' })),
        (error: unknown) =>
          error instanceof ApiConfigurationError && /4000/.test((error as Error).message),
      );
    });

    it('treats Expo tunnel v2, ngrok, cloudflared and localtunnel hosts the same way', () => {
      for (const devHost of [
        'session.boltexpo.dev',
        'a1b2c3d4.ngrok.io',
        'a1b2-203-0-113-9.ngrok-free.app',
        'a1b2c3d4.ngrok.app',
        'a1b2c3d4.ngrok.dev',
        'quiet-river-1234.trycloudflare.com',
        'brave-cat-42.loca.lt',
      ]) {
        assert.throws(
          () => resolveApiBaseUrl(env({ devHost })),
          (error: unknown) => error instanceof ApiConfigurationError,
          devHost,
        );
      }
    });

    it('still lets EXPO_PUBLIC_API_URL win when Metro is tunnelled', () => {
      process.env.EXPO_PUBLIC_API_URL = 'https://api-tunnel.ngrok-free.app/api/v1';
      assert.equal(
        resolveApiBaseUrl(
          env({ devHost: 'abc123-anonymous-8081.exp.direct', platform: 'android' }),
        ),
        'https://api-tunnel.ngrok-free.app/api/v1',
      );
    });

    it('keeps LAN addresses, mDNS names and plain machine names on the derived URL', () => {
      assert.equal(
        resolveApiBaseUrl(env({ devHost: '192.168.1.20:8081' })),
        'http://192.168.1.20:3001/api/v1',
      );
      assert.equal(
        resolveApiBaseUrl(env({ devHost: 'my-laptop.local:8081' })),
        'http://my-laptop.local:3001/api/v1',
      );
      assert.equal(
        resolveApiBaseUrl(env({ devHost: 'devbox.corp.example:8081' })),
        'http://devbox.corp.example:3001/api/v1',
      );
      assert.equal(isTunnelHost('192.168.1.20'), false);
      assert.equal(isTunnelHost('my-laptop.local'), false);
      // Only a *suffix* match counts: a LAN host that merely contains the word is not a tunnel.
      assert.equal(isTunnelHost('ngrok.dev.internal'), false);
      assert.equal(isTunnelHost('exp.direct.lan'), false);
    });
  });
});
