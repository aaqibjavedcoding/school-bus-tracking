#!/usr/bin/env node
/**
 * osrm-backfill.mjs — fill the route-geometry forever-cache from a running
 * OSRM engine, through the public API. 100% free and keyless: the engine is
 * the self-hosted BSD-2 OSRM container, the API is ours.
 *
 * Three modes, selected by ADMIN_MODE and CHECK_ONLY:
 *
 * ## ADMIN_MODE=school (default) — one school, one SCHOOL_ADMIN token
 *
 * For every route of the token's school that has no cached geometry yet
 * (or every route id passed explicitly):
 *
 *   1. GET  /routes/:id/stops                                  (ordered stops)
 *   2. GET  {OSRM}/route/v1/driving/{lng,lat;…}?overview=full&geometries=geojson&steps=true
 *   3. PUT  /routes/:id/geometry                                (engine result)
 *   4. GET  /routes/:id/geometry                                (verify cache hit)
 *
 * ## ADMIN_MODE=platform — every school, one SUPER_ADMIN token
 *
 * For every route of EVERY school whose geometry is missing for its current
 * stop list (the platform list already carries those stops, so no school
 * read is needed — and the SUPER_ADMIN has none):
 *
 *   1. GET  /admin/routes/geometry/missing?page&limit[&bbox]   (all pages, snapshot)
 *   2. GET  {OSRM}/route/v1/driving/…  per route               (on this runner)
 *   3. PUT  /admin/routes/:id/geometry                         (server pins the key)
 *   4. GET  /admin/routes/geometry/missing                     (re-check: what is left)
 *
 * and prints filled / no road route / failed per school, to stdout and to the
 * GitHub step summary. Routes the engine cannot route (NoRoute / NoSegment —
 * outside the extract, or a stop far from any road) are reported, not failed:
 * the map keeps the dashed line for them. New routes added later are picked
 * up by the next run; routes already cached are never touched.
 *
 * ## CHECK_ONLY=1 + ADMIN_MODE=platform — preflight only, no graph, no engine
 *
 * Warms the API (because Render sleeps), signs in as SUPER_ADMIN with the
 * e-mail + password secrets, walks the missing list (passing `bbox` when
 * `BBOX` is set), prints a per-school table (missing, outside bbox, fillable)
 * plus the top 20 outside-bbox routes and the deployed commit, writes the
 * same to the GitHub step summary, and emits `needs_run=true|false` to
 * `$GITHUB_OUTPUT` (where `needs_run = fillable > 0`). The script exits 0
 * when the check itself worked, even when `needs_run=false` — a clean
 * nothing-to-do result is success, not failure.
 *
 *   404        → exit 1: the API has no platform endpoints. Deploy main first.
 *   401 / 403  → exit 1: the account is not a SUPER_ADMIN, or the password
 *                     was just rotated. Fix the OSRM_PLATFORM_* secrets.
 *   network or cold start → 6 tries 20 s apart, the last error wins.
 *
 * The PUT body is the engine's own vocabulary mapped onto the API's
 * (`RouteGeometryStoreRequest`): the server keys the row by the route's
 * CURRENT stop list, so the next read is a cache hit by construction. In
 * platform mode a route whose stops changed between the list and the write
 * is detected (the stored key differs from the listed one) and its row is
 * dropped via the recompute endpoint, so a wrong polyline is never left
 * cached under a key it was not computed for.
 *
 * Usage (school backfill — the default):
 *
 *   OSRM_BASE=http://localhost:5000 \
 *   API_BASE=https://kidbus.onrender.com/api/v1 \
 *   ADMIN_TOKEN=<SCHOOL_ADMIN access token> \
 *   node scripts/osrm-backfill.mjs
 *
 *   (`node scripts/osrm-backfill.mjs [routeId …]` takes optional route ids)
 *
 * Usage (platform backfill):
 *
 *   OSRM_BASE=http://localhost:5000 \
 *   API_BASE=https://kidbus.onrender.com/api/v1 \
 *   ADMIN_MODE=platform \
 *   ADMIN_TOKEN=<SUPER_ADMIN access token> \
 *   node scripts/osrm-backfill.mjs
 *
 * Usage (preflight / dry-run check, the workflow calls this in the
 * `preflight` step before it pays the 15-minute graph build):
 *
 *   API_BASE=https://kidbus.onrender.com/api/v1 \
 *   ADMIN_MODE=platform \
 *   CHECK_ONLY=1 \
 *   PLATFORM_EMAIL=<SUPER_ADMIN e-mail> \
 *   PLATFORM_PASSWORD=<SUPER_ADMIN password> \
 *   [BBOX=78.60,20.70,79.60,21.60] \
 *   node scripts/osrm-backfill.mjs
 *
 * Environment:
 *   ADMIN_MODE          `school` (default) or `platform`. Anything else exits 1.
 *   API_BASE            API base URL, e.g. https://host/api/v1. Required.
 *   ADMIN_TOKEN         Bearer access token (CSRF-exempt): a SCHOOL_ADMIN
 *                       token in school mode, a SUPER_ADMIN token in
 *                       platform mode. NOT required when CHECK_ONLY=1 (the
 *                       check signs in itself).
 *   CHECK_ONLY          `1` to run the preflight only; honoured only when
 *                       ADMIN_MODE=platform. Mutually exclusive with the
 *                       actual backfill (the script does not start the
 *                       engine or call /route).
 *   OSRM_BASE           Routing engine base URL. Default http://localhost:5000.
 *                       Not consulted when CHECK_ONLY=1.
 *   ROUTE_IDS           School mode only: comma-separated route ids — alter-
 *                       native to argv. When set (or argv ids are given)
 *                       exactly those routes are (re)filled; otherwise every
 *                       route of the school missing geometry. Platform mode
 *                       and check mode ignore it.
 *   PLATFORM_EMAIL      Check mode only: SUPER_ADMIN e-mail passed to
 *                       POST /auth/login.
 *   PLATFORM_PASSWORD   Check mode only: SUPER_ADMIN password.
 *   BBOX                Check mode and the platform backfill's listing only:
 *                       `minLon,minLat,maxLon,maxLat` of the OSM extract the
 *                       engine is built from. When set, the response tags
 *                       every missing route with `stopsOutsideBbox` and the
 *                       per-school / platform totals carry `outsideBbox` and
 *                       `fillable`. A malformed box is 400.
 *
 * Exit code: 0 when every targeted route ended verified (routes the engine
 * cannot route are reported but do not fail the run — that is the documented
 * honest fallback: outside the extract OSRM answers NoRoute and the map draws
 * the dashed stop-to-stop line), 1 on API/transport failures or an invalid
 * configuration. A 401/403 in platform mode stops the run at once: the access
 * token has expired or the account is not a SUPER_ADMIN — re-run, and routes
 * already filled are skipped. A 404 on the missing list endpoint in check
 * mode is the operator's signal that the API deployment does not yet carry
 * the platform endpoints.
 */
import { appendFileSync, writeFileSync } from 'node:fs';

const API_BASE = (process.env.API_BASE ?? '').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const OSRM_BASE = (process.env.OSRM_BASE ?? 'http://localhost:5000').replace(/\/+$/, '');

/** `school` (default) or `platform` — see the header. */
const ADMIN_MODE = (process.env.ADMIN_MODE ?? '').trim().toLowerCase() || 'school';
if (ADMIN_MODE !== 'school' && ADMIN_MODE !== 'platform') {
  console.error(`ERROR: ADMIN_MODE must be "school" or "platform" (got "${ADMIN_MODE}").`);
  process.exit(1);
}

/** `1` to run the preflight only; honoured only with ADMIN_MODE=platform. */
const CHECK_ONLY = (process.env.CHECK_ONLY ?? '').trim() === '1';

if (!API_BASE) {
  console.error('ERROR: API_BASE is required (e.g. https://host/api/v1).');
  process.exit(1);
}
if (CHECK_ONLY && ADMIN_MODE !== 'platform') {
  console.error('ERROR: CHECK_ONLY=1 is only supported with ADMIN_MODE=platform.');
  process.exit(1);
}

/**
 * Resolve the bearer token the script will use.
 *
 * Three paths, in priority order:
 *  1. A pre-signed `ADMIN_TOKEN` (school mode and the existing fast path).
 *  2. `PLATFORM_EMAIL` + `PLATFORM_PASSWORD`: the script signs in itself.
 *     This is what the workflow uses for the platform backfill step,
 *     because the preflight's token has a 15-minute lifetime and the
 *     graph build can eat most of it on a slow runner.
 *  3. None: exit 1 with the same message the original script had.
 */
let resolvedToken = ADMIN_TOKEN;
if (!CHECK_ONLY && !resolvedToken) {
  if (ADMIN_MODE === 'school') {
    console.error('ERROR: ADMIN_TOKEN is required (a SCHOOL_ADMIN access token).');
    process.exit(1);
  }
  const email = (process.env.PLATFORM_EMAIL ?? '').trim();
  const password = process.env.PLATFORM_PASSWORD ?? '';
  if (!email || !password) {
    console.error(
      'ERROR: ADMIN_TOKEN is required (a SUPER_ADMIN access token), or set PLATFORM_EMAIL + PLATFORM_PASSWORD to sign in here.',
    );
    process.exit(1);
  }
  console.log('Signing in as SUPER_ADMIN…');
  try {
    const { status, body } = await apiCall('POST', '/auth/login', { email, password });
    if (status === 401 || status === 403) {
      console.error(
        'Sign-in or role problem. The account must be SUPER_ADMIN. Check OSRM_PLATFORM_EMAIL and OSRM_PLATFORM_PASSWORD.',
      );
      process.exit(1);
    }
    if (status !== 200 || !body?.success) {
      console.error(`ERROR: POST /auth/login failed (${status}): ${JSON.stringify(body)}`);
      process.exit(1);
    }
    const token = body?.data?.access_token;
    if (typeof token !== 'string' || token.length === 0) {
      console.error(`ERROR: POST /auth/login returned no access_token: ${JSON.stringify(body)}`);
      process.exit(1);
    }
    resolvedToken = token;
  } catch (error) {
    console.error(
      `ERROR: sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const explicitIds = [
  ...process.argv.slice(2),
  ...(process.env.ROUTE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
];

/** Optional bbox query string for the platform list. */
const BBOX = (process.env.BBOX ?? '').trim();

/** One API call; throws on transport errors, returns { status, body }. */
async function apiCall(method, path, body, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

/** All route ids of the token's school (paginated, minimal shape). */
async function listRouteIds() {
  const ids = [];
  let page = 1;
  for (;;) {
    const { status, body } = await apiCall('GET', `/routes?limit=100&page=${page}&include=minimal`);
    if (status !== 200 || !body?.success) {
      throw new Error(`GET /routes?page=${page} failed (${status}): ${JSON.stringify(body)}`);
    }
    for (const item of body.data?.items ?? []) {
      if (typeof item?.id === 'string') ids.push(item.id);
    }
    const totalPages = body.data?.meta?.totalPages ?? 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return ids;
}

/** The route's located stops, in manifest order. */
async function locatedStops(routeId) {
  const { status, body } = await apiCall('GET', `/routes/${routeId}/stops`);
  if (status !== 200 || !body?.success) {
    throw new Error(`GET /routes/${routeId}/stops failed (${status}): ${JSON.stringify(body)}`);
  }
  const items = Array.isArray(body.data?.items) ? body.data.items : [];
  return items
    .filter(
      (stop) =>
        typeof stop?.latitude === 'number' &&
        Number.isFinite(stop.latitude) &&
        typeof stop?.longitude === 'number' &&
        Number.isFinite(stop.longitude),
    )
    .sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0));
}

/** The engine's road route through the stops, or null (with a reason). */
async function engineRoute(coordinates) {
  const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true`;
  let response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { route: null, reason: `engine unreachable: ${error.message}` };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.code !== 'Ok' || !Array.isArray(body.routes)) {
    return { route: null, reason: `engine answered ${body?.code ?? response.status}` };
  }
  const [route] = body.routes;
  const usable =
    route &&
    route.geometry?.type === 'LineString' &&
    Array.isArray(route.geometry.coordinates) &&
    route.geometry.coordinates.length >= 2 &&
    Number.isFinite(route.distance) &&
    Number.isFinite(route.duration);
  return usable
    ? { route, reason: null }
    : { route: null, reason: 'engine route missing geometry or totals' };
}

/** Engine vocabulary → the API's `RouteGeometryStoreRequest` body. */
function toStoreBody(route) {
  return {
    status: 'road',
    geometry: route.geometry,
    distance_meters: route.distance,
    duration_seconds: route.duration,
    legs: (route.legs ?? []).map((leg) => ({
      distance_meters: leg?.distance ?? 0,
      duration_seconds: leg?.duration ?? 0,
      maneuvers: (leg?.steps ?? [])
        .filter(
          (step) =>
            typeof step?.maneuver?.type === 'string' && Array.isArray(step?.maneuver?.location),
        )
        .map((step) => ({
          type: step.maneuver.type,
          modifier: step.maneuver.modifier ?? null,
          road_name: typeof step.name === 'string' ? step.name : '',
          distance_meters: Number.isFinite(step.distance) ? step.distance : 0,
          location: step.maneuver.location,
        })),
    })),
    provider: 'osrm',
    computed_at: new Date().toISOString(),
  };
}

const summary = {
  targeted: 0,
  already_cached: 0,
  backfilled: 0,
  no_route: 0,
  no_located_stops: 0,
  failed: 0,
};
const failures = [];

async function backfillRoute(routeId, { force }) {
  summary.targeted += 1;

  if (!force) {
    const { status, body } = await apiCall('GET', `/routes/${routeId}/geometry`);
    if (status !== 200 || !body?.success) {
      throw new Error(`GET geometry failed (${status}): ${JSON.stringify(body)}`);
    }
    if (body.data?.status === 'ok') {
      summary.already_cached += 1;
      console.log(
        `  = ${routeId}  already cached (stops_hash ${(body.data.stops_hash ?? '').slice(0, 12)}…)`,
      );
      return;
    }
  }

  const stops = await locatedStops(routeId);
  if (stops.length < 2) {
    summary.no_located_stops += 1;
    console.log(`  . ${routeId}  fewer than two located stops — nothing to route`);
    return;
  }

  const coordinates = stops.map((stop) => [stop.longitude, stop.latitude]);
  const { route, reason } = await engineRoute(coordinates);
  if (route === null) {
    summary.no_route += 1;
    console.log(`  ! ${routeId}  no road route (${reason}) — map keeps the dashed line`);
    return;
  }

  const put = await apiCall('PUT', `/routes/${routeId}/geometry`, toStoreBody(route));
  if (put.status !== 200 || !put.body?.success) {
    summary.failed += 1;
    failures.push(`${routeId}: PUT answered ${put.status}: ${JSON.stringify(put.body)}`);
    console.log(`  x ${routeId}  PUT failed (${put.status})`);
    return;
  }

  const verify = await apiCall('GET', `/routes/${routeId}/geometry`);
  const ok =
    verify.status === 200 &&
    verify.body?.success &&
    verify.body?.data?.status === 'ok' &&
    typeof verify.body?.data?.stops_hash === 'string' &&
    verify.body.data.stops_hash.length === 64;
  if (!ok) {
    summary.failed += 1;
    failures.push(
      `${routeId}: verification GET did not return a cached row: ${JSON.stringify(verify.body)}`,
    );
    console.log(`  x ${routeId}  stored but the verification GET is not a cache hit`);
    return;
  }

  summary.backfilled += 1;
  console.log(
    `  + ${routeId}  stored ${(route.distance / 1000).toFixed(1)} km / ${(route.duration / 60).toFixed(0)} min, stops_hash ${verify.body.data.stops_hash.slice(0, 12)}…`,
  );
}

async function runSchoolBackfill() {
  console.log(`OSRM route-geometry backfill (ADMIN_MODE=school)`);
  console.log(`  api    : ${API_BASE}`);
  console.log(`  engine : ${OSRM_BASE}`);
  console.log(
    `  scope  : ${explicitIds.length > 0 ? `${explicitIds.length} explicit route id(s)` : 'every route missing geometry'}`,
  );

  const targets = explicitIds.length > 0 ? explicitIds : await listRouteIds();
  console.log(`  routes : ${targets.length}\n`);

  for (const routeId of targets) {
    try {
      await backfillRoute(routeId, { force: explicitIds.length > 0 });
    } catch (error) {
      summary.failed += 1;
      failures.push(`${routeId}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`  x ${routeId}  ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  targeted            : ${summary.targeted}`);
  console.log(`  already cached      : ${summary.already_cached}`);
  console.log(`  backfilled          : ${summary.backfilled}`);
  console.log(
    `  no road route       : ${summary.no_route}  (engine: outside the extract? → dashed-line fallback)`,
  );
  console.log(`  no located stops    : ${summary.no_located_stops}`);
  console.log(`  failed              : ${summary.failed}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const failure of failures) console.log(`  - ${failure}`);
  }

  // GitHub Actions step summary (best effort — local runs just skip it).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## OSRM route-geometry backfill',
      '',
      `| Outcome | Routes |`,
      `| --- | ---: |`,
      `| targeted | ${summary.targeted} |`,
      `| already cached | ${summary.already_cached} |`,
      `| backfilled (verified cache hit) | ${summary.backfilled} |`,
      `| no road route (dashed-line fallback) | ${summary.no_route} |`,
      `| fewer than two located stops | ${summary.no_located_stops} |`,
      `| failed | ${summary.failed} |`,
      '',
      `Engine: \`${OSRM_BASE}\` · API: \`${API_BASE}\``,
      '',
    ];
    if (failures.length > 0) {
      lines.push('### Failures', '');
      for (const failure of failures) lines.push(`- ${failure}`);
      lines.push('');
    }
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    } catch {
      // A missing summary file is not a backfill failure.
    }
  }

  process.exit(summary.failed > 0 ? 1 : 0);
}

/* -------------------------------------------------------------------------
 * ADMIN_MODE=platform — every school, one SUPER_ADMIN credential.
 *
 * The list endpoint hands over each missing route WITH its located stops, so
 * the run needs no school-scoped read (a SUPER_ADMIN gets 403 there, by
 * design). Everything is decided from one snapshot of the list; the re-check
 * at the end is what turns "stored" into "verified".
 * ---------------------------------------------------------------------- */

const PLATFORM_PAGE_SIZE = 100;
const MISSING_PATH = '/admin/routes/geometry/missing';

/** The token was refused (expired, or not a SUPER_ADMIN): the run stops. */
class AuthRefusedError extends Error {}

/** The platform list endpoint is not on this deployment (404): the run stops. */
class PlatformMissing404Error extends Error {}

/** One API call in platform mode: a 401/403 aborts the run at once. */
async function platformCall(method, path, body, token) {
  const result = await apiCall(method, path, body, token);
  if (result.status === 401 || result.status === 403) {
    throw new AuthRefusedError(
      `${method} ${path} answered ${result.status}: the access token is expired or is not a SUPER_ADMIN token. ` +
        'Re-run the workflow — routes already filled are skipped.',
    );
  }
  if (result.status === 404) {
    throw new PlatformMissing404Error(
      `${method} ${path} answered 404: this API has no platform endpoints. ` +
        'Deploy main first, then re-run.',
    );
  }
  return result;
}

/**
 * Every page of the missing list. Returns the de-duplicated routes, plus the
 * per-school counts and the platform totals of the first page (those cover
 * ALL schools, whatever the page size).
 */
async function listAllMissing(token) {
  const routes = new Map();
  let schools = [];
  let totals = null;
  for (let page = 1; ; page += 1) {
    const path = `${MISSING_PATH}?page=${page}&limit=${PLATFORM_PAGE_SIZE}${
      BBOX ? `&bbox=${encodeURIComponent(BBOX)}` : ''
    }`;
    const { status, body } = await platformCall('GET', path, undefined, token);
    if (status !== 200 || !body?.success) {
      throw new Error(
        `GET ${MISSING_PATH} page ${page} failed (${status}): ${JSON.stringify(body)}`,
      );
    }
    if (page === 1) {
      schools = Array.isArray(body.data?.schools) ? body.data.schools : [];
      totals = body.data?.totals ?? null;
    }
    for (const item of body.data?.items ?? []) {
      if (typeof item?.route_id === 'string' && !routes.has(item.route_id)) {
        routes.set(item.route_id, item);
      }
    }
    if (!body.data?.meta?.hasNextPage) break;
  }
  return { routes: [...routes.values()], schools, totals };
}

/**
 * The engine's answer for one route, classified for the platform summary:
 *   ok       — a usable road route;
 *   noroute  — OSRM has no road for these stops (NoRoute / NoSegment: outside
 *              the extract, or a stop far from any road). Honest fallback;
 *   failed   — the engine is unreachable or answered something unusable.
 */
async function engineOutcome(coordinates) {
  const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true`;
  let response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { kind: 'failed', reason: `engine unreachable: ${error.message}` };
  }
  const body = await response.json().catch(() => null);
  if (body?.code === 'NoRoute' || body?.code === 'NoSegment') {
    return { kind: 'noroute', reason: `engine answered ${body.code}` };
  }
  if (!response.ok || !body || body.code !== 'Ok' || !Array.isArray(body.routes)) {
    return { kind: 'failed', reason: `engine answered ${body?.code ?? response.status}` };
  }
  const [route] = body.routes;
  const usable =
    route &&
    route.geometry?.type === 'LineString' &&
    Array.isArray(route.geometry.coordinates) &&
    route.geometry.coordinates.length >= 2 &&
    Number.isFinite(route.distance) &&
    Number.isFinite(route.duration);
  return usable
    ? { kind: 'ok', route }
    : { kind: 'failed', reason: 'engine route missing geometry or totals' };
}

/** Escapes a cell for a GitHub-flavoured markdown table. */
function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

/** A fixed-width text table for the console. */
function consoleTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const line = (cells) =>
    cells
      .map((value, index) =>
        index === 0 ? String(value).padEnd(widths[index]) : String(value).padStart(widths[index]),
      )
      .join('  ');
  return [line(headers), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)];
}

async function runPlatformBackfill() {
  console.log('OSRM route-geometry backfill (ADMIN_MODE=platform — every school, one credential)');
  console.log(`  api    : ${API_BASE}`);
  console.log(`  engine : ${OSRM_BASE}`);
  if (BBOX) {
    console.log(`  bbox   : ${BBOX}`);
  }
  if (explicitIds.length > 0) {
    console.log(
      `::notice::ROUTE_IDS is school-mode only and is ignored in platform mode (${explicitIds.length} id(s) given).`,
    );
  }

  console.log('\nListing the routes still missing road geometry (every school)…');
  const before = await listAllMissing(resolvedToken);
  if (before.totals) {
    console.log(
      `  routes  : ${before.totals.routes_total} across ${before.schools.length} school(s) — ` +
        `${before.totals.routes_cached} cached, ${before.totals.routes_unlocated} with fewer than two located stops` +
        (BBOX && before.totals.outsideBbox !== null
          ? `, ${before.totals.outsideBbox} with at least one stop outside the bbox`
          : ''),
    );
  }
  console.log(`  missing : ${before.routes.length}\n`);

  // One ledger row per school, created from the snapshot (zero-missing schools included).
  const ledger = new Map();
  const rowFor = (schoolId, schoolName) => {
    let row = ledger.get(schoolId);
    if (!row) {
      row = {
        school_id: schoolId,
        school_name: schoolName,
        missing: 0,
        outsideBbox: 0,
        fillable: 0,
        filled: 0,
        noRoute: 0,
        failed: 0,
        left: 0,
      };
      ledger.set(schoolId, row);
    }
    return row;
  };
  for (const school of before.schools) {
    const row = rowFor(school.school_id, school.school_name);
    row.missing = school.routes_missing;
    if (BBOX && school.outsideBbox !== null) {
      row.outsideBbox = school.outsideBbox;
      row.fillable = school.fillable ?? 0;
    } else {
      // Without a bbox every missing route is "fillable" by this service's
      // view; the engine still gets to say NoRoute per route, the way path C
      // has always worked. The preflight / dry-run table makes the same
      // assumption and that is why a `BBOX` matters: it cuts the engine
      // questions that have no road for them.
      row.fillable = school.routes_missing;
    }
  }

  const failures = [];
  const written = [];
  for (const item of before.routes) {
    const row = rowFor(item.school_id, item.school_name);
    const label = `${item.route_id} (${item.school_name})`;
    const coordinates = item.stops.map((stop) => [stop.longitude, stop.latitude]);

    const outcome = await engineOutcome(coordinates);
    if (outcome.kind === 'noroute') {
      row.noRoute += 1;
      console.log(`  ! ${label}  ${outcome.reason} — map keeps the dashed line`);
      continue;
    }
    if (outcome.kind === 'failed') {
      row.failed += 1;
      failures.push(`${label}: ${outcome.reason}`);
      console.log(`  x ${label}  ${outcome.reason}`);
      continue;
    }

    const put = await platformCall(
      'PUT',
      `/admin/routes/${encodeURIComponent(item.route_id)}/geometry`,
      toStoreBody(outcome.route),
      resolvedToken,
    );
    if (put.status !== 200 || !put.body?.success) {
      row.failed += 1;
      failures.push(`${label}: PUT answered ${put.status}: ${JSON.stringify(put.body)}`);
      console.log(`  x ${label}  PUT failed (${put.status})`);
      continue;
    }

    if (put.body.data?.stops_hash !== item.stops_hash) {
      // The stops changed between the list and this write. The row was stored
      // under the NEW key with a polyline computed for the OLD stops: drop it,
      // so the route is missing again and the next run computes it correctly.
      const dropped = await platformCall(
        'POST',
        `/admin/routes/${encodeURIComponent(item.route_id)}/geometry/recompute`,
        undefined,
        resolvedToken,
      );
      row.failed += 1;
      const dropNote =
        dropped.status === 200
          ? 'the mismatched row was dropped'
          : `could not drop it (${dropped.status})`;
      failures.push(`${label}: its stops changed during the run; ${dropNote} — re-run to fill it`);
      console.log(`  x ${label}  stops changed during the run; ${dropNote}`);
      continue;
    }

    written.push({ item, row });
    console.log(
      `  + ${label}  stored ${(outcome.route.distance / 1000).toFixed(1)} km / ${(outcome.route.duration / 60).toFixed(0)} min`,
    );
  }

  console.log('\nRe-checking the missing list…');
  const after = await listAllMissing(resolvedToken);
  const stillMissing = new Set(after.routes.map((route) => route.route_id));
  for (const { item, row } of written) {
    if (stillMissing.has(item.route_id)) {
      row.failed += 1;
      failures.push(
        `${item.route_id} (${item.school_name}): stored, but still missing on the re-check`,
      );
    } else {
      row.filled += 1;
    }
  }
  for (const school of after.schools) {
    const row = rowFor(school.school_id, school.school_name);
    row.left = school.routes_missing;
  }

  const rows = [...ledger.values()]
    .filter((row) => row.missing > 0 || row.left > 0)
    .sort(
      (a, b) =>
        a.school_name.localeCompare(b.school_name) || a.school_id.localeCompare(b.school_id),
    );
  const total = rows.reduce(
    (sum, row) => ({
      missing: sum.missing + row.missing,
      outsideBbox: sum.outsideBbox + row.outsideBbox,
      fillable: sum.fillable + row.fillable,
      filled: sum.filled + row.filled,
      noRoute: sum.noRoute + row.noRoute,
      failed: sum.failed + row.failed,
      left: sum.left + row.left,
    }),
    { missing: 0, outsideBbox: 0, fillable: 0, filled: 0, noRoute: 0, failed: 0, left: 0 },
  );

  console.log('\nSummary (per school):');
  if (rows.length === 0) {
    console.log('  nothing to fill — every routable route already has a cached geometry.');
  } else {
    const headers = BBOX
      ? ['school', 'missing', 'outside', 'fillable', 'filled', 'no road', 'failed', 'left']
      : ['school', 'missing', 'filled', 'no road', 'failed', 'left'];
    const body = rows.map((row) =>
      BBOX
        ? [
            row.school_name,
            row.missing,
            row.outsideBbox,
            row.fillable,
            row.filled,
            row.noRoute,
            row.failed,
            row.left,
          ]
        : [row.school_name, row.missing, row.filled, row.noRoute, row.failed, row.left],
    );
    const totalRow = BBOX
      ? [
          'TOTAL',
          total.missing,
          total.outsideBbox,
          total.fillable,
          total.filled,
          total.noRoute,
          total.failed,
          total.left,
        ]
      : ['TOTAL', total.missing, total.filled, total.noRoute, total.failed, total.left];
    body.push(totalRow);
    for (const line of consoleTable(headers, body)) console.log(`  ${line}`);
  }
  console.log(
    '\n  filled   = stored and verified by the re-check (a cache hit on the current stops)',
  );
  console.log(
    '  no road  = the engine has no road for these stops (dashed-line fallback; not a failure)',
  );
  console.log('  failed   = engine, transport or API trouble — re-run the workflow');
  console.log(
    '  left     = still missing after this run (no road + failed + anything the re-check still lists)',
  );
  if (BBOX) {
    console.log(
      '  outside  = missing routes with at least one stop outside the bbox (not fillable)',
    );
    console.log('  fillable = missing routes whose stops are all inside the bbox');
  }
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }

  // GitHub Actions step summary (best effort — local runs just skip it).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## OSRM route-geometry backfill — platform (every school)',
      '',
      `Routes missing at start: **${total.missing}** · filled (verified): **${total.filled}** · no road route: **${total.noRoute}** · failed: **${total.failed}** · left: **${total.left}**` +
        (BBOX ? ` · outside bbox: **${total.outsideBbox}** · fillable: **${total.fillable}**` : ''),
      '',
    ];
    if (rows.length > 0) {
      const tableHeaders = BBOX
        ? '| School | Missing | Outside | Fillable | Filled | No road route | Failed | Left |'
        : '| School | Missing | Filled | No road route | Failed | Left |';
      const tableDivider = BBOX
        ? '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
        : '| --- | ---: | ---: | ---: | ---: | ---: |';
      lines.push(tableHeaders, tableDivider);
      for (const row of rows) {
        if (BBOX) {
          lines.push(
            `| ${cell(row.school_name)} | ${row.missing} | ${row.outsideBbox} | ${row.fillable} | ${row.filled} | ${row.noRoute} | ${row.failed} | ${row.left} |`,
          );
        } else {
          lines.push(
            `| ${cell(row.school_name)} | ${row.missing} | ${row.filled} | ${row.noRoute} | ${row.failed} | ${row.left} |`,
          );
        }
      }
      if (BBOX) {
        lines.push(
          `| **TOTAL** | **${total.missing}** | **${total.outsideBbox}** | **${total.fillable}** | **${total.filled}** | **${total.noRoute}** | **${total.failed}** | **${total.left}** |`,
        );
      } else {
        lines.push(
          `| **TOTAL** | **${total.missing}** | **${total.filled}** | **${total.noRoute}** | **${total.failed}** | **${total.left}** |`,
        );
      }
      lines.push('');
    }
    lines.push(
      '`filled` = stored and confirmed by the re-check. `no road route` = OSRM has no road for the stops (dashed-line fallback). `failed` = re-run the workflow.',
      '',
      `Engine: \`${OSRM_BASE}\` · API: \`${API_BASE}\``,
      '',
    );
    if (failures.length > 0) {
      lines.push('### Failures', '');
      for (const failure of failures) lines.push(`- ${failure}`);
      lines.push('');
    }
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    } catch {
      // A missing summary file is not a backfill failure.
    }
  }

  process.exit(total.failed > 0 ? 1 : 0);
}

/* -------------------------------------------------------------------------
 * CHECK_ONLY=1 — preflight. No graph, no engine, no fill: the workflow runs
 * this step right after the input check so a wrong deploy or wrong login is
 * caught in seconds, not 15 minutes after the graph build. The output
 * (`needs_run` in $GITHUB_OUTPUT) gates the rest of the job: graph build
 * only runs when there's something to do.
 * ---------------------------------------------------------------------- */

/** Max warm-up attempts against the API. A free Render instance sleeps. */
const HEALTH_WARM_TRIES = 6;
/** Spacing between warm-up attempts. 6 * 20 s = 2 minutes of patience. */
const HEALTH_WARM_INTERVAL_MS = 20_000;

/** Test-only override: the spec shrinks the wait so the retry-budget test finishes in ms. */
const TEST_HEALTH_WARM_INTERVAL_MS = (() => {
  const raw = process.env.SHORT_HEALTH_WARM_INTERVAL_MS;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
})();

/** Wakes the API (a free Render instance may be sleeping): GET /health. */
async function warmApi() {
  const intervalMs = TEST_HEALTH_WARM_INTERVAL_MS ?? HEALTH_WARM_INTERVAL_MS;
  let lastError = null;
  for (let attempt = 1; attempt <= HEALTH_WARM_TRIES; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`GET /health answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    console.error(
      `  warm-up: ${API_BASE}/health did not answer (attempt ${attempt}/${HEALTH_WARM_TRIES}); ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
        `Waiting ${intervalMs / 1000}s…`,
    );
    await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
  }
  throw new Error(
    `GET ${API_BASE}/health never answered after ${HEALTH_WARM_TRIES} attempts: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}

/**
 * Sign in as a platform SUPER_ADMIN.
 *
 * The backfill uses the same `POST /api/v1/auth/login` the web client does:
 * no school_id (a SUPER_ADMIN belongs to no tenant), e-mail + password.
 * The password is the only secret in the preflight, kept out of the log
 * (the e-mail is the account name, the password is replaced by a marker).
 */
async function signInAsSuperAdmin() {
  const email = (process.env.PLATFORM_EMAIL ?? '').trim();
  const password = process.env.PLATFORM_PASSWORD ?? '';
  if (!email || !password) {
    throw new Error(
      'PLATFORM_EMAIL and PLATFORM_PASSWORD are required in check mode (the same secrets the workflow passes to the backfill).',
    );
  }
  const { status, body } = await apiCall('POST', '/auth/login', { email, password });
  if (status === 401 || status === 403) {
    throw new Error(
      'Sign-in or role problem. The account must be SUPER_ADMIN. Check OSRM_PLATFORM_EMAIL and OSRM_PLATFORM_PASSWORD.',
    );
  }
  if (status !== 200 || !body?.success) {
    throw new Error(`POST /auth/login failed (${status}): ${JSON.stringify(body)}`);
  }
  const token = body?.data?.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`POST /auth/login returned no access_token: ${JSON.stringify(body)}`);
  }
  return { token, user: body?.data?.user ?? null };
}

/** `true` iff the access token lifetime is past the now-anchor. */
function tokenAlreadyExpired(user) {
  // The login response includes `expires_in` (seconds) and the API also
  // pins the access-token lifetime centrally. We could decode the JWT, but
  // the response is the simpler source: it's what the client sees.
  if (user && typeof user.token_expires_at === 'number') {
    return user.token_expires_at <= Date.now();
  }
  return false;
}

async function runPreflight() {
  console.log('OSRM route-geometry preflight (CHECK_ONLY=1, ADMIN_MODE=platform)');
  console.log(`  api    : ${API_BASE}`);
  if (BBOX) {
    console.log(`  bbox   : ${BBOX}`);
  }

  // 1. Wake the API. The first GET /health is also the "did the deploy
  //    actually land?" probe; if the platform endpoints aren't there, the
  //    next call (the missing list) answers 404 and the check stops with
  //    the operator's clear next step.
  console.log('\nWarming the API…');
  const health = await warmApi();
  const commit = typeof health?.commit === 'string' ? health.commit : 'unknown';
  console.log(`  health : ok · commit ${commit}`);

  // 2. Sign in. Same 401/403 split as the backfill: a wrong account is a
  //    sign-in or role problem, not a deployment problem.
  console.log('\nSigning in as SUPER_ADMIN…');
  const { token, user } = await signInAsSuperAdmin();
  console.log(
    `  user   : ${user?.email ?? 'unknown'}${tokenAlreadyExpired(user) ? ' (already expired!)' : ''}`,
  );

  // 3. Walk the missing list, with bbox when the operator narrowed it.
  console.log('\nListing the routes still missing road geometry (every school)…');
  let before;
  try {
    before = await listAllMissing(token);
  } catch (error) {
    if (error instanceof PlatformMissing404Error) {
      console.error('This API has no platform endpoints (404). Deploy main first, then re-run.');
      process.exit(1);
    }
    if (error instanceof AuthRefusedError) {
      console.error(
        'Sign-in or role problem. The account must be SUPER_ADMIN. Check OSRM_PLATFORM_EMAIL and OSRM_PLATFORM_PASSWORD.',
      );
      process.exit(1);
    }
    throw error;
  }
  const totals = before.totals ?? {
    routes_total: 0,
    routes_cached: 0,
    routes_missing: 0,
    routes_unlocated: 0,
    outsideBbox: BBOX ? 0 : null,
    fillable: 0,
  };

  // 4. Per-school ledger + the bbox-conditional columns.
  const ledger = new Map();
  const rowFor = (schoolId, schoolName) => {
    let row = ledger.get(schoolId);
    if (!row) {
      row = {
        school_id: schoolId,
        school_name: schoolName,
        missing: 0,
        outsideBbox: 0,
        fillable: 0,
      };
      ledger.set(schoolId, row);
    }
    return row;
  };
  for (const school of before.schools) {
    const row = rowFor(school.school_id, school.school_name);
    row.missing = school.routes_missing;
    if (BBOX && school.outsideBbox !== null) {
      row.outsideBbox = school.outsideBbox;
      row.fillable = school.fillable ?? 0;
    } else {
      row.fillable = school.routes_missing;
    }
  }

  // 5. Outside-bbox leaderboard. A route that ends up here needs a separate
  //    run with the matching extract_url and bbox — there is no way for
  //    this extract to give those routes a road.
  const outsideBboxRoutes = BBOX
    ? before.routes
        .filter((item) => typeof item.stopsOutsideBbox === 'number' && item.stopsOutsideBbox > 0)
        .sort((a, b) => (b.stopsOutsideBbox ?? 0) - (a.stopsOutsideBbox ?? 0))
        .slice(0, 20)
    : [];

  const totalMissing = totals.routes_missing ?? 0;
  const totalFillable = [...ledger.values()].reduce((sum, row) => sum + row.fillable, 0);
  const totalOutside = [...ledger.values()].reduce((sum, row) => sum + row.outsideBbox, 0);
  const needsRun = totalFillable > 0;

  // 6. Console output — the per-school table is the operator's quick read.
  const rows = [...ledger.values()].sort(
    (a, b) => a.school_name.localeCompare(b.school_name) || a.school_id.localeCompare(b.school_id),
  );
  console.log(`\nSummary (per school):`);
  if (rows.length === 0) {
    console.log('  no schools to show (no missing routes)');
  } else {
    const headers = BBOX ? ['school', 'missing', 'outside', 'fillable'] : ['school', 'missing'];
    const body = rows.map((row) =>
      BBOX
        ? [row.school_name, row.missing, row.outsideBbox, row.fillable]
        : [row.school_name, row.missing],
    );
    body.push(
      BBOX ? ['TOTAL', totalMissing, totalOutside, totalFillable] : ['TOTAL', totalMissing],
    );
    for (const line of consoleTable(headers, body)) console.log(`  ${line}`);
  }
  console.log(`\n  total missing : ${totalMissing}`);
  if (BBOX) {
    console.log(`  outside bbox  : ${totalOutside}`);
    console.log(`  fillable      : ${totalFillable}`);
  }
  console.log(`  needs_run     : ${needsRun}`);

  if (outsideBboxRoutes.length > 0) {
    console.log(
      `\nTop ${outsideBboxRoutes.length} outside-bbox routes (need a separate run with the matching extract + bbox):`,
    );
    for (const item of outsideBboxRoutes) {
      console.log(
        `  - ${item.route_id} (${item.school_name}) · ${item.stopsOutsideBbox}/${item.stops.length} stops outside`,
      );
    }
  }

  // 7. GitHub step summary (the same table, with a few more lines).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## OSRM route-geometry preflight',
      '',
      `API: \`${API_BASE}\` · commit \`${commit}\` · needs_run: **${needsRun}**`,
      '',
    ];
    if (BBOX) {
      lines.push(`BBOX: \`${BBOX}\``);
      lines.push('');
    }
    lines.push(
      `Missing: **${totalMissing}** · outside bbox: **${totalOutside}** · fillable: **${totalFillable}**`,
      '',
    );
    if (rows.length > 0) {
      if (BBOX) {
        lines.push(
          '| School | Missing | Outside bbox | Fillable |',
          '| --- | ---: | ---: | ---: |',
        );
        for (const row of rows) {
          lines.push(
            `| ${cell(row.school_name)} | ${row.missing} | ${row.outsideBbox} | ${row.fillable} |`,
          );
        }
        lines.push(
          `| **TOTAL** | **${totalMissing}** | **${totalOutside}** | **${totalFillable}** |`,
        );
      } else {
        lines.push('| School | Missing |', '| --- | ---: |');
        for (const row of rows) {
          lines.push(`| ${cell(row.school_name)} | ${row.missing} |`);
        }
        lines.push(`| **TOTAL** | **${totalMissing}** |`);
      }
      lines.push('');
    }
    if (outsideBboxRoutes.length > 0) {
      lines.push(
        `### Top ${outsideBboxRoutes.length} outside-bbox routes`,
        '',
        'These routes have at least one stop outside the bbox the engine is built from — a separate run with the matching `extract_url` and `bbox` is the only way to give them a road route.',
        '',
      );
      for (const item of outsideBboxRoutes) {
        lines.push(
          `- \`${item.route_id}\` (${cell(item.school_name)}) — ${item.stopsOutsideBbox}/${item.stops.length} stops outside`,
        );
      }
      lines.push('');
    }
    lines.push(
      '`needs_run` is `true` when the platform `totals.fillable` is > 0; the rest of the workflow runs only then.',
      '',
    );
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    } catch {
      // A missing summary file is not a preflight failure.
    }
  }

  // 8. The job-gate output: $GITHUB_OUTPUT is the source of truth for
  //    the next step, the console line is for the operator.
  if (process.env.GITHUB_OUTPUT) {
    try {
      writeFileSync(
        process.env.GITHUB_OUTPUT,
        `needs_run=${needsRun ? 'true' : 'false'}\ncommit=${commit}\n`,
        { flag: 'a' },
      );
    } catch (error) {
      // A missing GITHUB_OUTPUT is not a preflight failure (local runs).
      console.error(
        `  ::notice::could not write to $GITHUB_OUTPUT (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  // 9. Exit 0 when the check itself worked, whatever `needs_run` is — a
  //    clean nothing-to-do is success, not failure. The caller decides
  //    what to do with the `needs_run` value.
  process.exit(0);
}

const main = CHECK_ONLY
  ? runPreflight
  : ADMIN_MODE === 'platform'
    ? runPlatformBackfill
    : runSchoolBackfill;

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
