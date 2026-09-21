import type { Feature, Polygon } from 'geojson';

/**
 * The GPS accuracy circle as GeoJSON — mirrors mobile/src/features/map/accuracy-circle.ts.
 *
 * MapLibre GL JS has no declarative circle element, so the uncertainty ring is
 * built as a polygon of `steps` destination points around the reported fix.
 * Pure, no map engine import.
 */

const EARTH_RADIUS_METERS = 6_371_000;

export interface CircleCenter {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

function wrapLongitude(degrees: number): number {
  return ((degrees + 540) % 360) - 180;
}

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
