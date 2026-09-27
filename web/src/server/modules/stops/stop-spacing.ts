import { haversineMeters } from '../eta/geo.util';

/**
 * A geofenced stop needs enough separation from every other active geofenced
 * stop on its route that a bus cannot sit inside both arrival circles. The
 * required separation is twice the larger radius, intentionally giving an
 * extra buffer when the two geofence sizes differ.
 */
export const STOP_MINIMUM_SPACING_RADIUS_MULTIPLIER = 2;

/** The subset of a stop needed by the spacing rule. */
export interface StopSpacingStop {
  id: string;
  route_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
  is_active: boolean;
}

/** Inputs owned by the stop being created, moved, or imported. */
export interface StopSpacingCheck {
  routeId: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  radiusMeters: number;
  /** Excludes the same row while an existing stop is being updated. */
  excludeStopId?: string | null;
}

/** Details of the first active stop that makes a candidate unsafe. */
export interface StopSpacingConflict {
  stopName: string;
  distanceMeters: number;
  minimumDistanceMeters: number;
}

/**
 * Finds an active same-route stop whose geofence would overlap or nearly
 * overlap the candidate's geofence.
 *
 * Rows without a complete coordinate pair are deliberately ignored: there is
 * no honest spatial comparison to make. Equality is allowed; the tiny epsilon
 * only protects the exact-boundary rule from floating-point noise in the
 * Haversine calculation.
 */
export function findStopSpacingConflict(
  check: StopSpacingCheck,
  stops: readonly StopSpacingStop[],
): StopSpacingConflict | null {
  if (check.latitude == null || check.longitude == null) {
    return null;
  }

  for (const stop of stops) {
    if (
      !stop.is_active ||
      stop.route_id !== check.routeId ||
      stop.id === check.excludeStopId ||
      stop.latitude == null ||
      stop.longitude == null
    ) {
      continue;
    }

    const distanceMeters = haversineMeters(
      check.latitude,
      check.longitude,
      stop.latitude,
      stop.longitude,
    );
    // The null branch is unreachable after the coordinate guards above, but
    // retain it so this helper stays correct if its input shape evolves.
    if (distanceMeters === null) {
      continue;
    }
    const minimumDistanceMeters =
      STOP_MINIMUM_SPACING_RADIUS_MULTIPLIER *
      Math.max(check.radiusMeters, stop.geofence_radius_meters);

    if (distanceMeters + 1e-6 < minimumDistanceMeters) {
      return { stopName: stop.name, distanceMeters, minimumDistanceMeters };
    }
  }

  return null;
}
