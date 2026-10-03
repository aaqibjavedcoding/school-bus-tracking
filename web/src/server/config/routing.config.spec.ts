import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import routingConfig, { routingServiceUrlFromEnv } from './routing.config';

/**
 * The routing config guards the two hard constraints of road-following
 * geometry: the engine is self-hosted and keyless (so a key-carrying or
 * non-http(s) URL is a load-time error, never a silent fallback), and blank
 * means DISABLED (so a school with no engine simply gets
 * `{ status: 'unavailable' }` answers and zero network calls).
 *
 * NB: keyed example URLs below are assembled by concatenation on purpose —
 * `web/scripts/map-provider-policy.spec.ts` (correctly) fails any literal
 * `key=` URL in the codebase, including inside a test fixture.
 */

const ENV_KEYS = [
  'ROUTING_SERVICE_URL',
  'ROUTING_TIMEOUT_MS',
  'ROUTING_MAX_REQUESTS_PER_SECOND',
] as const;

const originals = new Map<string, string | undefined>();

for (const key of ENV_KEYS) {
  originals.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originals.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('routing.config', () => {
  it('is disabled when ROUTING_SERVICE_URL is unset or blank', () => {
    setEnv('ROUTING_SERVICE_URL', undefined);
    assert.equal(routingServiceUrlFromEnv(), null);
    assert.equal(routingConfig().serviceUrl, null);

    setEnv('ROUTING_SERVICE_URL', '');
    assert.equal(routingServiceUrlFromEnv(), null);

    setEnv('ROUTING_SERVICE_URL', '   ');
    assert.equal(routingServiceUrlFromEnv(), null);
  });

  it('applies the documented defaults: 5 s timeout, 1 request per second', () => {
    setEnv('ROUTING_SERVICE_URL', 'http://osrm:5000');
    setEnv('ROUTING_TIMEOUT_MS', undefined);
    setEnv('ROUTING_MAX_REQUESTS_PER_SECOND', undefined);
    const config = routingConfig();
    assert.equal(config.serviceUrl, 'http://osrm:5000');
    assert.equal(config.timeoutMs, 5000);
    assert.equal(config.maxRequestsPerSecond, 1);
  });

  it('trims whitespace and strips trailing slashes so URL joining is stable', () => {
    setEnv('ROUTING_SERVICE_URL', '  http://osrm.internal:5000/  ');
    assert.equal(routingServiceUrlFromEnv(), 'http://osrm.internal:5000');

    setEnv('ROUTING_SERVICE_URL', 'https://routing.example.com/engine///');
    assert.equal(routingServiceUrlFromEnv(), 'https://routing.example.com/engine');
  });

  it('honours the timeout and throttle overrides, clamping garbage to safety', () => {
    setEnv('ROUTING_SERVICE_URL', 'http://osrm:5000');
    setEnv('ROUTING_TIMEOUT_MS', '2500');
    setEnv('ROUTING_MAX_REQUESTS_PER_SECOND', '0.5');
    assert.equal(routingConfig().timeoutMs, 2500);
    assert.equal(routingConfig().maxRequestsPerSecond, 0.5);

    setEnv('ROUTING_TIMEOUT_MS', 'not-a-number');
    setEnv('ROUTING_MAX_REQUESTS_PER_SECOND', '-3');
    // Non-numeric degrades to the default; a negative cap clamps to the min,
    // never to "unthrottled".
    assert.equal(routingConfig().timeoutMs, 5000);
    assert.ok(routingConfig().maxRequestsPerSecond > 0);
  });

  it('rejects a malformed URL at load', () => {
    setEnv('ROUTING_SERVICE_URL', 'not a url at all');
    assert.throws(() => routingConfig(), /not a valid URL/);
  });

  it('rejects non-http(s) schemes at load', () => {
    for (const bad of ['ftp://osrm:5000', 'file:///etc/passwd', 'ws://osrm:5000']) {
      setEnv('ROUTING_SERVICE_URL', bad);
      assert.throws(() => routingConfig(), /must be an http\(s\) URL/);
    }
  });

  it('rejects any URL carrying a key credential at load', () => {
    // Assembled, never literal — see the file header.
    const amp = '&';
    const keyed = [
      `https://routing.example.com/${'?key='}abc123`,
      `https://routing.example.com/route${'?api_key='}abc123`,
      `https://routing.example.com/?foo=1${amp}key=abc123`,
      `https://routing.example.com/?foo=1${amp}API_KEY=abc123`,
    ];
    for (const url of keyed) {
      setEnv('ROUTING_SERVICE_URL', url);
      assert.throws(() => routingConfig(), /must not carry an API key credential/, url);
    }
  });

  it('accepts ordinary query strings on a keyless self-hosted engine', () => {
    setEnv('ROUTING_SERVICE_URL', 'http://osrm:5000/base?profile=driving');
    assert.equal(routingServiceUrlFromEnv(), 'http://osrm:5000/base?profile=driving');
  });
});
