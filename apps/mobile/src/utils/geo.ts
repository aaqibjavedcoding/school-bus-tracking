/**
 * Pure geometry for the mobile map canvas.
 *
 * The map is *visualisation only* — ETA, geofence arrivals and trip state come
 * from the backend. Rather than adding a paid map SDK (or a native map module
 * the Expo setup does not ship), the app renders stops / route polyline / bus
 * with `react-native-svg` on a fitted equirectangular canvas. This keeps the
 * map free, deterministic, testable, and working in Expo Go and dev builds
 * alike. OSM remains available later via `expo-secure-store`-free alternatives
 * if the product ever wants raster tiles.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapViewport {
  width: number;
  height: number;
  padding: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

/** Cosine correction so longitude distance matches latitude distance locally. */
function projectionX(point: LatLng): number {
  return point.longitude * Math.cos((point.latitude * Math.PI) / 180);
}

function projectionY(point: LatLng): number {
  return point.latitude;
}

/**
 * Fit `points` into the viewport; returns a `project` function plus the
 * applied span. Degenerate cases (0 or 1 point, identical coordinates) are
 * handled by centring at a default zoom instead of dividing by zero.
 */
export function fitViewport(
  points: LatLng[],
  viewport: MapViewport,
): {
  project: (point: LatLng) => ProjectedPoint;
  spanLat: number;
  spanLng: number;
} {
  const { width, height, padding } = viewport;
  const innerWidth = Math.max(width - padding * 2, 10);
  const innerHeight = Math.max(height - padding * 2, 10);

  if (points.length === 0) {
    return {
      project: () => ({ x: width / 2, y: height / 2 }),
      spanLat: 0,
      spanLng: 0,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    const x = projectionX(p);
    const y = projectionY(p);
    minLat = Math.min(minLat, y);
    maxLat = Math.max(maxLat, y);
    minLng = Math.min(minLng, x);
    maxLng = Math.max(maxLng, x);
  }

  let spanY = maxLat - minLat;
  let spanX = maxLng - minLng;

  // Single point / flat route → pad around the point at a usable zoom.
  if (spanX < 1e-9 && spanY < 1e-9) {
    spanX = 0.01;
    spanY = 0.01;
  } else {
    spanX = Math.max(spanX, 1e-6);
    spanY = Math.max(spanY, 1e-6);
  }

  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);
  const centreLng = (minLng + maxLng) / 2;
  const centreLat = (minLat + maxLat) / 2;

  return {
    project: (point: LatLng): ProjectedPoint => ({
      x: width / 2 + (projectionX(point) - centreLng) * scale,
      y: height / 2 - (projectionY(point) - centreLat) * scale,
    }),
    spanLat: spanY,
    spanLng: spanX,
  };
}

/** Rotate the bus marker so the icon points along `heading` (degrees). */
export function rotationForHeading(heading: number | null | undefined): number {
  if (heading === null || heading === undefined || !Number.isFinite(heading) || heading < 0) {
    return 0;
  }
  return heading % 360;
}

export function polylinePath(points: ProjectedPoint[]): string {
  if (points.length === 0) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}
