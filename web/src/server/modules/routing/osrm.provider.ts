import { parseOsrmRouteResponse, type RoadRoute } from './osrm-response';

/**
 * HTTP client for the self-hosted OSRM routing engine.
 *
 * One call shape only — the Route service with the full polyline and
 * turn-by-turn steps:
 *
 *   {base}/route/v1/driving/{lng,lat;lng,lat;…}?overview=full&geometries=geojson&steps=true
 *
 * Behavioural contract (each point has a dedicated spec):
 *
 *  - **Never throws.** Every failure — DNS, connection refused, timeout,
 *    HTTP 500, a `NoRoute` outcome, an unparseable body — returns `null`.
 *    The service layer turns that into `{ status: 'unavailable' }` and never
 *    caches it, so a transient outage can never poison the forever-cache.
 *  - **AbortController deadline** per attempt (`ROUTING_TIMEOUT_MS`, default
 *    5 s): a city extract answers in milliseconds; a hanging engine is down,
 *    not slow, and the request must die rather than hold a worker slot.
 *  - **Exactly ONE retry** (two attempts in total). One blip must not cost a
 *    school its geometry, but retrying forever turns an engine outage into a
 *    self-inflicted thundering herd.
 *  - **Per-second throttle** (`ROUTING_MAX_REQUESTS_PER_SECOND`, default 1):
 *    outbound requests are serialized and spaced at the configured ceiling —
 *    retries included — so even a burst of first-time route loads can never
 *    hammer the engine. 1 req/s also matches the public demo servers'
 *    fair-use ceiling, keeping a development checkout polite.
 *  - **Descriptive User-Agent**: who we are and what this traffic is, so the
 *    engine's logs are self-explanatory.
 */

/** Fetch seam — production uses global fetch, specs inject a fake. */
export type RoutingFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OsrmRoutingProviderOptions {
  /** Engine base URL, trailing slash already stripped by the config layer. */
  baseUrl: string;
  /** Per-attempt deadline in milliseconds. */
  timeoutMs?: number;
  /** Outbound request ceiling; attempts (incl. the retry) are spaced to it. */
  maxRequestsPerSecond?: number;
  /** Injected HTTP transport (tests). Defaults to the global `fetch`. */
  fetchFn?: RoutingFetch;
  /** Injected clock/sleep (tests); production uses wall time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides the User-Agent, e.g. to carry a deployment contact. */
  userAgent?: string;
}

export const DEFAULT_ROUTING_TIMEOUT_MS = 5000;
export const DEFAULT_ROUTING_MAX_RPS = 1;

/** Total attempts for one compute: the first try plus exactly one retry. */
export const OSRM_MAX_ATTEMPTS = 2;

/** Provider label persisted on `route_geometries.provider`. */
export const OSRM_PROVIDER_NAME = 'osrm';

export const OSRM_DEFAULT_USER_AGENT =
  'school-bus-tracking/1.0 (road route-geometry cache; self-hosted OSRM engine)';

/** One WGS-84 stop position, `[longitude, latitude]`. */
export type RouteCoordinate = readonly [longitude: number, latitude: number];

export class OsrmRoutingProvider {
  readonly name = OSRM_PROVIDER_NAME;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly fetchFn: RoutingFetch;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly userAgent: string;

  /** Serializes throttle acquisition; a failed acquire must never poison it. */
  private throttleChain: Promise<unknown> = Promise.resolve();
  private lastRequestStartedAt = Number.NEGATIVE_INFINITY;

  constructor(options: OsrmRoutingProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS;
    const rps = options.maxRequestsPerSecond ?? DEFAULT_ROUTING_MAX_RPS;
    // A zero/negative cap would mean "never request" or division blowups;
    // the config clamps too, but a hand-constructed provider stays safe.
    this.minIntervalMs = 1000 / Math.max(rps, 0.001);
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.nowFn = options.now ?? (() => Date.now());
    this.sleepFn = options.sleep ?? defaultSleep;
    this.userAgent = options.userAgent ?? OSRM_DEFAULT_USER_AGENT;
  }

  /**
   * Computes the road route through the given stops, in order.
   *
   * @returns the parsed route, or `null` on ANY failure. Never throws.
   */
  async computeRoute(coordinates: readonly RouteCoordinate[]): Promise<RoadRoute | null> {
    if (coordinates.length < 2) {
      return null;
    }
    const url = this.buildUrl(coordinates);
    // Exactly ONE retry: attempt, and one more attempt on failure.
    for (let attempt = 0; attempt < OSRM_MAX_ATTEMPTS; attempt += 1) {
      const route = await this.tryOnce(url);
      if (route !== null) {
        return route;
      }
    }
    return null;
  }

  /** The single OSRM Route-service URL this client issues. */
  buildUrl(coordinates: readonly RouteCoordinate[]): string {
    const path = coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';');
    return `${this.baseUrl}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=true`;
  }

  /** One attempt: throttle slot, deadline, fetch, parse. Null on any failure. */
  private async tryOnce(url: string): Promise<RoadRoute | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.acquireThrottleSlot();
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          'user-agent': this.userAgent,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      return parseOsrmRouteResponse(await response.json());
    } catch {
      // Network errors, aborts and JSON parse failures all land here:
      // "could not compute" is one outcome — null — however it happened.
      return null;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Waits until the per-second ceiling permits one more request.
   *
   * Acquisition is serialized through {@link throttleChain} so concurrent
   * computes queue up instead of racing the clock, and a rejected acquire is
   * swallowed by the chain so the next caller is not punished for it. The
   * method deliberately returns the slot promise directly rather than being
   * `async`: an extra microtask hop here would let later queue links run
   * before earlier callers' continuations, reordering starts.
   */
  private acquireThrottleSlot(): Promise<void> {
    const acquired = this.throttleChain.then(async () => {
      const waitMs = this.lastRequestStartedAt + this.minIntervalMs - this.nowFn();
      if (waitMs > 0) {
        await this.sleepFn(waitMs);
      }
      this.lastRequestStartedAt = this.nowFn();
    });
    this.throttleChain = acquired.catch(() => undefined);
    return acquired;
  }
}

/** The production transport. */
const defaultFetch: RoutingFetch = (url, init) =>
  fetch(url, init as RequestInit) as unknown as ReturnType<RoutingFetch>;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
