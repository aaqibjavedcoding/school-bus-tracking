import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApiClient, querySuffix } from '@school-bus-tracking/api-client';

/**
 * Regression tests for the mobile search/pagination defect.
 *
 * Root cause: the shared API client built its query string with
 * `params.size > 0 ? ... : ''`. `URLSearchParams.size` is unimplemented in the
 * React Native / Expo URL polyfill (`whatwg-url-without-unicode`), where it is
 * `undefined` — so `undefined > 0` was `false` and **every** list request went
 * out with no query string at all: no `page`, no `limit`, no `search`, no
 * filters. Browsers implement `size`, hence web was fine and mobile was not.
 *
 * These tests run the real client twice: once with Node's native
 * `URLSearchParams` (the "web" runtime) and once with the exact polyfill Expo
 * installs at runtime (the "mobile" runtime). Both must produce identical URLs.
 */

const require = createRequire(import.meta.url);

// The polyfill Expo installs over `globalThis.URLSearchParams` on device.
const { URLSearchParams: ExpoURLSearchParams } = require('whatwg-url-without-unicode') as {
  URLSearchParams: typeof URLSearchParams;
};

const NativeURLSearchParams = globalThis.URLSearchParams;

/** Records every URL the client requests, returning an empty paged envelope. */
function trackingClient() {
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [],
          meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
          summary: {},
        },
      }),
    };
  }) as unknown as typeof globalThis.fetch;
  const client = createApiClient({ baseUrl: 'http://api.test/api/v1' });
  return { client, urls, restore: () => { globalThis.fetch = originalFetch; } };
}

describe('URLSearchParams.size is unusable on React Native', () => {
  it('the Expo polyfill really does lack `size` (guards the root cause)', () => {
    const params = new ExpoURLSearchParams();
    params.set('search', 'Aaqib');
    assert.equal(
      (params as unknown as { size?: number }).size,
      undefined,
      'if this ever becomes a number the polyfill has caught up, but querySuffix must still be used',
    );
    assert.equal(params.toString(), 'search=Aaqib');
  });

  it('querySuffix does not depend on `size`', () => {
    const params = new ExpoURLSearchParams();
    params.set('page', '1');
    params.set('search', 'Aaqib');
    assert.equal(querySuffix(params as URLSearchParams), '?page=1&search=Aaqib');
  });

  it('querySuffix returns an empty suffix for an empty query', () => {
    assert.equal(querySuffix(new ExpoURLSearchParams() as URLSearchParams), '');
    assert.equal(querySuffix(new NativeURLSearchParams()), '');
  });
});

// Each case: [name, call, expected URL]
const CASES: Array<[string, (c: ReturnType<typeof createApiClient>) => Promise<unknown>, string]> = [
  [
    'students search',
    (c) => c.listStudents({ page: 1, limit: 20, search: 'Aaqib' }),
    'http://api.test/api/v1/students?page=1&limit=20&search=Aaqib',
  ],
  [
    'students pagination without search',
    (c) => c.listStudents({ page: 3, limit: 20, search: '' }),
    'http://api.test/api/v1/students?page=3&limit=20',
  ],
  [
    'buses search',
    (c) => c.listBuses({ page: 1, limit: 20, search: 'KA01' }),
    'http://api.test/api/v1/buses?page=1&limit=20&search=KA01',
  ],
  [
    'routes search',
    (c) => c.listRoutes({ page: 1, limit: 20, search: 'North' }),
    'http://api.test/api/v1/routes?page=1&limit=20&search=North',
  ],
  [
    'drivers search',
    (c) => c.listDrivers({ page: 1, limit: 20, search: 'rah' }),
    'http://api.test/api/v1/drivers?page=1&limit=20&search=rah',
  ],
  [
    'conductors search',
    (c) => c.listConductors({ page: 1, limit: 20, search: 'joshi' }),
    'http://api.test/api/v1/conductors?page=1&limit=20&search=joshi',
  ],
  [
    'guardians (parents) search',
    (c) => c.listParents({ page: 1, limit: 20, search: 'sharma' }),
    'http://api.test/api/v1/parents?page=1&limit=20&search=sharma',
  ],
  [
    'assignments search keeps role + is_active filters',
    (c) =>
      c.listAssignments({
        page: 1,
        limit: 20,
        search: 'north',
        role: 'DRIVER' as never,
        is_active: true,
      }),
    'http://api.test/api/v1/assignments?page=1&limit=20&search=north&role=DRIVER&is_active=true',
  ],
  [
    'documents overview search keeps owner_type filter',
    (c) =>
      c.getDocumentOverview({ page: 1, limit: 20, search: 'KA01', owner_type: 'BUS' as never }),
    'http://api.test/api/v1/documents/overview?page=1&limit=20&owner_type=BUS&search=KA01',
  ],
  [
    'trips search keeps status + date filters',
    (c) =>
      c.listTrips({ page: 2, limit: 20, search: 'north', status: 'SCHEDULED' as never, date: '2026-09-01' }),
    'http://api.test/api/v1/trips?page=2&limit=20&search=north&status=SCHEDULED&date=2026-09-01',
  ],
  [
    'stops search keeps route_id filter',
    (c) => c.listStops({ page: 1, limit: 100, search: 'gate', route_id: 'r-1' }),
    'http://api.test/api/v1/stops?page=1&limit=100&search=gate&route_id=r-1',
  ],
];

for (const [runtime, Impl] of [
  ['web runtime (native URLSearchParams)', NativeURLSearchParams],
  ['mobile runtime (Expo whatwg-url polyfill)', ExpoURLSearchParams],
] as const) {
  describe(`list query strings — ${runtime}`, () => {
    beforeEach(() => {
      globalThis.URLSearchParams = Impl as typeof URLSearchParams;
    });
    afterEach(() => {
      globalThis.URLSearchParams = NativeURLSearchParams;
    });

    for (const [name, call, expected] of CASES) {
      it(`sends the full query for ${name}`, async () => {
        const { client, urls, restore } = trackingClient();
        try {
          await call(client);
        } finally {
          restore();
        }
        assert.equal(urls.length, 1);
        assert.equal(urls[0], expected);
      });
    }

    it('omits the query string entirely when there are no parameters', async () => {
      const { client, urls, restore } = trackingClient();
      try {
        await client.listStudents({});
      } finally {
        restore();
      }
      assert.equal(urls[0], 'http://api.test/api/v1/students');
    });

    it('url-encodes multi-word and special-character search terms', async () => {
      const { client, urls, restore } = trackingClient();
      try {
        await client.listStudents({ page: 1, limit: 20, search: 'Aarav Sharma & co' });
      } finally {
        restore();
      }
      assert.match(urls[0], /search=Aarav\+Sharma\+%26\+co$/);
    });
  });
}
