/**
 * Shared 2D/3D map-camera policy.
 *
 * This module is deliberately engine- and platform-neutral. Both MapLibre GL
 * JS surfaces and the native MapLibre surface consume these constants and
 * decisions, so pitch, role defaults, the performance fallback and the
 * OpenFreeMap building treatment cannot drift between web and mobile.
 */

export type MapDimension = '2d' | '3d';
export type MapFallbackReason = 'reduced-motion' | 'dropped-frames';

export const MAP_3D_PITCH = 45;
export const MAP_MAX_PITCH = 60;
export const MAP_BUILDINGS_MIN_ZOOM = 15;
export const MAP_BUILDING_LAYER_ID = 'sbt-3d-buildings';

/** MapLibre's style-level sky (called a sky layer in the product UI). */
export const MAP_3D_SKY = {
  'sky-color': '#cfe8ff',
  'horizon-color': '#f8fafc',
  'fog-color': '#eef6ff',
  'horizon-fog-blend': 0.18,
  'fog-ground-blend': 0.08,
  'atmosphere-blend': 0.45,
} as const;

/** School/platform admins and parents are overview roles; everyone else stays flat. */
export function defaultMapDimensionForRole(role: string | null | undefined): MapDimension {
  return role === 'SCHOOL_ADMIN' || role === 'SUPER_ADMIN' || role === 'PARENT' ? '3d' : '2d';
}

/** Stored values are untrusted and old/corrupt values fall through to defaults. */
export function parseMapDimension(value: unknown): MapDimension | null {
  return value === '2d' || value === '3d' ? value : null;
}

export function effectiveMapDimension(
  preferred: MapDimension,
  reducedMotion: boolean,
  performanceFallback: boolean,
): MapDimension {
  return reducedMotion || performanceFallback ? '2d' : preferred;
}

interface MapStyleLike {
  sources?: unknown;
  layers?: unknown;
  [key: string]: unknown;
}

interface LayerLike {
  id?: unknown;
  type?: unknown;
  source?: unknown;
  'source-layer'?: unknown;
  [key: string]: unknown;
}

/**
 * Finds a building source already present in the loaded OpenFreeMap style.
 * No URL and no source is ever created here. A style that names its building
 * layer is preferred; otherwise the first existing vector source is used with
 * OpenMapTiles' standard `building` source-layer.
 */
export function existingBuildingSource(style: unknown): {
  source: string;
  sourceLayer: string;
} | null {
  if (style === null || typeof style !== 'object' || Array.isArray(style)) return null;
  const candidate = style as MapStyleLike;
  const layers = Array.isArray(candidate.layers) ? (candidate.layers as LayerLike[]) : [];
  const sources =
    candidate.sources !== null &&
    typeof candidate.sources === 'object' &&
    !Array.isArray(candidate.sources)
      ? (candidate.sources as Record<string, unknown>)
      : {};

  const buildingLayer = layers.find(
    (layer) =>
      typeof layer.source === 'string' &&
      typeof layer['source-layer'] === 'string' &&
      layer['source-layer'].toLowerCase().includes('building') &&
      layer.source in sources,
  );
  if (buildingLayer) {
    return {
      source: buildingLayer.source as string,
      sourceLayer: buildingLayer['source-layer'] as string,
    };
  }

  const vectorSource = Object.entries(sources).find(([, source]) => {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) return false;
    return (source as { type?: unknown }).type === 'vector';
  });
  return vectorSource ? { source: vectorSource[0], sourceLayer: 'building' } : null;
}

/** A fill-extrusion layer that references only the style's existing source. */
export function buildingExtrusionLayerForStyle(style: unknown): Record<string, unknown> | null {
  const building = existingBuildingSource(style);
  if (!building) return null;
  return {
    id: MAP_BUILDING_LAYER_ID,
    type: 'fill-extrusion',
    source: building.source,
    'source-layer': building.sourceLayer,
    minzoom: MAP_BUILDINGS_MIN_ZOOM,
    paint: {
      'fill-extrusion-color': '#d6d3d1',
      'fill-extrusion-opacity': 0.74,
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        MAP_BUILDINGS_MIN_ZOOM,
        0,
        MAP_BUILDINGS_MIN_ZOOM + 0.5,
        ['coalesce', ['to-number', ['get', 'render_height']], ['to-number', ['get', 'height']], 8],
      ],
      'fill-extrusion-base': [
        'coalesce',
        ['to-number', ['get', 'render_min_height']],
        ['to-number', ['get', 'min_height']],
        0,
      ],
    },
  };
}

/**
 * Adds the 3D sky and extrusion to a fetched style object. The 2D path returns
 * the exact original value by identity, preserving the pre-toggle style. The
 * source table is also retained by identity: 3D never adds a tile provider.
 */
export function mapStyleForDimension(style: unknown, dimension: MapDimension): unknown {
  if (dimension === '2d') return style;
  if (style === null || typeof style !== 'object' || Array.isArray(style)) return style;

  const candidate = style as MapStyleLike;
  const layers = Array.isArray(candidate.layers) ? (candidate.layers as LayerLike[]) : [];
  const extrusion = buildingExtrusionLayerForStyle(candidate);
  const withoutOurLayer = layers.filter((layer) => layer.id !== MAP_BUILDING_LAYER_ID);
  const firstSymbol = withoutOurLayer.findIndex((layer) => layer.type === 'symbol');
  const nextLayers = extrusion ? [...withoutOurLayer] : withoutOurLayer;
  if (extrusion) {
    nextLayers.splice(firstSymbol === -1 ? nextLayers.length : firstSymbol, 0, extrusion);
  }

  return {
    ...candidate,
    // Explicitly preserve the one provider/source table. This assignment is
    // intentionally not a clone so callers can assert source identity.
    sources: candidate.sources,
    sky: MAP_3D_SKY,
    layers: nextLayers,
  };
}

/**
 * Rolling dropped-frame detector. Idle/background gaps reset the window rather
 * than counting as slow rendering; only repeated slow frames in an active
 * render run trigger the one-way result.
 */
export interface DroppedFrameGuard {
  sample: (timestampMs: number) => boolean;
  reset: () => void;
}

export function createDroppedFrameGuard(options?: {
  slowFrameMs?: number;
  requiredSlowFrames?: number;
  windowMs?: number;
  idleGapMs?: number;
}): DroppedFrameGuard {
  const slowFrameMs = options?.slowFrameMs ?? 48;
  const requiredSlowFrames = options?.requiredSlowFrames ?? 6;
  const windowMs = options?.windowMs ?? 2_000;
  const idleGapMs = options?.idleGapMs ?? 300;
  let previous: number | null = null;
  let slowFrames: number[] = [];
  let triggered = false;

  return {
    sample(timestampMs: number): boolean {
      if (triggered || !Number.isFinite(timestampMs)) return triggered;
      if (previous === null) {
        previous = timestampMs;
        return false;
      }
      const elapsed = timestampMs - previous;
      previous = timestampMs;
      if (elapsed <= 0 || elapsed >= idleGapMs) {
        slowFrames = [];
        return false;
      }
      slowFrames = slowFrames.filter((at) => timestampMs - at <= windowMs);
      if (elapsed >= slowFrameMs) slowFrames.push(timestampMs);
      if (slowFrames.length >= requiredSlowFrames) triggered = true;
      return triggered;
    },
    reset(): void {
      previous = null;
      slowFrames = [];
      triggered = false;
    },
  };
}
