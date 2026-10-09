import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * `scripts/osrm-backfill.mjs` end to end, against a fake API and a fake OSRM
 * engine on loopback. What is pinned here is the script's own contract:
 *
 *  - ADMIN_MODE selects the flow: unset/`school` keeps the school backfill
 *    (SCHOOL_ADMIN, one school); `platform` runs the platform flow; anything
 *    else is refused before any network call;
 *  - platform mode reads ONLY the platform surface (`/admin/routes/...`),
 *    walks every page of the missing list, PUTs the engine's road route for
 *    each routable route, and never sends a school id;
 *  - outcomes are classified: filled (verified by the re-check), no road
 *    route (OSRM NoRoute/NoSegment — reported, not failed), failed (exit 1);
 *  - a route whose stops changed between the list and the write has its
 *    mismatched row dropped via recompute and is counted as failed;
 *  - a refused token (401/403) stops the run with exit 1.
 */

const SCRIPT = resolve(__dirname, '../../../../../scripts/osrm-backfill.mjs');
const SUPER_TOKEN = 'super-admin-token';

const SCHOOL_ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Sentinel longitude the fake engine answers NoRoute for. */
const NO_ROAD_LNG = 99.5;
/** Sentinel longitude the fake engine answers HTTP 500 for. */
const ENGINE_DOWN_LNG = 98.5;

interface FixtureStop {
  stop_id: string;
  latitude: number;
  longitude: number;
}

interface FixtureRoute {
  route_id: string;
  route_name: string;
  route_code: string;
  school_id: string;
  school_name: string;
  stops_hash: string;
  stops: FixtureStop[];
}

function route(
  id: string,
  schoolId: string,
  schoolName: string,
  stops: Array<[number, number]>,
): FixtureRoute {
  return {
    route_id: id,
    route_name: `Route ${id}`,
    route_code: id.toUpperCase(),
    school_id: schoolId,
    school_name: schoolName,
    stops_hash: id.padEnd(64, '0'),
    stops: stops.map(([longitude, latitude], index) => ({
      stop_id: `${id}-stop-${index + 1}`,
      latitude,
      longitude,
    })),
  };
}

interface RecordedRequest {
  method: string;
  path: string;
  auth: string | undefined;
  body: unknown;
}

interface FakeApi {
  url: string;
  requests: RecordedRequest[];
  /** Route ids the fake API has "stored" — they leave the missing list. */
  stored: Set<string>;
  /** Per-test switches. */
  config: {
    routes: FixtureRoute[];
    pageSize: number;
    listStatus: number;
    putHashOverride: Map<string, string>;
    /** Health probe: HTTP status the /health handler answers. */
    healthStatus: number;
    /** Health probe: how many GETs /health answers before switching status (for warm-up). */
    healthAttempt: number;
    /** Sign-in response status for POST /auth/login. */
    loginStatus: number;
    /** What `stopsOutsideBbox` the missing-list handler returns, keyed by route_id. */
    outsideBboxByRoute: Map<string, number>;
  };
  /** Health probes the fake API has answered so far. */
  healthCalls: number;
  /** Sign-ins the fake API has served. */
  loginCalls: number;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => resolveBody(text));
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function startFakeApi(): Promise<{ api: FakeApi; server: Server }> {
  const api: FakeApi = {
    url: '',
    requests: [],
    stored: new Set(),
    config: {
      routes: [],
      pageSize: 100,
      listStatus: 200,
      putHashOverride: new Map(),
      healthStatus: 200,
      healthAttempt: 0,
      loginStatus: 200,
      outsideBboxByRoute: new Map(),
    },
    healthCalls: 0,
    loginCalls: 0,
  };

  const server = createServer(async (request, response) => {
    const raw = await readBody(request);
    const url = new URL(request.url ?? '/', 'http://fake');
    const body = raw ? JSON.parse(raw) : undefined;
    api.requests.push({
      method: request.method ?? 'GET',
      path: url.pathname + url.search,
      auth: request.headers.authorization,
      body,
    });

    // Health probe — the preflight warms the API before signing in. The
    // fake handler is given a per-test status (the warm-up asserts the
    // retry budget the script honours) and answers commit on success.
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      api.healthCalls += 1;
      if (api.config.healthAttempt > 0 && api.healthCalls <= api.config.healthAttempt) {
        // The preflight's warm-up loop hits /health up to 6 times: the first
        // (config.healthAttempt) attempts answer the configured non-200
        // status, every later attempt answers 200. This is the "cold start
        // then warm" curve.
        sendJson(response, api.config.healthStatus, { status: 'error' });
        return;
      }
      sendJson(response, 200, {
        status: 'ok',
        service: 'school-bus-tracking-api',
        version: 'test',
        uptime: 1,
        timestamp: '2026-10-09T00:00:00.000Z',
        environment: 'test',
        commit: 'testsha',
      });
      return;
    }

    // Sign-in — the preflight uses the same POST /auth/login the web client
    // does, with `email` + `password` and no `school_id` (a SUPER_ADMIN
    // belongs to no tenant).
    if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      api.loginCalls += 1;
      if (api.config.loginStatus !== 200) {
        sendJson(response, api.config.loginStatus, {
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'invalid' },
        });
        return;
      }
      sendJson(response, 200, {
        success: true,
        data: {
          access_token: 'preflight-token',
          token_type: 'Bearer',
          expires_in: 900,
          user: {
            id: 'super-id',
            email: body?.email ?? 'super@example.com',
            role: 'SUPER_ADMIN',
            school_id: null,
          },
        },
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/admin/routes/geometry/missing') {
      if (api.config.listStatus !== 200) {
        sendJson(response, api.config.listStatus, {
          success: false,
          error: { message: 'refused' },
        });
        return;
      }
      const bboxParam = url.searchParams.get('bbox');
      const pending = api.config.routes.filter((item) => !api.stored.has(item.route_id));
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = api.config.pageSize;
      const slice = pending.slice((page - 1) * pageSize, page * pageSize);
      const totalPages = Math.max(1, Math.ceil(pending.length / pageSize));
      const schools = new Map<string, { school_id: string; school_name: string }>();
      for (const item of api.config.routes) {
        schools.set(item.school_id, { school_id: item.school_id, school_name: item.school_name });
      }
      // The real server tags every item with stopsOutsideBbox when the
      // caller passed bbox, and reports outsideBbox + fillable per school
      // and in the totals. The fake mirrors the wire shape so the
      // preflight's bookkeeping (per-school table, top-20 list, total
      // counts) has the same answer to consume.
      const annotatedItems = slice.map((item) => ({
        ...item,
        stopsOutsideBbox: bboxParam
          ? (api.config.outsideBboxByRoute.get(item.route_id) ?? 0)
          : null,
      }));
      const annotatedPending = pending.map((item) => ({
        ...item,
        stopsOutsideBbox: bboxParam
          ? (api.config.outsideBboxByRoute.get(item.route_id) ?? 0)
          : null,
      }));
      sendJson(response, 200, {
        success: true,
        data: {
          items: annotatedItems,
          meta: {
            page,
            limit: pageSize,
            total: pending.length,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
          schools: [...schools.values()].map((school) => {
            const schoolPending = annotatedPending.filter(
              (item) => item.school_id === school.school_id,
            );
            const outside = bboxParam
              ? schoolPending.filter((item) => (item.stopsOutsideBbox ?? 0) > 0).length
              : null;
            const fillable = bboxParam
              ? schoolPending.length - (outside ?? 0)
              : schoolPending.length;
            return {
              ...school,
              routes_total: api.config.routes.filter((item) => item.school_id === school.school_id)
                .length,
              routes_cached: 0,
              routes_missing: schoolPending.length,
              routes_unlocated: 0,
              outsideBbox: outside,
              fillable,
            };
          }),
          totals: (() => {
            const outside = bboxParam
              ? annotatedPending.filter((item) => (item.stopsOutsideBbox ?? 0) > 0).length
              : null;
            return {
              routes_total: api.config.routes.length,
              routes_cached: 0,
              routes_missing: annotatedPending.length,
              routes_unlocated: 0,
              outsideBbox: outside,
              fillable: bboxParam
                ? annotatedPending.length - (outside ?? 0)
                : annotatedPending.length,
            };
          })(),
        },
      });
      return;
    }

    const storeMatch = /^\/api\/v1\/admin\/routes\/([^/]+)\/geometry$/.exec(url.pathname);
    if (request.method === 'PUT' && storeMatch) {
      const routeId = storeMatch[1];
      api.stored.add(routeId);
      const listed = api.config.routes.find((item) => item.route_id === routeId);
      sendJson(response, 200, {
        success: true,
        data: {
          status: 'ok',
          route_id: routeId,
          stops_hash: api.config.putHashOverride.get(routeId) ?? listed?.stops_hash,
          geometry: body?.geometry,
          distance_meters: body?.distance_meters,
          duration_seconds: body?.duration_seconds,
          legs: body?.legs ?? [],
          provider: body?.provider,
          computed_at: new Date().toISOString(),
        },
      });
      return;
    }

    const recomputeMatch = /^\/api\/v1\/admin\/routes\/([^/]+)\/geometry\/recompute$/.exec(
      url.pathname,
    );
    if (request.method === 'POST' && recomputeMatch) {
      api.stored.delete(recomputeMatch[1]);
      sendJson(response, 200, {
        success: true,
        data: { id: recomputeMatch[1], message: 'cleared', geometry: { status: 'unavailable' } },
      });
      return;
    }

    // School endpoints — the platform run must never reach these.
    if (url.pathname.startsWith('/api/v1/routes')) {
      if (url.pathname === '/api/v1/routes') {
        sendJson(response, 200, {
          success: true,
          data: { items: [{ id: 'school-route-1' }], meta: { totalPages: 1 } },
        });
        return;
      }
      sendJson(response, 200, {
        success: true,
        data: { status: 'ok', stops_hash: 'c'.repeat(64) },
      });
      return;
    }

    sendJson(response, 404, { success: false, error: { message: 'not found' } });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const { port } = server.address() as AddressInfo;
  api.url = `http://127.0.0.1:${port}/api/v1`;
  return { api, server };
}

interface FakeEngine {
  url: string;
  server: Server;
}

async function startFakeEngine(): Promise<FakeEngine> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake');
    const match = /^\/route\/v1\/driving\/([^?]+)/.exec(url.pathname);
    if (!match) {
      sendJson(response, 404, { code: 'InvalidUrl' });
      return;
    }
    const coordinates = match[1].split(';').map((pair) => pair.split(',').map(Number));
    const lngs = coordinates.map(([lng]) => lng);
    if (lngs.includes(ENGINE_DOWN_LNG)) {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('internal error');
      return;
    }
    if (lngs.includes(NO_ROAD_LNG)) {
      sendJson(response, 400, { code: 'NoRoute', message: 'Impossible route between points' });
      return;
    }
    sendJson(response, 200, {
      code: 'Ok',
      routes: [
        {
          geometry: { type: 'LineString', coordinates },
          distance: 1000,
          duration: 60,
          legs: [
            {
              distance: 1000,
              duration: 60,
              steps: [
                {
                  name: 'Test Road',
                  distance: 1000,
                  maneuver: { type: 'depart', modifier: null, location: coordinates[0] },
                },
              ],
            },
          ],
        },
      ],
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  summary: string;
}

let scratchDir = '';

/** Runs the script as a child process with the given environment. */
function runScript(env: Record<string, string>): Promise<RunResult> {
  const summaryPath = join(scratchDir, `summary-${Math.random().toString(36).slice(2)}.md`);
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH ?? '',
        GITHUB_STEP_SUMMARY: summaryPath,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      let summary = '';
      try {
        summary = readFileSync(summaryPath, 'utf8');
      } catch {
        summary = '';
      }
      done({ code, stdout, stderr, summary });
    });
  });
}

describe('osrm-backfill.mjs — ADMIN_MODE selection', () => {
  let api: FakeApi;
  let apiServer: Server;
  let engine: FakeEngine;

  before(async () => {
    scratchDir = mkdtempSync(join(tmpdir(), 'osrm-backfill-'));
    ({ api, server: apiServer } = await startFakeApi());
    engine = await startFakeEngine();
  });

  after(async () => {
    await new Promise<void>((done) => apiServer.close(() => done()));
    await new Promise<void>((done) => engine.server.close(() => done()));
    rmSync(scratchDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    api.requests.length = 0;
    api.stored.clear();
    api.config = {
      routes: [],
      pageSize: 100,
      listStatus: 200,
      putHashOverride: new Map(),
      healthStatus: 200,
      healthAttempt: 0,
      loginStatus: 200,
      outsideBboxByRoute: new Map(),
    };
    api.healthCalls = 0;
    api.loginCalls = 0;
  });

  const platformEnv = () => ({
    API_BASE: api.url,
    OSRM_BASE: engine.url,
    ADMIN_TOKEN: SUPER_TOKEN,
    ADMIN_MODE: 'platform',
  });

  it('refuses an unknown ADMIN_MODE before any network call', async () => {
    const result = await runScript({
      API_BASE: api.url,
      OSRM_BASE: engine.url,
      ADMIN_TOKEN: SUPER_TOKEN,
      ADMIN_MODE: 'everything',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /ADMIN_MODE must be "school" or "platform"/);
    assert.equal(api.requests.length, 0);
  });

  it('defaults to school mode when ADMIN_MODE is unset: one school, its own list', async () => {
    const result = await runScript({
      API_BASE: api.url,
      OSRM_BASE: engine.url,
      ADMIN_TOKEN: 'school-admin-token',
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /ADMIN_MODE=school/);
    assert.ok(
      api.requests.some((request) => request.path.startsWith('/api/v1/routes?')),
      'school mode lists the school’s own routes',
    );
    assert.equal(
      api.requests.some((request) => request.path.startsWith('/api/v1/admin/')),
      false,
      'school mode never touches the platform surface',
    );
  });

  it('reads the platform surface only, and sends no school id', async () => {
    api.config.routes = [
      route('r1', SCHOOL_ALPHA, 'Alpha School', [
        [73.0479, 33.6844],
        [73.0551, 33.6901],
      ]),
    ];

    const result = await runScript(platformEnv());

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /ADMIN_MODE=platform/);
    for (const request of api.requests) {
      assert.equal(request.auth, `Bearer ${SUPER_TOKEN}`);
      assert.ok(
        request.path.startsWith('/api/v1/admin/routes/'),
        `platform mode must not call ${request.path}`,
      );
    }
    const put = api.requests.find((request) => request.method === 'PUT');
    assert.ok(put, 'the route is stored');
    assert.equal(
      JSON.stringify(put.body).includes('school_id'),
      false,
      'the body carries no school id',
    );
    assert.equal((put.body as { provider: string }).provider, 'osrm');
    assert.equal((put.body as { status: string }).status, 'road');
  });

  it('fills what the engine can route, reports NoRoute without failing, and prints per-school counts', async () => {
    api.config.routes = [
      route('r1', SCHOOL_ALPHA, 'Alpha School', [
        [73.0479, 33.6844],
        [73.0551, 33.6901],
      ]),
      route('r2', SCHOOL_ALPHA, 'Alpha School', [
        [NO_ROAD_LNG, 33.7],
        [73.06, 33.71],
      ]),
      route('r3', SCHOOL_BETA, 'Beta School', [
        [73.1, 33.8],
        [73.11, 33.81],
      ]),
    ];

    const result = await runScript(platformEnv());

    assert.equal(result.code, 0, result.stderr);
    // The engine is asked for each missing route; only routable ones are stored.
    const puts = api.requests.filter((request) => request.method === 'PUT').map((r) => r.path);
    assert.deepEqual(puts, [
      '/api/v1/admin/routes/r1/geometry',
      '/api/v1/admin/routes/r3/geometry',
    ]);
    assert.match(result.stdout, /! r2 \(Alpha School\)\s+engine answered NoRoute/);
    assert.match(
      result.stdout,
      /Alpha School\s+2\s+1\s+1\s+0\s+1/,
      'Alpha: missing 2, filled 1, no road 1, failed 0, left 1',
    );
    assert.match(result.stdout, /Beta School\s+1\s+1\s+0\s+0\s+0/);
    assert.match(result.summary, /## OSRM route-geometry backfill — platform/);
    assert.match(result.summary, /\| Alpha School \| 2 \| 1 \| 1 \| 0 \| 1 \|/);
  });

  it('counts an engine failure as failed and exits 1', async () => {
    api.config.routes = [
      route('r1', SCHOOL_ALPHA, 'Alpha School', [
        [ENGINE_DOWN_LNG, 33.6844],
        [73.0551, 33.6901],
      ]),
    ];

    const result = await runScript(platformEnv());

    assert.equal(result.code, 1);
    assert.equal(
      api.requests.some((request) => request.method === 'PUT'),
      false,
    );
    assert.match(result.stdout, /x r1 \(Alpha School\)\s+engine answered 500/);
  });

  it('drops a row whose stops changed between the list and the write, and fails it', async () => {
    api.config.routes = [
      route('r1', SCHOOL_ALPHA, 'Alpha School', [
        [73.0479, 33.6844],
        [73.0551, 33.6901],
      ]),
    ];
    // The server pins a DIFFERENT key than the one listed: stops moved mid-run.
    api.config.putHashOverride.set('r1', 'f'.repeat(64));

    const result = await runScript(platformEnv());

    assert.equal(result.code, 1);
    const recompute = api.requests.find((request) =>
      request.path.endsWith('/admin/routes/r1/geometry/recompute'),
    );
    assert.ok(recompute, 'the mismatched row is dropped so the next run recomputes it');
    assert.match(result.stdout, /stops changed during the run; the mismatched row was dropped/);
  });

  it('stops at once when the token is refused (expired or not a SUPER_ADMIN)', async () => {
    api.config.listStatus = 403;

    const result = await runScript(platformEnv());

    assert.equal(result.code, 1);
    assert.match(result.stderr, /access token is expired or is not a SUPER_ADMIN token/);
    assert.equal(api.requests.length, 1, 'no further calls after the refusal');
  });

  it('walks every page of the missing list before deciding what to fill', async () => {
    api.config.pageSize = 2;
    api.config.routes = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, index) =>
      route(
        id,
        index < 3 ? SCHOOL_ALPHA : SCHOOL_BETA,
        index < 3 ? 'Alpha School' : 'Beta School',
        [
          [73.0 + index / 100, 33.6844],
          [73.01 + index / 100, 33.6901],
        ],
      ),
    );

    const result = await runScript(platformEnv());

    assert.equal(result.code, 0, result.stderr);
    const listPages = api.requests
      .filter((request) => request.path.startsWith('/api/v1/admin/routes/geometry/missing'))
      .map((request) => new URL(request.path, 'http://fake').searchParams.get('page'));
    assert.ok(listPages.includes('3'), 'the third page was requested');
    const stored = api.requests.filter((request) => request.method === 'PUT').length;
    assert.equal(stored, 5, 'every missing route across all pages is filled');
    assert.match(result.stdout, /TOTAL\s+5\s+5\s+0\s+0\s+0/);
  });
});

/**
 * `CHECK_ONLY=1` + `ADMIN_MODE=platform` — the preflight. The script
 * warms the API, signs in as SUPER_ADMIN, walks the missing list, and
 * writes `needs_run=true|false` to `$GITHUB_OUTPUT`. It exits 0 when the
 * check itself worked, whatever `needs_run` is.
 */
describe('osrm-backfill.mjs — CHECK_ONLY=1 preflight', () => {
  let api: FakeApi;
  let apiServer: Server;
  let engine: FakeEngine;

  before(async () => {
    scratchDir = mkdtempSync(join(tmpdir(), 'osrm-backfill-preflight-'));
    ({ api, server: apiServer } = await startFakeApi());
    engine = await startFakeEngine();
  });

  after(async () => {
    await new Promise<void>((done) => apiServer.close(() => done()));
    await new Promise<void>((done) => engine.server.close(() => done()));
    rmSync(scratchDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    api.requests.length = 0;
    api.stored.clear();
    api.config = {
      routes: [],
      pageSize: 100,
      listStatus: 200,
      putHashOverride: new Map(),
      healthStatus: 200,
      healthAttempt: 0,
      loginStatus: 200,
      outsideBboxByRoute: new Map(),
    };
    api.healthCalls = 0;
    api.loginCalls = 0;
  });

  const preflightEnv = (overrides: Record<string, string> = {}) => ({
    API_BASE: api.url,
    ADMIN_MODE: 'platform',
    CHECK_ONLY: '1',
    PLATFORM_EMAIL: 'super@example.com',
    PLATFORM_PASSWORD: 'do-not-log',
    GITHUB_OUTPUT: join(scratchDir, `output-${Math.random().toString(36).slice(2)}`),
    ...overrides,
  });

  it('refuses CHECK_ONLY without ADMIN_MODE=platform', async () => {
    const result = await runScript({
      API_BASE: api.url,
      CHECK_ONLY: '1',
      PLATFORM_EMAIL: 'super@example.com',
      PLATFORM_PASSWORD: 'do-not-log',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /CHECK_ONLY=1 is only supported with ADMIN_MODE=platform/);
    assert.equal(api.healthCalls, 0);
  });

  it('warms the API, signs in, walks the missing list, and writes needs_run=true', async () => {
    api.config.routes = [
      route('r1', SCHOOL_ALPHA, 'Alpha School', [
        [73.0479, 33.6844],
        [73.0551, 33.6901],
      ]),
    ];

    const result = await runScript(preflightEnv());

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /preflight/);
    assert.equal(api.healthCalls, 1, 'the API is warmed once at the start');
    assert.equal(api.loginCalls, 1, 'the script signs in exactly once');
    const healthCall = api.requests.find((request) => request.path === '/api/v1/health');
    const loginCall = api.requests.find((request) => request.path === '/api/v1/auth/login');
    const listCall = api.requests.find((request) =>
      request.path.startsWith('/api/v1/admin/routes/geometry/missing'),
    );
    assert.ok(healthCall, 'GET /health is called');
    assert.ok(loginCall, 'POST /auth/login is called');
    assert.ok(listCall, 'the missing list is called');
    // The script MUST NOT echo the password in stdout (which the GitHub
    // step summary would pick up) or in stderr (which the run log would
    // show). The fake API records the password in the request body so a
    // future test can assert the wire shape — that does not say anything
    // about whether the script leaks it.
    assert.equal(
      result.stdout.includes('do-not-log'),
      false,
      'the password is never echoed in stdout (the GitHub step summary would leak it)',
    );
    assert.equal(
      result.stderr.includes('do-not-log'),
      false,
      'the password is never echoed in stderr (the run log would leak it)',
    );
    // The preflight prints the per-school summary and the deployed commit.
    assert.match(result.stdout, /commit testsha/);
    assert.match(result.stdout, /Alpha School\s+1/);
    assert.match(result.summary, /## OSRM route-geometry preflight/);
    assert.match(result.summary, /needs_run: \*\*true\*\*/);

    // The job-gate output is the source of truth for the next step. The
    // test runner captures the summary path but not the OUTPUT path, so we
    // scan the scratch dir for the `needs_run=true` marker.
    const outputs = readdirSync(scratchDir)
      .filter((name: string) => name.startsWith('output-'))
      .map((name: string) => readFileSync(join(scratchDir, name), 'utf8'))
      .join('\n');
    assert.match(outputs, /needs_run=true/);
    assert.match(outputs, /commit=testsha/);
  });

  it('writes needs_run=false when the totals show nothing fillable', async () => {
    // No routes → totals.fillable = 0 → needs_run=false.
    api.config.routes = [];

    const result = await runScript(preflightEnv());

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /needs_run\s+: false/);
    assert.match(result.summary, /needs_run: \*\*false\*\*/);

    const outputs = readdirSync(scratchDir)
      .filter((name: string) => name.startsWith('output-'))
      .map((name: string) => readFileSync(join(scratchDir, name), 'utf8'))
      .join('\n');
    assert.match(outputs, /needs_run=false/);
  });

  it('forwards BBOX to the missing list and prints outside/columns, with a top-20 list', async () => {
    // 3 routes: 1 fillable (R1) and 2 with stops outside the bbox (R2, R3).
    api.config.routes = [
      route('r1', SCHOOL_ALPHA, 'Alpha School', [
        [73.0479, 33.6844],
        [73.0551, 33.6901],
      ]),
      route('r2', SCHOOL_BETA, 'Beta School', [
        [10.0, 60.0],
        [10.01, 60.01],
      ]),
      route('r3', SCHOOL_BETA, 'Beta School', [
        [10.0, 60.0],
        [10.01, 60.01],
      ]),
    ];
    api.config.outsideBboxByRoute.set('r2', 2);
    api.config.outsideBboxByRoute.set('r3', 2);

    const result = await runScript(preflightEnv({ BBOX: '72.0,33.0,75.0,34.0' }));

    assert.equal(result.code, 0, result.stderr);
    // The list is called with the bbox query. The comma is percent-encoded
    // by URLSearchParams; the period is not.
    const listCalls = api.requests.filter((request) =>
      request.path.startsWith('/api/v1/admin/routes/geometry/missing'),
    );
    assert.ok(listCalls.length > 0);
    for (const call of listCalls) {
      assert.match(call.path, /[?&]bbox=72\.0%2C33\.0%2C75\.0%2C34\.0/);
    }
    // The per-school table carries the outside + fillable columns.
    assert.match(result.stdout, /outside\s+fillable/);
    assert.match(result.stdout, /Alpha School\s+1\s+0\s+1/);
    assert.match(result.stdout, /Beta School\s+2\s+2\s+0/);
    assert.match(result.stdout, /TOTAL\s+3\s+2\s+1/);
    // The top-20 leaderboard lists the outside-bbox routes, never the
    // fillable ones.
    assert.match(result.stdout, /Top 2 outside-bbox routes/);
    assert.match(result.stdout, /- r2 \(Beta School\)/);
    assert.match(result.stdout, /- r3 \(Beta School\)/);
    assert.equal(
      result.stdout.includes('- r1'),
      false,
      'fillable routes are not in the outside list',
    );
  });

  it('exits 1 with the 404 message when the missing list endpoint is not on the API', async () => {
    api.config.listStatus = 404;

    const result = await runScript(preflightEnv());

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /This API has no platform endpoints \(404\)\. Deploy main first, then re-run\./,
    );
    assert.equal(
      api.loginCalls,
      1,
      'the script still signs in (so the wrong-deploy gets reported as a deploy problem, not a sign-in problem)',
    );
  });

  it('exits 1 with the 401/403 message when the account is not a SUPER_ADMIN', async () => {
    api.config.loginStatus = 403;

    const result = await runScript(preflightEnv());

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Sign-in or role problem\. The account must be SUPER_ADMIN\. Check OSRM_PLATFORM_EMAIL and OSRM_PLATFORM_PASSWORD\./,
    );
  });

  it('retries the health probe up to 6 times, 20 s apart, then exits 1', async () => {
    api.config.healthStatus = 502;
    api.config.healthAttempt = 99; // every probe answers 502

    // The retry budget is 6 * 20 s = 120 s — too long for a unit test. The
    // script honours a SHORT_HEALTH_WARM_INTERVAL_MS env var for the spec
    // (10 ms), so the run completes in well under a second while still
    // exercising the loop.
    const result = await runScript(preflightEnv({ SHORT_HEALTH_WARM_INTERVAL_MS: '10' }));

    assert.equal(result.code, 1);
    assert.equal(api.healthCalls, 6, 'the warm-up budget is exactly 6 attempts');
    assert.match(result.stderr, /never answered after 6 attempts/);
  });

  it('recovers within the warm-up budget when a cold start answers a few 5xx then 200', async () => {
    api.config.healthStatus = 502;
    api.config.healthAttempt = 3; // first 3 probes answer 502, the 4th answers 200

    const result = await runScript(preflightEnv({ SHORT_HEALTH_WARM_INTERVAL_MS: '10' }));

    assert.equal(result.code, 0, result.stderr);
    assert.ok(api.healthCalls >= 4, 'the warm-up retries past the cold-start window');
    assert.equal(api.loginCalls, 1, 'and proceeds to sign in');
  });
});
