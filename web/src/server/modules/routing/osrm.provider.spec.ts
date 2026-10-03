import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OSRM_DEFAULT_USER_AGENT,
  OSRM_MAX_ATTEMPTS,
  OsrmRoutingProvider,
  type RoutingFetch,
} from './osrm.provider';

/**
 * The provider is the only code that ever talks to the routing engine, so
 * its failure semantics ARE the feature's reliability story: never throw
 * (a caller caching geometry for eternity must never crash on a blip),
 * exactly one retry (one blip ≠ unavailable), a hard deadline (a hung
 * engine is down, not slow), and a serialized per-second throttle (a burst
 * of first-time loads can never hammer the engine — 1 req/s is also the
 * public demo servers' fair-use ceiling).
 *
 * `fetch` is always injected, so no spec here touches a network.
 */

const COORDS: ReadonlyArray<readonly [number, number]> = [
  [73.0479, 33.6844],
  [73.0551, 33.6901],
  [73.0613, 33.6972],
];

const OSRM_OK_BODY = {
  code: 'Ok',
  routes: [
    {
      geometry: {
        type: 'LineString',
        coordinates: [
          [73.0479, 33.6844],
          [73.0613, 33.6972],
        ],
      },
      distance: 4820.5,
      duration: 612.3,
      legs: [{ distance: 4820.5, duration: 612.3, steps: [] }],
    },
  ],
};

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal };
}

type Handler = (url: string, init?: FetchCall['init']) => ReturnType<RoutingFetch>;

/** A fake fetch that plays queued handlers and records every call. */
function makeFakeFetch(...handlers: Handler[]): { fetchFn: RoutingFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fallback: Handler = () => {
    throw new Error('fake fetch: no handler left for this call');
  };
  const fetchFn: RoutingFetch = (url, init) => {
    calls.push({ url, init });
    const handler = handlers.length > 1 ? (handlers.shift() as Handler) : (handlers[0] ?? fallback);
    return handler(url, init);
  };
  return { fetchFn, calls };
}

function okResponse(body: unknown = OSRM_OK_BODY): ReturnType<RoutingFetch> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function statusResponse(status: number): ReturnType<RoutingFetch> {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
}

function provider(overrides: Partial<ConstructorParameters<typeof OsrmRoutingProvider>[0]> = {}) {
  return new OsrmRoutingProvider({
    baseUrl: 'http://osrm.test:5000',
    timeoutMs: 50,
    // Effectively no throttle in clock-agnostic tests (1 s per million).
    maxRequestsPerSecond: 1_000_000,
    ...overrides,
  });
}

describe('OsrmRoutingProvider', () => {
  it('issues exactly the documented Route-service URL', async () => {
    const { fetchFn, calls } = makeFakeFetch(() => okResponse());
    await provider({ fetchFn }).computeRoute(COORDS);

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'http://osrm.test:5000/route/v1/driving/' +
        '73.0479,33.6844;73.0551,33.6901;73.0613,33.6972' +
        '?overview=full&geometries=geojson&steps=true',
    );
    assert.equal(calls[0].init?.method, 'GET');
  });

  it('returns the parsed route on Ok', async () => {
    const { fetchFn } = makeFakeFetch(() => okResponse());
    const route = await provider({ fetchFn }).computeRoute(COORDS);

    assert.ok(route);
    assert.equal(route.distanceMeters, 4820.5);
    assert.equal(route.durationSeconds, 612.3);
    assert.equal(route.legs.length, 1);
  });

  it('sends a descriptive User-Agent and asks for JSON', async () => {
    const { fetchFn, calls } = makeFakeFetch(() => okResponse());
    await provider({ fetchFn }).computeRoute(COORDS);

    const headers = calls[0].init?.headers ?? {};
    assert.match(headers['user-agent'] ?? '', /school-bus-tracking/);
    assert.match(headers['user-agent'] ?? '', /OSRM/);
    assert.equal(headers['accept'], 'application/json');
  });

  it('flags itself as provider "osrm" for the cache row', () => {
    assert.equal(provider().name, 'osrm');
    assert.ok(OSRM_DEFAULT_USER_AGENT.length > 10);
  });

  it('returns null for fewer than two coordinates without any HTTP call', async () => {
    const { fetchFn, calls } = makeFakeFetch(() => okResponse());
    assert.equal(await provider({ fetchFn }).computeRoute([]), null);
    assert.equal(await provider({ fetchFn }).computeRoute([[73.0479, 33.6844]]), null);
    assert.equal(calls.length, 0);
  });

  it('returns null on a non-2xx response (after exactly one retry)', async () => {
    const { fetchFn, calls } = makeFakeFetch(() => statusResponse(500));
    const route = await provider({ fetchFn }).computeRoute(COORDS);

    assert.equal(route, null);
    assert.equal(calls.length, 2, 'first attempt plus ONE retry');
    assert.ok(calls.every((call) => call.url === calls[0].url));
  });

  it('returns null on a NoRoute engine outcome', async () => {
    const { fetchFn } = makeFakeFetch(() => okResponse({ code: 'NoRoute', routes: [] }));
    assert.equal(await provider({ fetchFn }).computeRoute(COORDS), null);
  });

  it('retries exactly once: a blip followed by a success still yields the route', async () => {
    const { fetchFn, calls } = makeFakeFetch(
      () => Promise.reject(new Error('connection reset')),
      () => okResponse(),
    );
    const route = await provider({ fetchFn }).computeRoute(COORDS);

    assert.ok(route, 'the single retry must recover the one-off blip');
    assert.equal(calls.length, 2);
    assert.equal(OSRM_MAX_ATTEMPTS, 2);
  });

  it('stops after the retry: two failures mean null, never more traffic', async () => {
    const { fetchFn, calls } = makeFakeFetch(() => Promise.reject(new Error('down')));
    const route = await provider({ fetchFn }).computeRoute(COORDS);

    assert.equal(route, null);
    assert.equal(calls.length, 2, 'must not retry more than once');
  });

  it('never throws, whatever the transport does', async () => {
    const throwingSync: RoutingFetch = () => {
      throw new Error('synchronous transport explosion');
    };
    assert.equal(await provider({ fetchFn: throwingSync }).computeRoute(COORDS), null);

    const badJson: RoutingFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('not json')),
      });
    assert.equal(await provider({ fetchFn: badJson }).computeRoute(COORDS), null);
  });

  it('aborts a hung engine at the configured deadline and reports null', async () => {
    let aborted = false;
    const hung: RoutingFetch = (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });

    const startedAt = Date.now();
    const route = await provider({ fetchFn: hung, timeoutMs: 20 }).computeRoute(COORDS);

    assert.equal(route, null);
    assert.equal(aborted, true, 'the AbortController must fire at the deadline');
    assert.ok(
      Date.now() - startedAt < 1000,
      'attempts must die at the deadline, not hang with the engine',
    );
  });

  it('serializes and spaces requests at the per-second ceiling', async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const { fetchFn, calls } = makeFakeFetch(() => okResponse());
    const p = provider({
      fetchFn,
      maxRequestsPerSecond: 1, // one request per 1000 ms
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await p.computeRoute(COORDS);
    await p.computeRoute(COORDS);
    await p.computeRoute(COORDS);

    assert.deepEqual(sleeps, [1000, 1000], 'first request free, then one per second');
    assert.equal(calls.length, 3);
  });

  it('keeps the ceiling under concurrency — parallel computes queue in order', async () => {
    let now = 5_000;
    const sleeps: number[] = [];
    const startedAt: number[] = [];
    const { fetchFn } = makeFakeFetch(() => {
      startedAt.push(now);
      return okResponse();
    });
    const p = provider({
      fetchFn,
      maxRequestsPerSecond: 2, // one request per 500 ms
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    const [r1, r2, r3] = await Promise.all([
      p.computeRoute(COORDS),
      p.computeRoute(COORDS),
      p.computeRoute(COORDS),
    ]);

    assert.ok(r1 && r2 && r3);
    assert.deepEqual(sleeps, [500, 500], 'three starts spaced by the half-second interval');
    assert.deepEqual(startedAt, [5000, 5500, 6000], 'starts are serialized, never simultaneous');
  });

  it('applies the throttle to the retry too — a retry is still engine traffic', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const { fetchFn, calls } = makeFakeFetch(() => Promise.reject(new Error('down')));
    const p = provider({
      fetchFn,
      maxRequestsPerSecond: 1,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await p.computeRoute(COORDS);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [1000], 'the retry waits its throttle slot');
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const { fetchFn, calls } = makeFakeFetch(() => okResponse());
    await new OsrmRoutingProvider({ baseUrl: 'http://osrm.test:5000/', fetchFn }).computeRoute(COORDS);
    assert.ok(calls[0].url.startsWith('http://osrm.test:5000/route/v1/driving/'));
  });
});
