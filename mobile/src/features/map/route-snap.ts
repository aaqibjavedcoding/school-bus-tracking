import { bearingDegrees, haversineMeters } from '../../lib/geo.ts';
import { isValidCoordinate } from './bus-motion.ts';

/**
 * Snap-to-route for **display only** (deep-fix R4): project an accepted GPS
 * fix onto the drawn route polyline.
 *
 * ### The field defect
 *
 * Consumer GPS wanders laterally by a few metres between fixes even on a
 * straight road. The jitter gate (`bus-motion.ts`) holds stillness honestly,
 * but once a fix clears the gate the tween used to reproduce the wander
 * faithfully — so the bus visibly zig-zagged across the road line it was
 * actually following. The map already draws the route the bus belongs to
 * (the stop-to-stop polyline), so the honest smoothing available to us is:
 * damp the sideways noise; keep the along-road motion.
 *
 * ### The geometry
 *
 * Nearest-segment projection on the sphere, per segment: cross-track and
 * along-track distance from the segment's start (the standard great-circle
 * sailing formulae), clamped to the segment's ends, projected point placed by
 * the destination-from-start formula at the winning along-track fraction.
 * Meter-scale linearisation would do, but the spherical math is exact at
 * every latitude the service can ever see and costs the same few operations.
 *
 * ### The honesty rules — this module's reason to exist
 *
 * 1. **Presentation only.** The projected coordinate goes to the marker's
 *    rendered position, nowhere else. It is never written into tracking
 *    history, ETA, arrivals, attendance or notifications — those keep
 *    consuming the raw fix (`RenderedBusPosition.source`), exactly as with
 *    interpolation (see `bus-motion.ts` and `docs/live-tracking-map.md`).
 * 2. **Bounded by `SNAP_TO_ROUTE_MAX_OFFSET_M`.** A fix farther than that
 *    from the route is not snapped at all — the bus may genuinely be off the
 *    planned legs (depot, detour, wrong-route data), and gluing it to the
 *    line would be a bigger lie than the jitter was.
 * 3. **The target is the drawn line, not a claim about roads.** The polyline
 *    connects the stops in planned order; the map already labels it "planned
 *    stop order — not the road route" (`map.routeNotice` /
 *    `map.plannedNotice`). Snapping the marker to it does not turn it into a
 *    road route; it only stops the marker wandering *off what the screen
 *    already shows*.
 *
 * Pure — no React, no native imports, no clock — so every branch is pinned
 * under plain `node --test` (`route-snap.spec.ts`).
 */

export interface RouteSnapPoint {
  latitude: number;
  longitude: number;
}

/**
 * The maximum lateral distance a fix may sit from the route and still be
 * projected onto it (honesty rule 2 in the module header). 60 m covers a
 * wide multi-lane road plus a coarse-fix radius; past it the bus is simply
 * somewhere else, and the map must say so rather than invent a position.
 */
export const SNAP_TO_ROUTE_MAX_OFFSET_M = 60;

/** Where a fix landed on the route: the point, and how far off it sat. */
export interface RouteProjection {
  /** The point on the polyline nearest to the input. */
  point: RouteSnapPoint;
  /** How far the input stood off the line, in metres (cross-track). */
  distanceMeters: number;
  /** Index of the winning segment (0-based, into `route`). */
  segmentIndex: number;
  /** Position along the winning segment: 0 = its start, 1 = its end. */
  segmentFraction: number;
}

/** Mean earth radius, metres — consistent with `haversineMeters`. */
const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The point at `fraction` of the great-circle segment A → B (the spherical
 * destination-from-start formula). Fraction must already be clamped to the
 * segment: this module never extrapolates past the stops.
 */
function pointAlongSegment(
  from: RouteSnapPoint,
  bearingRad: number,
  angularDistance: number,
): RouteSnapPoint {
  const lat1 = toRadians(from.latitude);
  const lng1 = toRadians(from.longitude);
  const lat = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );
  const lng =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat),
    );
  return { latitude: (lat * 180) / Math.PI, longitude: (lng * 180) / Math.PI };
}

/**
 * Projects one point onto the route polyline.
 *
 * Returns the nearest on-line point with its off-line distance, or `null`
 * when there is nothing honest to project with: fewer than two usable route
 * points, an invalid input, or the nearest line point is farther away than
 * `maxOffsetMeters` (the bus is off the route — draw the raw fix instead).
 */
export function projectOntoRoute(
  point: RouteSnapPoint,
  route: readonly RouteSnapPoint[],
  maxOffsetMeters: number = SNAP_TO_ROUTE_MAX_OFFSET_M,
): RouteProjection | null {
  if (!isValidCoordinate(point.latitude, point.longitude)) return null;
  if (route.length < 2) return null;

  let best: RouteProjection | null = null;

  for (let index = 0; index < route.length - 1; index += 1) {
    const a = route[index];
    const b = route[index + 1];
    if (!isValidCoordinate(a.latitude, a.longitude)) continue;
    if (!isValidCoordinate(b.latitude, b.longitude)) continue;

    const segmentLengthM = haversineMeters(a, b);
    // A duplicated stop makes a zero-length segment: the only candidate is
    // the point itself.
    if (!(segmentLengthM > 0)) {
      const distanceMeters = haversineMeters(a, point);
      if (Number.isFinite(distanceMeters)) {
        const candidate: RouteProjection = {
          point: { latitude: a.latitude, longitude: a.longitude },
          distanceMeters,
          segmentIndex: index,
          segmentFraction: 0,
        };
        if (best === null || candidate.distanceMeters < best.distanceMeters) best = candidate;
      }
      continue;
    }

    const bearingRad = toRadians(bearingDegrees(a, b));
    const angularLength = segmentLengthM / EARTH_RADIUS_M;

    // Great-circle cross-track / along-track from the segment start.
    const angularFromStart = haversineMeters(a, point) / EARTH_RADIUS_M;
    const bearingFromStart = toRadians(bearingDegrees(a, point));
    const crossTrackRad = Math.asin(
      Math.min(1, Math.max(-1, Math.sin(angularFromStart) * Math.sin(bearingFromStart - bearingRad))),
    );
    const crossTrackM = crossTrackRad * EARTH_RADIUS_M;
    // Clamp against floating-point overshoot before acos.
    const alongTrackRad = Math.acos(
      Math.min(
        1,
        Math.max(-1, Math.cos(angularFromStart) / Math.max(1e-12, Math.cos(crossTrackRad))),
      ),
    );
    const alongTrackM = alongTrackRad * EARTH_RADIUS_M;

    // `acos` loses the sign: the perpendicular foot 40 m ahead of A and 40 m
    // behind A produce the same along-track distance. The foot is ahead iff
    // the bearing difference is acute; an obtuse difference means the point
    // sits BEHIND the segment start and must clamp to the endpoint instead.
    const footAheadOfStart = Math.cos(bearingFromStart - bearingRad) >= 0;

    let candidate: RouteProjection;
    if (footAheadOfStart && alongTrackM >= 0 && alongTrackM <= segmentLengthM) {
      // The perpendicular foot lands inside the segment: project onto it.
      const fraction = alongTrackM / segmentLengthM;
      candidate = {
        point: pointAlongSegment(a, bearingRad, fraction * angularLength),
        distanceMeters: Math.abs(crossTrackM),
        segmentIndex: index,
        segmentFraction: fraction,
      };
    } else {
      // Off the end: clamp to the nearer endpoint (never extrapolate).
      const aDistance = haversineMeters(a, point);
      const bDistance = haversineMeters(b, point);
      const atStart = aDistance <= bDistance;
      candidate = {
        point: atStart
          ? { latitude: a.latitude, longitude: a.longitude }
          : { latitude: b.latitude, longitude: b.longitude },
        distanceMeters: Math.min(aDistance, bDistance),
        segmentIndex: index,
        segmentFraction: atStart ? 0 : 1,
      };
    }

    if (
      Number.isFinite(candidate.point.latitude) &&
      Number.isFinite(candidate.point.longitude) &&
      (best === null || candidate.distanceMeters < best.distanceMeters)
    ) {
      best = candidate;
    }
  }

  if (best === null) return null;
  if (best.distanceMeters > maxOffsetMeters) return null;
  return best;
}

/**
 * Builds the snap-to-route port the motion machine consumes (structurally the
 * `SnapToRoutePort` from `bus-motion.ts` — defined there so this module and
 * the machine never import each other in a cycle): fix in, display position
 * out — or `null`, meaning "leave the raw fix alone" (off-route, no usable
 * route yet, nothing honest to say).
 *
 * The route is captured once per stops list; the function itself is pure.
 */
export function createRouteSnapper(
  route: readonly RouteSnapPoint[],
  maxOffsetMeters: number = SNAP_TO_ROUTE_MAX_OFFSET_M,
): (point: RouteSnapPoint) => RouteSnapPoint | null {
  return (point) => {
    const projection = projectOntoRoute(point, route, maxOffsetMeters);
    return projection === null ? null : projection.point;
  };
}
