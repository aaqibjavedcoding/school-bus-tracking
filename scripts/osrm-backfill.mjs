#!/usr/bin/env node
/**
 * osrm-backfill.mjs — fill the route-geometry forever-cache from a running
 * OSRM engine, through the public API. 100% free and keyless: the engine is
 * the self-hosted BSD-2 OSRM container, the API is ours.
 *
 * Two modes, chosen by ADMIN_MODE:
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
 *   1. GET  /admin/routes/geometry/missing?page&limit          (all pages, snapshot)
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
 * The PUT body is the engine's own vocabulary mapped onto the API's
 * (`RouteGeometryStoreRequest`): the server keys the row by the route's
 * CURRENT stop list, so the next read is a cache hit by construction. In
 * platform mode a route whose stops changed between the list and the write
 * is detected (the stored key differs from the listed one) and its row is
 * dropped via the recompute endpoint, so a wrong polyline is never left
 * cached under a key it was not computed for.
 *
 * Usage:
 *
 *   OSRM_BASE=http://localhost:5000 \
 *   API_BASE=https://kidbus.onrender.com/api/v1 \
 *   ADMIN_MODE=platform \
 *   ADMIN_TOKEN=<SUPER_ADMIN access token> \
 *   node scripts/osrm-backfill.mjs
 *
 *   (school mode, the default: ADMIN_TOKEN is a SCHOOL_ADMIN token, and
 *   `node scripts/osrm-backfill.mjs [routeId …]` takes optional route ids)
 *
 * Environment:
 *   ADMIN_MODE   `school` (default) or `platform`. Anything else exits 1.
 *   API_BASE     API base URL, e.g. https://host/api/v1. Required.
 *   ADMIN_TOKEN  Bearer access token (CSRF-exempt): a SCHOOL_ADMIN token in
 *                school mode, a SUPER_ADMIN token in platform mode. Required.
 *   OSRM_BASE    Routing engine base URL. Default http://localhost:5000.
 *   ROUTE_IDS    School mode only: comma-separated route ids — alternative to
 *                argv. When set (or argv ids are given) exactly those routes
 *                are (re)filled; otherwise every route of the school missing
 *                geometry. Platform mode ignores it (with a notice).
 *
 * Exit code: 0 when every targeted route ended verified (routes the engine
 * cannot route are reported but do not fail the run — that is the documented
 * honest fallback: outside the extract OSRM answers NoRoute and the map draws
 * the dashed stop-to-stop line), 1 on API/transport failures or an invalid
 * configuration. A 401/403 in platform mode stops the run at once: the access
 * token has expired or the account is not a SUPER_ADMIN — re-run, and routes
 * already filled are skipped.
 */
import { appendFileSync } from 'node:fs';

const API_BASE = (process.env.API_BASE ?? '').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const OSRM_BASE = (process.env.OSRM_BASE ?? 'http://localhost:5000').replace(/\/+$/, '');

/** `school` (default) or `platform` — see the header. */
const ADMIN_MODE = (process.env.ADMIN_MODE ?? '').trim().toLowerCase() || 'school';
if (ADMIN_MODE !== 'school' && ADMIN_MODE !== 'platform') {
  console.error(`ERROR: ADMIN_MODE must be "school" or "platform" (got "${ADMIN_MODE}").`);
  process.exit(1);
}

if (!API_BASE) {
  console.error('ERROR: API_BASE is required (e.g. https://host/api/v1).');
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.error(
    ADMIN_MODE === 'platform'
      ? 'ERROR: ADMIN_TOKEN is required (a SUPER_ADMIN access token, signed in without a school).'
      : 'ERROR: ADMIN_TOKEN is required (a SCHOOL_ADMIN access token).',
  );
  process.exit(1);
}

const explicitIds = [
  ...process.argv.slice(2),
  ...(process.env.ROUTE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
];

/** One API call; throws on transport errors, returns { status, body }. */
async function apiCall(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
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

/** One API call in platform mode: a 401/403 aborts the run at once. */
async function platformCall(method, path, body) {
  const result = await apiCall(method, path, body);
  if (result.status === 401 || result.status === 403) {
    throw new AuthRefusedError(
      `${method} ${path} answered ${result.status}: the access token is expired or is not a SUPER_ADMIN token. ` +
        'Re-run the workflow — routes already filled are skipped.',
    );
  }
  return result;
}

/**
 * Every page of the missing list. Returns the de-duplicated routes, plus the
 * per-school counts and the platform totals of the first page (those cover
 * ALL schools, whatever the page size).
 */
async function listAllMissing() {
  const routes = new Map();
  let schools = [];
  let totals = null;
  for (let page = 1; ; page += 1) {
    const { status, body } = await platformCall(
      'GET',
      `${MISSING_PATH}?page=${page}&limit=${PLATFORM_PAGE_SIZE}`,
    );
    if (status !== 200 || !body?.success) {
      throw new Error(`GET ${MISSING_PATH} page ${page} failed (${status}): ${JSON.stringify(body)}`);
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
  if (explicitIds.length > 0) {
    console.log(
      `::notice::ROUTE_IDS is school-mode only and is ignored in platform mode (${explicitIds.length} id(s) given).`,
    );
  }

  console.log('\nListing the routes still missing road geometry (every school)…');
  const before = await listAllMissing();
  if (before.totals) {
    console.log(
      `  routes  : ${before.totals.routes_total} across ${before.schools.length} school(s) — ` +
        `${before.totals.routes_cached} cached, ${before.totals.routes_unlocated} with fewer than two located stops`,
    );
  }
  console.log(`  missing : ${before.routes.length}\n`);

  // One ledger row per school, created from the snapshot (zero-missing schools included).
  const ledger = new Map();
  const rowFor = (schoolId, schoolName) => {
    let row = ledger.get(schoolId);
    if (!row) {
      row = { school_id: schoolId, school_name: schoolName, missing: 0, filled: 0, noRoute: 0, failed: 0, left: 0 };
      ledger.set(schoolId, row);
    }
    return row;
  };
  for (const school of before.schools) {
    const row = rowFor(school.school_id, school.school_name);
    row.missing = school.routes_missing;
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
      );
      row.failed += 1;
      const dropNote =
        dropped.status === 200 ? 'the mismatched row was dropped' : `could not drop it (${dropped.status})`;
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
  const after = await listAllMissing();
  const stillMissing = new Set(after.routes.map((route) => route.route_id));
  for (const { item, row } of written) {
    if (stillMissing.has(item.route_id)) {
      row.failed += 1;
      failures.push(`${item.route_id} (${item.school_name}): stored, but still missing on the re-check`);
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
    .sort((a, b) => a.school_name.localeCompare(b.school_name) || a.school_id.localeCompare(b.school_id));
  const total = rows.reduce(
    (sum, row) => ({
      missing: sum.missing + row.missing,
      filled: sum.filled + row.filled,
      noRoute: sum.noRoute + row.noRoute,
      failed: sum.failed + row.failed,
      left: sum.left + row.left,
    }),
    { missing: 0, filled: 0, noRoute: 0, failed: 0, left: 0 },
  );

  console.log('\nSummary (per school):');
  if (rows.length === 0) {
    console.log('  nothing to fill — every routable route already has a cached geometry.');
  } else {
    const headers = ['school', 'missing', 'filled', 'no road', 'failed', 'left'];
    const body = rows.map((row) => [row.school_name, row.missing, row.filled, row.noRoute, row.failed, row.left]);
    body.push(['TOTAL', total.missing, total.filled, total.noRoute, total.failed, total.left]);
    for (const line of consoleTable(headers, body)) console.log(`  ${line}`);
  }
  console.log('\n  filled   = stored and verified by the re-check (a cache hit on the current stops)');
  console.log('  no road  = the engine has no road for these stops (dashed-line fallback; not a failure)');
  console.log('  failed   = engine, transport or API trouble — re-run the workflow');
  console.log('  left     = still missing after this run (no road + failed + anything the re-check still lists)');
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }

  // GitHub Actions step summary (best effort — local runs just skip it).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## OSRM route-geometry backfill — platform (every school)',
      '',
      `Routes missing at start: **${total.missing}** · filled (verified): **${total.filled}** · no road route: **${total.noRoute}** · failed: **${total.failed}** · left: **${total.left}**`,
      '',
    ];
    if (rows.length > 0) {
      lines.push(
        '| School | Missing | Filled | No road route | Failed | Left |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
      );
      for (const row of rows) {
        lines.push(
          `| ${cell(row.school_name)} | ${row.missing} | ${row.filled} | ${row.noRoute} | ${row.failed} | ${row.left} |`,
        );
      }
      lines.push(
        `| **TOTAL** | **${total.missing}** | **${total.filled}** | **${total.noRoute}** | **${total.failed}** | **${total.left}** |`,
        '',
      );
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

const main = ADMIN_MODE === 'platform' ? runPlatformBackfill : runSchoolBackfill;

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
