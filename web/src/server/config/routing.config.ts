import { registerAs } from '../framework';

/**
 * Road-following route geometry ("follow the road", not flight paths).
 *
 * Routes used to be drawn as straight stop-to-stop lines, so a driver could
 * not tell which road actually leads to the next stop. The road shape comes
 * from a routing engine, under two hard constraints:
 *
 *   1. **No API key, no card, no metered provider.** The engine is a
 *      self-hosted OSRM container loaded with a CITY extract, running on our
 *      own hardware. The public FOSSGIS demo servers are NOT a production
 *      backend: their fair-use policy allows 1 request/second and forbids
 *      heavy use, and depending on someone else's free tier for a safety
 *      feature is an operational incident waiting to happen. To keep that
 *      promise enforceable, any URL carrying a `key=` / `api_key=` credential
 *      — the fingerprint of a metered provider — is rejected here, at load,
 *      so a misconfigured deployment fails loudly at boot instead of silently
 *      falling back to a key-based service. `web/scripts/map-provider-policy.spec.ts`
 *      additionally forbids keyed URLs anywhere in the codebase.
 *
 *   2. **Zero running cost.** A route's shape almost never changes (school
 *      stops are surveyed once per term), so the geometry is computed ONCE
 *      and cached FOREVER in the `route_geometries` table, keyed by a hash of
 *      the ordered stop coordinates. A school with 20 routes makes 20 engine
 *      calls in its lifetime; everything after that is a local database read.
 *
 * The tunables:
 *
 *   ROUTING_SERVICE_URL               Base URL of the routing engine, e.g.
 *                                     `http://osrm:5000` on the internal
 *                                     network. Blank or unset DISABLES road
 *                                     geometry: every endpoint responds
 *                                     `{ status: 'unavailable' }` and no
 *                                     network call is ever made. Must be a
 *                                     plain http(s) URL — any other scheme,
 *                                     and any `key=` / `api_key=` credential
 *                                     in the URL, throws at load.
 *   ROUTING_TIMEOUT_MS                Per-request deadline, covering ONE
 *                                     engine call (default 5000 — a city
 *                                     extract answers a route query in tens
 *                                     of milliseconds; 5 s means the engine
 *                                     is down, not slow).
 *   ROUTING_MAX_REQUESTS_PER_SECOND   Outbound cap toward the engine
 *                                     (default 1). Compute-on-miss is rare
 *                                     (cache-forever, see above), so 1 req/s
 *                                     is generous — and it is exactly the
 *                                     fair-use ceiling of the public demo
 *                                     servers, which keeps even a
 *                                     development box pointed at them polite.
 */
export default registerAs('routing', () => {
  return {
    serviceUrl: routingServiceUrlFromEnv(),
    timeoutMs: intFromEnv('ROUTING_TIMEOUT_MS', 5000, 100),
    maxRequestsPerSecond: numberFromEnv('ROUTING_MAX_REQUESTS_PER_SECOND', 1, 0.001),
  } as const;
});

/**
 * The fingerprint of a key-metered provider: a credential riding in the URL
 * query. Mirrors the pattern `web/scripts/map-provider-policy.spec.ts`
 * scans the codebase for, so "rejected at load" and "rejected at review"
 * agree on what is banned.
 */
const KEY_CREDENTIAL_PATTERN = /[?&](api_)?key=/i;

/**
 * Reads and validates `ROUTING_SERVICE_URL`.
 *
 * Returns the normalized URL (trailing slashes stripped) or `null` when the
 * variable is blank/unset — the disabled state. Anything malformed,
 * non-http(s) or key-carrying is a hard configuration error and throws at
 * load: a routing engine address is deliberated at deploy time, so a bad one
 * must not silently degrade to "geometry unavailable" on a live feature.
 */
export function routingServiceUrlFromEnv(): string | null {
  const raw = process.env['ROUTING_SERVICE_URL'];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const value = raw.trim();

  if (KEY_CREDENTIAL_PATTERN.test(value)) {
    throw new Error(
      'ROUTING_SERVICE_URL must not carry an API key credential (`key=` / `api_key=`): ' +
        'the routing engine is self-hosted and keyless by policy — see the routing.config.ts docblock.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `ROUTING_SERVICE_URL is not a valid URL: ${JSON.stringify(value)} ` +
        '(expected something like http://osrm:5000, or leave it blank to disable road geometry)',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `ROUTING_SERVICE_URL must be an http(s) URL, got protocol ${JSON.stringify(parsed.protocol)} ` +
        '— the geometry engine is an HTTP service.',
    );
  }

  return value.replace(/\/+$/, '');
}

/**
 * Parses a positive finite environment value, falling back to `fallback`
 * when unset, blank or non-numeric; clamped to at least `min` so a typo
 * degrades to the safe default instead of disabling the bound.
 */
function numberFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return Math.max(min, fallback);
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
}

/**
 * Parses an integer environment value, falling back to `fallback` when
 * unset, blank or non-numeric; clamped to at least `min`.
 */
function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return Math.max(min, fallback);
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
}
