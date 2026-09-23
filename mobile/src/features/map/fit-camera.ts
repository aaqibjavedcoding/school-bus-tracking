/**
 * Fit-camera math shared by every mobile map surface (crew driver map and the
 * school-side bus map), pure and pinned by `fit-camera.spec.ts`.
 *
 * ### The one rule this module exists for
 *
 * A route spans several kilometres, so the zoom at which one bounds box
 * contains every stop lands around z9–z11 — the zoom at which a street map has
 * no reason to draw road, area or place names. The tracking screen must read
 * like a normal map, so a fit is **floored at `MAP_MIN_FIT_ZOOM` (13)**, the
 * same floor the web map (`web/src/features/map/MapViewInner.tsx` →
 * `MIN_FIT_ZOOM`) enforces. Stops cluster closer together than the floor and
 * the user zooms out freely — the floor applies to *automatic* framing only
 * (initial camera and "fit to data"), never as a `minZoom` clamp on the map.
 *
 * The zoom is the same latitude-span proxy `useFollowCamera` uses for its
 * zoom-delta fallback (`span = 360 / 2^zoom`, monotonic in zoom), with a 1.4×
 * padding factor matching the historical region fit. Before this module the
 * formula was duplicated in `BusMap` and `DriverTripMap` — with no floor.
 */

export interface LatLngPoint {
  latitude: number;
  longitude: number;
}

/** A camera framing decision: centre in `[lng, lat]` order plus the zoom. */
export interface CameraFrame {
  center: [number, number];
  zoom: number;
}

/**
 * The lowest zoom an automatic fit may settle at.
 *
 * Parity with the web map's `MIN_FIT_ZOOM` — see the module header.
 */
export const MAP_MIN_FIT_ZOOM = 13;

/** Zoom used when there is exactly one point to frame. */
export const SINGLE_POINT_ZOOM = 15;

/** Padding factor over the raw latitude span (1.4×, the historical region fit). */
const FIT_SPAN_PADDING = 1.4;

/** Latitude bounds of a point set (span is what sets the zoom). */
export interface LatSpan {
  north: number;
  south: number;
}

/**
 * The zoom at which the world's latitude span matches the fitted span —
 * floored at `MAP_MIN_FIT_ZOOM` so a whole route never lands in the
 * "unlabeled outline" zooms.
 */
export function fitZoomForBounds(span: LatSpan): number {
  const padded = Math.max(0.01, (span.north - span.south) * FIT_SPAN_PADDING);
  return Math.max(MAP_MIN_FIT_ZOOM, Math.log2(360 / padded));
}

/**
 * Frames a point set for the camera (`Camera`'s `initialViewState`, a fit
 * command): one point → `SINGLE_POINT_ZOOM`; more → the bounds centre and the
 * floored fit zoom. `null` only when there is nothing to frame.
 */
export function initialCameraFor(points: readonly LatLngPoint[]): CameraFrame | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return { center: [points[0].longitude, points[0].latitude], zoom: SINGLE_POINT_ZOOM };
  }
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const point of points) {
    north = Math.max(north, point.latitude);
    south = Math.min(south, point.latitude);
    east = Math.max(east, point.longitude);
    west = Math.min(west, point.longitude);
  }
  return {
    center: [(west + east) / 2, (south + north) / 2],
    zoom: fitZoomForBounds({ north, south }),
  };
}
