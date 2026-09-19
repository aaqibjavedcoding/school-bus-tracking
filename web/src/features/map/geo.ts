/**
 * Client-side geodesy for the web tracking map.
 *
 * A deliberate mirror of `mobile/src/lib/geo.ts`: the repository keeps its
 * mobile and web client libraries parallel (see `src/lib/format.ts`,
 * `src/lib/errors.ts`, `src/lib/roles.ts`) rather than sharing a runtime
 * package, so the two copies must stay algorithmically identical —
 * `bus-motion.spec.ts` pins the same values on both sides.
 *
 * The server has its own copy in `src/server/modules/eta/geo.util.ts`, used for
 * ETA and stop-arrival maths. Nothing here feeds the server: ETA, distances and
 * arrivals stay server-computed, and this module exists only so the map can
 * derive a bearing and a jitter threshold for *presentation*.
 */

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** Straight-line (Haversine) distance in metres between two WGS-84 points. */
export function haversineMeters(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const latFrom = toRadians(from.latitude);
  const latTo = toRadians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latFrom) * Math.cos(latTo) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Compass bearing (degrees, 0..360) from one point to another. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const latFrom = toRadians(from.latitude);
  const latTo = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(latTo);
  const x =
    Math.cos(latFrom) * Math.sin(latTo) - Math.sin(latFrom) * Math.cos(latTo) * Math.cos(dLon);
  return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
}
