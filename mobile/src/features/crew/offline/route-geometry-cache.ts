import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RouteGeometryLineString } from '@school-bus-tracking/shared-types';
import { unwrapEnvelope } from '../../../lib/errors.ts';
import { apiClient } from '../../../services/api.ts';
import {
  createRoadGeometryLoader,
  normalizeRoadGeometry,
  roadGeometryCacheKey,
} from './route-geometry-core.ts';

/**
 * The storage and network wiring of the road-geometry cache — every decision
 * lives in the pure `route-geometry-core.ts` (see its header for why the
 * geometry is cached at all: one fetch per trip, the copy survives signal
 * loss and app restarts, a failure is never cached).
 *
 * One route's polyline is a few kilobytes of JSON under
 * `@sbt/route-geometry/<routeId>`; nothing but road coordinates is stored —
 * no tokens, no session, nothing the queue's ownership rules would need to
 * scope.
 */

/**
 * The persisted geometry of a route, or `null` when nothing usable is
 * stored (never stored yet, a corrupted row, an older format).
 */
export async function readCachedRoadGeometry(
  routeId: string,
): Promise<RouteGeometryLineString | null> {
  try {
    const raw = await AsyncStorage.getItem(roadGeometryCacheKey(routeId));
    if (!raw) return null;
    return normalizeRoadGeometry(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persists a route's geometry. Best-effort: failures are swallowed. */
async function writeCachedRoadGeometry(
  routeId: string,
  geometry: RouteGeometryLineString,
): Promise<void> {
  try {
    await AsyncStorage.setItem(roadGeometryCacheKey(routeId), JSON.stringify(geometry));
  } catch {
    // A full disk costs the offline copy, never the trip screen.
  }
}

const tripLoader = createRoadGeometryLoader({
  fetchGeometry: (routeId) =>
    apiClient.getRouteGeometry(routeId).then((response) => unwrapEnvelope(response)),
  readCache: readCachedRoadGeometry,
  writeCache: writeCachedRoadGeometry,
});

/**
 * The road geometry of the route the trip on screen drives, loaded **once
 * per trip**.
 *
 * First call fetches `GET /routes/:id/geometry` through the shared mobile
 * api-client and persists the geometry; every later call for the same trip —
 * a remount, the fullscreen map, a next-stop change — answers from memory.
 * When the fetch cannot reach the API (signal lost mid-trip, app restarted
 * offline), the persisted copy answers instead. `null` means "no road line":
 * routing unavailable for this route, or nothing cached — the map's
 * planned-legs line stays the fallback, exactly as before the road line
 * existed.
 */
export function loadTripRoadGeometry(
  tripId: string,
  routeId: string,
): Promise<RouteGeometryLineString | null> {
  return tripLoader.load(tripId, routeId);
}
