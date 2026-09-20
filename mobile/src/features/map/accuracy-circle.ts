import type { Feature, Polygon } from 'geojson';

/**
 * The GPS accuracy circle, as GeoJSON.
 *
 * MapLibre has no declarative "circle" element, so the uncertainty ring the
 * map used to draw is built here as a
 * small polygon: `steps` destination points around the reported fix, joined
 * and closed. 64 vertices over a 500 m radius keeps the max chord error at
 * ~0.03 % of the radius — sub-pixel at every zoom the map can show — while
 * the feature stays one tiny JSON object the style engine can diff cheaply.
 *
 * The circle is centred on the **reported fix** rather than the interpolated
 * marker: the radius belongs to the measurement, so it must not drift with
 * the presentation tween.
 *
 * Pure (no React, no native imports) so `accuracy-circle.spec.ts` can pin the
 * geometry under plain `node --test`.
 */

const EARTH_RADIUS_METERS = 6_371_000;

/** A WGS-84 point, structured like the rest of the app's camera points. */
export interface CircleCenter {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Normalises a longitude into `[-180, 180)`. */
function wrapLongitude(degrees: number): number {
  return ((degrees + 540) % 360) - 180;
}

/**
 * The point reached from `origin` travelling `distanceMeters` on a constant
 * `bearingDeg` (0 = north, clockwise) — the standard spherical
 * destination-point formula.
 *
 * An approximation (spherical earth), which is all a 500 m accuracy ring can
 * usefully be: the error is a fraction of a millimetre at these distances,
 * far below what any map zoom resolves.
 */
export function destinationPoint(
  origin: CircleCenter,
  bearingDeg: number,
  distanceMeters: number,
): CircleCenter {
  const delta = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(origin.latitude);
  const lng1 = toRadians(origin.longitude);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearing);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: toDegrees(lat2),
    longitude: wrapLongitude(toDegrees(lng2)),
  };
}

/**
 * A closed polygon approximating the circle of `radiusMeters` around
 * `center`, as a GeoJSON feature the map's fill + line layers can draw.
 *
 * The ring is explicitly closed (first point repeated at the end), which the
 * GeoJSON spec requires and MapLibre's renderer assumes.
 */
export function accuracyCirclePolygon(
  center: CircleCenter,
  radiusMeters: number,
  steps = 64,
): Feature<Polygon> {
  const safeSteps = Math.max(3, Math.floor(steps));
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= safeSteps; i += 1) {
    const point = destinationPoint(center, (360 / safeSteps) * i, radiusMeters);
    ring.push([point.longitude, point.latitude]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}
