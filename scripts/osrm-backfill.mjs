#!/usr/bin/env node
/**
 * osrm-backfill.mjs — fill the route-geometry forever-cache from a running
 * OSRM engine, through the public API. 100% free and keyless: the engine is
 * the self-hosted BSD-2 OSRM container, the API is ours.
 *
 * For every route of the token's school that has no cached geometry yet
 * (or every route id passed explicitly):
 *
 *   1. GET  /routes/:id/stops                                  (ordered stops)
 *   2. GET  {OSRM}/route/v1/driving/{lng,lat;…}?overview=full&geometries=geojson&steps=true
 *   3. PUT  /routes/:id/geometry                                (engine result)
 *   4. GET  /routes/:id/geometry                                (verify cache hit)
 *
 * The PUT body is the engine's own vocabulary mapped onto the API's
 * (`RouteGeometryStoreRequest`): the server keys the row by the route's
 * CURRENT stop list, so the verification GET is a cache hit by construction.
 *
 * Usage:
 *
 *   OSRM_BASE=http://localhost:5000 \
 *   API_BASE=https://kidbus.onrender.com/api/v1 \
 *   ADMIN_TOKEN=<SCHOOL_ADMIN access token> \
 *   node scripts/osrm-backfill.mjs [routeId …]
 *
 * Environment:
 *   API_BASE     API base URL, e.g. https://host/api/v1. Required.
 *   ADMIN_TOKEN  SCHOOL_ADMIN access token (bearer; CSRF-exempt). Required.
 *   OSRM_BASE    Routing engine base URL. Default http://localhost:5000.
 *   ROUTE_IDS    Comma-separated route ids — alternative to argv. When set
 *                (or argv ids are given) exactly those routes are (re)filled;
 *                otherwise every route of the school missing geometry.
 *
 * Exit code: 0 when every targeted route ended verified (routes the engine
 * cannot route are reported but do not fail the run — that is the documented
 * honest fallback: outside the extract OSRM answers NoRoute and the map
 * draws the dashed stop-to-stop line), 1 on API/transport failures.
 */
import { appendFileSync } from 'node:fs';

const API_BASE = (process.env.API_BASE ?? '').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const OSRM_BASE = (process.env.OSRM_BASE ?? 'http://localhost:5000').replace(/\/+$/, '');

if (!API_BASE) {
  console.error('ERROR: API_BASE is required (e.g. https://host/api/v1).');
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.error('ERROR: ADMIN_TOKEN is required (a SCHOOL_ADMIN access token).');
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

async function main() {
  console.log(`OSRM route-geometry backfill`);
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

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
