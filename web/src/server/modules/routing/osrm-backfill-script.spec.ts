import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  };
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
    config: { routes: [], pageSize: 100, listStatus: 200, putHashOverride: new Map() },
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

    if (request.method === 'GET' && url.pathname === '/api/v1/admin/routes/geometry/missing') {
      if (api.config.listStatus !== 200) {
        sendJson(response, api.config.listStatus, { success: false, error: { message: 'refused' } });
        return;
      }
      const pending = api.config.routes.filter((item) => !api.stored.has(item.route_id));
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = api.config.pageSize;
      const slice = pending.slice((page - 1) * pageSize, page * pageSize);
      const totalPages = Math.max(1, Math.ceil(pending.length / pageSize));
      const schools = new Map<string, { school_id: string; school_name: string }>();
      for (const item of api.config.routes) {
        schools.set(item.school_id, { school_id: item.school_id, school_name: item.school_name });
      }
      sendJson(response, 200, {
        success: true,
        data: {
          items: slice,
          meta: {
            page,
            limit: pageSize,
            total: pending.length,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
          schools: [...schools.values()].map((school) => ({
            ...school,
            routes_total: api.config.routes.filter((item) => item.school_id === school.school_id).length,
            routes_cached: 0,
            routes_missing: pending.filter((item) => item.school_id === school.school_id).length,
            routes_unlocated: 0,
          })),
          totals: {
            routes_total: api.config.routes.length,
            routes_cached: 0,
            routes_missing: pending.length,
            routes_unlocated: 0,
          },
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
      sendJson(response, 200, { success: true, data: { status: 'ok', stops_hash: 'c'.repeat(64) } });
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
    api.config = { routes: [], pageSize: 100, listStatus: 200, putHashOverride: new Map() };
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
    assert.match(result.stdout, /Alpha School\s+2\s+1\s+1\s+0\s+1/, 'Alpha: missing 2, filled 1, no road 1, failed 0, left 1');
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
    assert.equal(api.requests.some((request) => request.method === 'PUT'), false);
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
      route(id, index < 3 ? SCHOOL_ALPHA : SCHOOL_BETA, index < 3 ? 'Alpha School' : 'Beta School', [
        [73.0 + index / 100, 33.6844],
        [73.01 + index / 100, 33.6901],
      ]),
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
