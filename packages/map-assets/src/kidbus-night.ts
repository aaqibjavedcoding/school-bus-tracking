import { KIDBUS_DAY_STYLE, type KidbusDayStyle } from './kidbus-day';

/**
 * KidBus night cartography — the Session 5 kidbus-day style under a dark
 * (Google-night-like) palette.
 *
 * ### What changes and what does not
 *
 * ONLY paint. Sources (the one OpenFreeMap/OpenMapTiles vector source), the
 * sprite (our own `/map-sprites/kidbus`) and the glyphs (OpenFreeMap font
 * host) are carried over **by reference from the day style** — same free
 * tiles, same keyless URLs, same CSP; the night variant adds no provider, no
 * second tile host and no network surface a daytime session did not already
 * have. Layout (fonts, text sizes, minzooms, icon images) is untouched: the
 * night map labels and icons are the day map's labels and icons.
 *
 * The palette follows Google's night scheme: dark land, near-black road
 * casings, muted greys for roads and labels, deep blue water, and a softened
 * motorway amber so the hierarchy still reads at a glance.
 */

/** Per-layer night paints, keyed by the day style's layer ids. */
const NIGHT_PAINT: Record<string, Record<string, unknown>> = {
  // Land.
  background: { 'background-color': '#202124' },
  // Water and waterways: Google's deep night blue.
  water: { 'fill-color': '#17263c' },
  waterway: {
    'line-color': '#17263c',
    'line-width': { stops: [[10, 1], [16, 3]] },
  },
  // Vegetation: the day's greens taken down to muted dark tones.
  landcover: {
    'fill-color': [
      'match',
      ['get', 'class'],
      ['park', 'grass'],
      '#263c3f',
      ['wood'],
      '#1f2f22',
      '#202124',
    ],
  },
  landuse: {
    'fill-color': ['match', ['get', 'class'], ['park', 'cemetery'], '#263c3f', '#202124'],
    'fill-opacity': 0.7,
  },
  // Buildings: a whisper above the land, against the road casing colour.
  building: { 'fill-color': '#2f3134', 'fill-outline-color': '#3c4043' },
  // Roads: dark casing (#202124) around grey fills (#3c4043); the motorway
  // trunk class keeps a muted amber so arterial roads still read first.
  'road-casings': {
    'line-color': '#202124',
    'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3, 18, 10],
  },
  'road-fills': {
    'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#a8862f', '#3c4043'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2, 18, 8],
  },
  rail: { 'line-color': '#3c4043', 'line-dasharray': [2, 2], 'line-width': 2 },
  // Labels: Google's night label grey over a land-coloured halo.
  transportation_name: {
    'text-color': '#9aa0a6',
    'text-halo-color': '#202124',
    'text-halo-width': 2,
  },
  place: { 'text-color': '#9aa0a6', 'text-halo-color': '#202124', 'text-halo-width': 1.5 },
  water_name: { 'text-color': '#8ab4f8', 'text-halo-color': '#17263c', 'text-halo-width': 1 },
  poi: { 'text-color': '#9aa0a6', 'text-halo-color': '#202124', 'text-halo-width': 1 },
  // Boundaries: subordinate at night.
  boundary: { 'line-color': '#5f6368', 'line-dasharray': [3, 2], 'line-width': 1 },
};

/**
 * The night style's shape: version/sources/glyphs/sprite are typed as **the
 * day's own fields** (the transform passes them through untouched by
 * reference), while layers are plain layer records — the day style's `as
 * const` literal tuple cannot express paint-overridden layers.
 */
export interface KidbusNightStyle {
  readonly version: KidbusDayStyle['version'];
  readonly name: 'kidbus-night';
  readonly sources: KidbusDayStyle['sources'];
  readonly glyphs: KidbusDayStyle['glyphs'];
  readonly sprite: KidbusDayStyle['sprite'];
  readonly layers: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Builds the night style from the day style. Sources, glyphs and sprite are
 * NOT cloned or replaced — identity is the guarantee that night adds no new
 * network surface, and a spec asserts it.
 */
export function kidbusNightStyle(day: KidbusDayStyle): KidbusNightStyle {
  return {
    version: day.version,
    name: 'kidbus-night',
    sources: day.sources,
    glyphs: day.glyphs,
    sprite: day.sprite,
    layers: day.layers.map((layer) => {
      const paint = NIGHT_PAINT[layer.id];
      return paint ? { ...layer, paint } : { ...layer };
    }),
  };
}

export const KIDBUS_NIGHT_STYLE = kidbusNightStyle(KIDBUS_DAY_STYLE);
