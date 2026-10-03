import { createHash } from 'node:crypto';

/**
 * The cache key behind "compute once, cache forever".
 *
 * A cached route geometry is valid for exactly one ordered list of located
 * stops: reorder the stops, survey a new one, nudge a pin — and the old
 * polyline is wrong. Rather than comparing stop lists by hand at read time,
 * we fold the whole list into one sha256 and store it beside the geometry:
 *
 *   - same stops, same order, same coordinates → same hash → cache hit;
 *   - ANY change (order, membership, 7th-decimal coordinate drift) → a new
 *     hash → one more engine call, then cached forever under the new key.
 *
 * Coordinates are rounded to 6 decimals (~0.1 m at the equator) before
 * hashing. Phone GPS is never more precise than that, so jitter below the
 * 6th decimal cannot bust the cache; an intentional stop move always can.
 *
 * The order of the tuples is NOT normalized away: on a route, stop order is
 * the difference between driving 4 km and driving 40.
 */

/** One stop's contribution to the hash: identity plus surveyed position. */
export interface StopHashTuple {
  stopId: string;
  latitude: number;
  longitude: number;
}

/** Hex digest length of a sha256 — the width of the `stops_hash` column. */
export const STOPS_HASH_LENGTH = 64;

/**
 * Stable sha256 of the ordered (stop_id, lat, lng) tuples.
 *
 * Serialization is deliberately trivial — one tuple per line,
 * `stopId,lat,lng` with the coordinates rendered by {@link renderCoordinate}
 * — because the algorithm must be reproducible by inspection: a row in
 * `route_geometries` can be verified with `sha256sum` and nothing else.
 * Empty input hashes the empty string (callers guard `< 2` located stops
 * before ever reaching here, so that value stays well-defined and useless).
 */
export function hashRouteStops(stops: readonly StopHashTuple[]): string {
  const canonical = stops
    .map(
      (stop) =>
        `${stop.stopId},${renderCoordinate(stop.latitude)},${renderCoordinate(stop.longitude)}`,
    )
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Renders one coordinate at exactly 6 decimals.
 *
 * `toFixed(6)` is float-nearest rendering; the explicit `-0` normalization
 * keeps `-0.0000001` and `0.0000001` on the same side of the hash — they are
 * the same point for any driver, and the cache must not tell them apart.
 */
export function renderCoordinate(value: number): string {
  const fixed = value.toFixed(6);
  // "-0.000000" and "0.000000" describe the same point on the ground.
  return fixed === '-0.000000' ? '0.000000' : fixed;
}
