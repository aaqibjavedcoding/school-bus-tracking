/**
 * Pure geodesy helpers for the Task 22 ETA / geofence pipeline.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested exhaustively without a database. Distances are Haversine
 * great-circle distances (straight-line over the Earth's surface) — the
 * feature deliberately does **not** claim road-routing accuracy and never
 * calls an external routing service.
 */

/** Mean Earth radius in metres (WGS-84). */
export const EARTH_RADIUS_METERS = 6_371_000;

/** Degrees → radians. */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine great-circle distance between two WGS-84 points, in metres.
 * Returns `null` when either point is missing a coordinate — the caller
 * must not invent a position.
 */
export function haversineMeters(
  latitude1: number | null | undefined,
  longitude1: number | null | undefined,
  latitude2: number | null | undefined,
  longitude2: number | null | undefined,
): number | null {
  if (
    typeof latitude1 !== 'number' ||
    typeof longitude1 !== 'number' ||
    typeof latitude2 !== 'number' ||
    typeof longitude2 !== 'number' ||
    !Number.isFinite(latitude1) ||
    !Number.isFinite(longitude1) ||
    !Number.isFinite(latitude2) ||
    !Number.isFinite(longitude2)
  ) {
    return null;
  }

  const phi1 = toRadians(latitude1);
  const phi2 = toRadians(latitude2);
  const deltaPhi = toRadians(latitude2 - latitude1);
  const deltaLambda = toRadians(longitude2 - longitude1);

  const sinHalfPhi = Math.sin(deltaPhi / 2);
  const sinHalfLambda = Math.sin(deltaLambda / 2);
  const a =
    sinHalfPhi * sinHalfPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A device speed is usable only when it is a finite, strictly positive number. */
export function sanitizeSpeedKmh(speedKmh: number | null | undefined): number | null {
  return typeof speedKmh === 'number' && Number.isFinite(speedKmh) && speedKmh > 0
    ? speedKmh
    : null;
}

/**
 * The speed used for the ETA: the device speed when it is usable, otherwise
 * the configured fallback. The result is clamped to the configured
 * operational band so a bogus device reading can never produce an absurd
 * (or negative) ETA.
 */
export function effectiveSpeedKmh(
  gpsSpeedKmh: number | null | undefined,
  config: { fallbackSpeedKmh: number; minSpeedKmh: number; maxSpeedKmh: number },
): number {
  const source = sanitizeSpeedKmh(gpsSpeedKmh);
  const speed = source ?? config.fallbackSpeedKmh;
  return Math.min(Math.max(speed, config.minSpeedKmh), config.maxSpeedKmh);
}

/** Whole minutes needed to cover a distance at a speed, rounded up (0 when at the stop). */
export function etaMinutesForDistance(distanceMeters: number, speedKmh: number): number {
  if (speedKmh <= 0 || distanceMeters <= 0) {
    return 0;
  }
  const metresPerMinute = (speedKmh * 1000) / 60;
  return Math.ceil(distanceMeters / metresPerMinute);
}

/**
 * Cumulative straight-line distance from a starting point along an ordered
 * polyline of stops: item `i` is
 * `distance(start → stop₀) + Σ distance(stopₖ → stopₖ₊₁)` for `k < i`.
 * A stop without coordinates yields `null` (its distance is unknown, not
 * invented); the path then continues from the last known point.
 */
export function cumulativeStopDistancesMeters(
  start: { latitude: number; longitude: number },
  stops: Array<{ latitude: number | null; longitude: number | null }>,
): Array<number | null> {
  const result: Array<number | null> = [];
  let accumulated = 0;
  let previous: { latitude: number; longitude: number } | null = start;

  for (const stop of stops) {
    if (previous === null || stop.latitude == null || stop.longitude == null) {
      result.push(null);
      continue;
    }
    const leg = haversineMeters(
      previous.latitude,
      previous.longitude,
      stop.latitude,
      stop.longitude,
    );
    if (leg === null) {
      result.push(null);
      previous = null;
      continue;
    }
    accumulated += leg;
    result.push(accumulated);
    previous = { latitude: stop.latitude, longitude: stop.longitude };
  }

  return result;
}
