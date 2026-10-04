import type { Feature, FeatureCollection, Polygon } from 'geojson';
import {
  buildingExtrusionLayerForStyle,
  type MapDimension,
} from '@school-bus-tracking/map-assets';

/**
 * The live bus as REAL 3D geometry — MapLibre `fill-extrusion`, no new deps.
 *
 * ### Why this module exists
 *
 * In the pitched ("3D") camera the bus used to be the same zero-size DOM
 * marker the flat map uses: a top-down SVG in an HTML element that MapLibre
 * positions with a 2D CSS transform and keeps `pitchAlignment: 'auto'`
 * (= viewport) aligned. A viewport-aligned element in a pitched scene is a
 * billboard — it stands up facing the camera instead of lying on the road —
 * which is exactly the "flat sticker floating over the map" the 3D view was
 * reported as. MapLibre also drives that element's `style.opacity` itself
 * (`Marker._updateOpacity`, default `opacityWhenCovered = '0.2'`), so the
 * same element can additionally read as a ghost.
 *
 * A DOM element can never be a solid 3D object inside the map's WebGL scene.
 * The only way to get a body with real depth, real occlusion against the 3D
 * buildings and real shading is to put the bus *in* the scene. MapLibre can
 * already do that with the engine it ships: `fill-extrusion` renders arbitrary
 * polygons as solid, opaque, depth-tested volumes. So the bus here is a small
 * extruded **mesh**: wheels, lower body, window band, windshield, roof and
 * bumpers, each a polygon with its own `base`/`height`/`color`, all in ONE
 * GeoJSON source and ONE layer (the paint properties are data-driven).
 *
 * Cost: zero. No three.js, no glTF asset, no model host, no tile provider, no
 * API key — the geometry is computed here from the live fix and uploaded as
 * GeoJSON like every other overlay in this folder.
 *
 * ### Anchoring
 *
 * Every vertex is built in a metric bus-local frame (x = right of the bus,
 * y = forward) around the origin, rotated by the heading, then converted to
 * WGS-84 degrees relative to the *live* fix. The bus's origin is therefore the
 * GPS coordinate itself at every heading and every zoom — the same invariant
 * the flat marker's centred anchor gives on the 2D map.
 *
 * ### Size
 *
 * A real 12 m bus is ~7 px at z16 — invisible, which is why ride-hailing apps
 * draw a vehicle at a roughly constant *screen* size. `busLengthMeters` does
 * the same: it converts a target pixel length through the mercator metres-per-
 * pixel at the current latitude/zoom, clamped so the bus is never smaller than
 * a real bus and never grows into a city block when the camera pulls back.
 *
 * Everything here is pure (no MapLibre import, no DOM) so it can be pinned by
 * `bus-3d.spec.ts` under `node --test`.
 */

export const BUS_3D_SOURCE_ID = 'sbt-bus-3d';
export const BUS_3D_LAYER_ID = 'sbt-bus-3d-body';

/** Mercator metres per pixel at a latitude/zoom (512 px tiles, MapLibre). */
export function metersPerPixel(latitude: number, zoom: number): number {
  const EQUATOR_METERS = 40_075_016.686;
  const clampedLat = Math.max(-85, Math.min(85, latitude));
  return (EQUATOR_METERS * Math.cos((clampedLat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** A real school bus, and the span the drawing may never exceed. */
export const BUS_REAL_LENGTH_METERS = 12;
export const BUS_MAX_LENGTH_METERS = 260;
/** Target on-screen length — the ride-hailing "always readable" vehicle size. */
export const BUS_TARGET_PIXEL_LENGTH = 52;
/**
 * Ceiling on the body height in metres. Height is 30% of the length, so with
 * no ceiling a zoomed-out bus would be a tower; capping it keeps the far view
 * a readable bus-shaped footprint and the near view a properly proportioned
 * vehicle.
 */
export const BUS_MAX_HEIGHT_METERS = 36;

/** Ground length of the drawn bus at this latitude/zoom, in metres. */
export function busLengthMeters(latitude: number, zoom: number): number {
  const wanted = BUS_TARGET_PIXEL_LENGTH * metersPerPixel(latitude, zoom);
  return Math.min(BUS_MAX_LENGTH_METERS, Math.max(BUS_REAL_LENGTH_METERS, wanted));
}

export interface BusMeshInput {
  latitude: number;
  longitude: number;
  /** Compass degrees (0 = north, clockwise). Null = keep the bus nose-north. */
  headingDeg: number | null;
  zoom: number;
  /** Stale/last-known fixes are drawn in slate instead of school-bus amber. */
  stale?: boolean;
}

interface Part {
  id: string;
  /** Bus-local metric polygon, [right, forward] pairs, closed implicitly. */
  points: Array<[number, number]>;
  base: number;
  height: number;
  color: string;
}

const DEG_PER_METER_LAT = 1 / 110_574;

function toLngLat(
  latitude: number,
  longitude: number,
  east: number,
  north: number,
): [number, number] {
  const latRad = (latitude * Math.PI) / 180;
  const degPerMeterLng = 1 / (111_320 * Math.max(0.01, Math.cos(latRad)));
  return [longitude + east * degPerMeterLng, latitude + north * DEG_PER_METER_LAT];
}

/** Axis-aligned bus-local rectangle: x = right, y = forward. */
function rect(x0: number, x1: number, y0: number, y1: number): Array<[number, number]> {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** A rectangle with its two front corners cut back — the bus nose. */
function nosedRect(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  chamfer: number,
): Array<[number, number]> {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1 - chamfer],
    [x1 - chamfer, y1],
    [x0 + chamfer, y1],
    [x0, y1 - chamfer],
  ];
}

/**
 * The parts list, in metres, for a bus of length `L`.
 *
 * Drawing order matters only for coincident faces; the depth buffer does the
 * rest. Colours are flat and fully opaque on purpose — the extrusion layer is
 * rendered with `fill-extrusion-opacity: 1` and a vertical gradient, which is
 * what makes it read as a solid object rather than a translucent overlay.
 */
export function busParts(lengthMeters: number, stale = false): Part[] {
  const L = lengthMeters;
  const W = L * 0.36;
  const H = Math.min(BUS_MAX_HEIGHT_METERS, L * 0.3);
  const halfW = W / 2;
  const halfL = L / 2;

  const bodyColor = stale ? '#94a3b8' : '#F6B500';
  const roofColor = stale ? '#cbd5e1' : '#FFC93C';
  const glass = '#16283C';

  return [
    // Wheels: four dark blocks that protrude past the body sides, so the bus
    // has visible running gear from any camera angle.
    ...(
      [
        [halfL * 0.62, 1],
        [halfL * 0.62, -1],
        [-halfL * 0.66, 1],
        [-halfL * 0.66, -1],
      ] as Array<[number, number]>
    ).map(([y, side], index) => ({
      id: `wheel-${index}`,
      points: rect(
        side > 0 ? halfW * 0.74 : -halfW * 1.04,
        side > 0 ? halfW * 1.04 : -halfW * 0.74,
        y - L * 0.075,
        y + L * 0.075,
      ),
      base: 0,
      height: H * 0.17,
      color: '#0b1220',
    })),
    // Chassis skirt — lifts the body off the road so the wheels read.
    {
      id: 'skirt',
      points: rect(-halfW * 0.92, halfW * 0.92, -halfL * 0.98, halfL * 0.98),
      base: 0,
      height: H * 0.12,
      color: '#1f2937',
    },
    // Lower body.
    {
      id: 'body',
      points: nosedRect(-halfW, halfW, -halfL, halfL, L * 0.08),
      base: H * 0.1,
      height: H * 0.56,
      color: bodyColor,
    },
    // Window band: dark glass all the way round, inset a touch so the body's
    // amber edge stays visible beneath it.
    {
      id: 'windows',
      points: nosedRect(-halfW * 0.99, halfW * 0.99, -halfL * 0.96, halfL * 0.995, L * 0.075),
      base: H * 0.56,
      height: H * 0.84,
      color: glass,
    },
    // Roof.
    {
      id: 'roof',
      points: nosedRect(-halfW * 0.94, halfW * 0.94, -halfL * 0.98, halfL * 0.985, L * 0.085),
      base: H * 0.84,
      height: H,
      color: roofColor,
    },
    // Front bumper / nose block: the heading cue at a glance.
    {
      id: 'bumper-front',
      points: nosedRect(-halfW * 0.96, halfW * 0.96, halfL * 0.86, halfL * 1.02, L * 0.06),
      base: 0,
      height: H * 0.26,
      color: '#111827',
    },
    // Rear bumper.
    {
      id: 'bumper-rear',
      points: rect(-halfW * 0.96, halfW * 0.96, -halfL * 1.02, -halfL * 0.88),
      base: 0,
      height: H * 0.24,
      color: '#111827',
    },
    // Roof beacon — a small amber box on the centre line, reads at low zoom.
    {
      id: 'beacon',
      points: rect(-W * 0.09, W * 0.09, halfL * 0.1, halfL * 0.34),
      base: H,
      height: H * 1.12,
      color: stale ? '#64748b' : '#ef4444',
    },
  ];
}

/**
 * The bus mesh as GeoJSON at a real GPS position.
 *
 * Returns `null` for a missing/non-finite position so the caller can simply
 * clear the source instead of branching.
 */
export function busMeshCollection(input: BusMeshInput | null): FeatureCollection<Polygon> | null {
  if (!input) return null;
  const { latitude, longitude, headingDeg, zoom, stale = false } = input;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(zoom)) {
    return null;
  }

  const heading = Number.isFinite(headingDeg ?? NaN) ? ((headingDeg as number) * Math.PI) / 180 : 0;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const length = busLengthMeters(latitude, zoom);

  const features: Array<Feature<Polygon>> = busParts(length, stale).map((part) => {
    const ring = part.points.map(([right, forward]) => {
      // heading is clockwise from north: forward = (sin, cos) in (east, north),
      // right = (cos, -sin). The origin stays exactly on the GPS coordinate.
      const east = right * cos + forward * sin;
      const north = -right * sin + forward * cos;
      return toLngLat(latitude, longitude, east, north);
    });
    ring.push(ring[0]);
    return {
      type: 'Feature',
      id: part.id,
      properties: {
        part: part.id,
        base: Number(part.base.toFixed(3)),
        height: Number(part.height.toFixed(3)),
        color: part.color,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  });

  return { type: 'FeatureCollection', features };
}

/**
 * The one layer the mesh is drawn with. Fully opaque, vertically shaded, and
 * never faded: "solid vehicle" is a hard requirement, so opacity is not a
 * knob this layer exposes.
 */
export function busExtrusionLayer(): Record<string, unknown> {
  return {
    id: BUS_3D_LAYER_ID,
    type: 'fill-extrusion',
    source: BUS_3D_SOURCE_ID,
    paint: {
      'fill-extrusion-color': ['coalesce', ['get', 'color'], '#F6B500'],
      'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'base']], 0],
      'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height']], 3],
      'fill-extrusion-opacity': 1,
      'fill-extrusion-vertical-gradient': true,
    },
  };
}

export const EMPTY_BUS_MESH: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Is the tile-driven 3D-buildings layer on?
 *
 * The answer is exactly one rule, stated here rather than as a boolean buried
 * in an effect: **building volumes exist only while the 3D camera is on.**
 * The 2D camera keeps the base style's flat building footprint fill and looks
 * precisely like it always did — no extrusion, no sky, no elevated camera
 * furniture. Every other guard a user might think of (reduced motion, the
 * dropped-frame fallback) is already folded into `dimension` upstream by
 * `useMapCameraMode`, so this function takes the *effective* dimension and
 * nothing else.
 *
 * Pure (no MapLibre, no DOM) so the decision can be pinned by
 * `bus-3d-buildings.spec.ts` under `node --test`.
 */
export function buildingsLayerVisible(dimension: MapDimension | null | undefined): boolean {
  return dimension === '3d';
}

/**
 * The building fill-extrusion for this camera mode, or `null` in 2D or when
 * the loaded style exposes no building source to extrude (the layer geometry
 * itself is shared policy from `@school-bus-tracking/map-assets`, driven by
 * the tiles' `render_height`/`height` attributes — no new source, no network).
 */
export function buildingsLayerForDimension(
  style: unknown,
  dimension: MapDimension,
): Record<string, unknown> | null {
  return buildingsLayerVisible(dimension) ? buildingExtrusionLayerForStyle(style) : null;
}
