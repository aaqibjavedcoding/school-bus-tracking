import type { RouteGeometryLineString } from '@school-bus-tracking/shared-types';
import { isValidCoordinate } from '../../../lib/navigation.ts';

/**
 * Road-route geometry for the driver map — the pure half of the offline
 * cache (`route-geometry-cache.ts` persists it).
 *
 * ### Why a cache at all
 *
 * The routing engine computes a route's road polyline **once** and the server
 * caches it forever (`route_geometries`; the cache key is a hash of the
 * ordered stop coordinates, so a stop change computes a new row). The shape
 * of a route does not change while a bus is driving it — which makes the
 * geometry exactly the kind of payload a driver who loses signal mid-trip
 * must not lose: one fetch per trip, then a local copy answers every later
 * need, in memory for the process and in AsyncStorage across restarts.
 *
 * ### What is deliberately NOT here
 *
 * No AsyncStorage, no `apiClient`, no React — the same split as
 * `queue-core.ts`/`attendance-queue.ts`: every decision (is this payload a
 * usable geometry? what does one trip's load resolve to?) lives in this
 * file, pinned by `route-geometry-core.spec.ts` under plain `node --test`,
 * and the native/storage wiring stays a thin shell.
 */

/** AsyncStorage key prefix — one geometry per route id. */
export const ROAD_GEOMETRY_CACHE_KEY_PREFIX = '@sbt/route-geometry/';

/** The AsyncStorage key a route's geometry is persisted under. */
export function roadGeometryCacheKey(routeId: string): string {
  return `${ROAD_GEOMETRY_CACHE_KEY_PREFIX}${encodeURIComponent(routeId)}`;
}

/**
 * An untrusted value as a usable road geometry, or `null`.
 *
 * The API payload and the AsyncStorage blob are the same shape, and neither
 * is trusted: a mangled cache row (partial JSON write, an older app's
 * format) must degrade to "no geometry" — the planned-legs fallback — never
 * to a crash or a half-drawn line. Coordinates that fail `isValidCoordinate`
 * are dropped; fewer than two survivors are not a line.
 */
export function normalizeRoadGeometry(raw: unknown): RouteGeometryLineString | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'LineString' || !Array.isArray(candidate.coordinates)) return null;
  const coordinates: Array<[number, number]> = [];
  for (const entry of candidate.coordinates) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [longitude, latitude] = entry;
    if (typeof longitude !== 'number' || typeof latitude !== 'number') continue;
    if (!isValidCoordinate(latitude, longitude)) continue;
    coordinates.push([longitude, latitude]);
  }
  if (coordinates.length < 2) return null;
  return { type: 'LineString', coordinates };
}

/**
 * The `GET /routes/:id/geometry` payload as a usable geometry, or `null`.
 *
 * `status: 'unavailable'` (routing disabled, too few surveyed stops, engine
 * failure) is **not** an error and never yields a geometry — and, like the
 * server's own cache, a failure is not cached client-side either: the next
 * trip's load tries the network again.
 */
export function roadGeometryFromResponse(payload: unknown): RouteGeometryLineString | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { status?: unknown; geometry?: unknown };
  if (candidate.status !== 'ok') return null;
  return normalizeRoadGeometry(candidate.geometry);
}

/** The ports `createRoadGeometryLoader` needs — injectable for the spec. */
export interface RoadGeometryLoaderDeps {
  /**
   * Resolves the geometry payload of a route (already unwrapped from the
   * response envelope), or rejects when it could not be fetched — offline,
   * unreachable, auth — which is exactly when the cache takes over.
   */
  fetchGeometry: (routeId: string) => Promise<unknown>;
  /** The persisted geometry of a route, or `null` when none is stored. */
  readCache: (routeId: string) => Promise<RouteGeometryLineString | null>;
  /** Persists a geometry. Best-effort: a rejection must never lose the load. */
  writeCache: (routeId: string, geometry: RouteGeometryLineString) => Promise<void>;
}

export interface RoadGeometryLoader {
  /**
   * The road geometry for the trip on screen, or `null` (planned-legs
   * fallback). One network fetch per trip; concurrent callers share it.
   */
  load: (tripId: string, routeId: string) => Promise<RouteGeometryLineString | null>;
}

/**
 * The once-per-trip geometry loader.
 *
 * - **One fetch per trip.** A resolved answer (a geometry, or `unavailable`)
 *   is remembered for the rest of the trip: the map card remounts on
 *   fullscreen and the next-stop id moves every few minutes, and neither may
 *   turn into a refetch — the shape of the route is not changing under the
 *   bus. The next trip refetches, so a stop moved between runs is picked up.
 * - **A failed fetch is not an answer.** Offline (or any rejection) falls
 *   back to the persisted copy — the driver who loses signal mid-trip keeps
 *   the line — and is *not* memoized, so the next load tries the network
 *   again, mirroring the server's "a failure is never cached" rule.
 */
export function createRoadGeometryLoader(deps: RoadGeometryLoaderDeps): RoadGeometryLoader {
  /** Answers already settled for this process, by trip. */
  const resolved = new Map<string, RouteGeometryLineString | null>();
  /** The fetch in flight for a trip, so concurrent loads share one request. */
  const inflight = new Map<string, Promise<RouteGeometryLineString | null>>();

  const loadOnce = async (
    tripId: string,
    routeId: string,
  ): Promise<RouteGeometryLineString | null> => {
    try {
      const geometry = roadGeometryFromResponse(await deps.fetchGeometry(routeId));
      if (geometry) {
        // Persist for the offline case BEFORE settling: the in-memory answer
        // covers this process, the stored one covers an app restart mid-trip.
        // Best-effort — a full disk must cost the cache, not the map line.
        await deps.writeCache(routeId, geometry).catch(() => undefined);
      }
      resolved.set(tripId, geometry);
      return geometry;
    } catch {
      // Offline / unreachable: the persisted copy keeps the line on screen.
      // Deliberately not memoized — see the header.
      return deps.readCache(routeId);
    }
  };

  return {
    load(tripId: string, routeId: string): Promise<RouteGeometryLineString | null> {
      if (resolved.has(tripId)) {
        return Promise.resolve(resolved.get(tripId) ?? null);
      }
      const running = inflight.get(tripId);
      if (running) return running;
      const attempt = loadOnce(tripId, routeId).finally(() => {
        inflight.delete(tripId);
      });
      inflight.set(tripId, attempt);
      return attempt;
    },
  };
}
