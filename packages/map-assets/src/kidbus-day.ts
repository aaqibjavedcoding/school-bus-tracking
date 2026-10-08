/**
 * KidBus daytime cartography for OpenMapTiles vector tiles — the *only* style
 * source in the repo. The JSON under `web/public/map-styles/` is generated from
 * this object (`packages/map-assets/scripts-copy.cjs`), and a spec fails if the
 * two drift apart.
 *
 * ### What changed in the "detailed as Google Maps" pass
 *
 * The previous version was 14 layers and three of them were structurally
 * broken, which is why the map looked empty at the zooms a tracking screen
 * sits at (see `docs/map-report-flight-view-google-maps-cost.md` §2):
 *
 * 1. **POI icons never drew.** `icon-image` asked for `poi-<class>` while the
 *    sprite carried bare Maki names, and MapLibre *skips the whole symbol*
 *    when an icon is missing from the atlas — no icon, no label, at any zoom.
 *    The sprite is now generated with the exact ids the style names
 *    (`poi-school`, `poi-hospital`, `poi-place_of_worship`, …) and this file
 *    maps OpenMapTiles classes onto them through a `match` with a named
 *    `poi-default` fallback, so an unknown class still draws a marker.
 * 2. **Road names sat still.** `transportation_name` had no
 *    `symbol-placement`, so every name landed on one point of the line and
 *    mostly vanished into collision detection. The name layers are now
 *    `symbol-placement: 'line'` with `text-rotation-alignment: 'map'`,
 *    `symbol-spacing`, zoom-interpolated sizes and an explicit halo.
 * 3. **Area names had no rules.** One unfiltered `place` layer let city and
 *    village names win every collision. Places are now class-wise layers with
 *    their own `minzoom`, size, halo and `symbol-sort-key` — city z2, town z6,
 *    village z9, suburb z11, quarter z12, hamlet/neighbourhood z13 — so a
 *    colony/suburb name survives at z13–16, which is the complaint being fixed.
 *
 * Plus a real road hierarchy: class-wise widths and colours (motorway/trunk
 * #fdd663, primary #f8c14a, secondary/tertiary #fff2a8, minor/service plain
 * white), a casing under every fill, rail as a dashed line, and
 * bridge/tunnel passes so a flyover and a culvert do not read as plain road.
 *
 * ### Free and keyless, pinned by tests
 *
 * One vector source: OpenFreeMap's public OpenMapTiles/OpenStreetMap tiles. No
 * key, no account, no metered tier — `web/scripts/map-provider-policy.spec.ts`
 * and `mobile/scripts/map-provider-policy.spec.ts` enforce it, and
 * `web/scripts/kidbus-cartography.spec.ts` enforces the sprite id, line
 * placement, place-class minima and object↔JSON rules above.
 */

/** The one vector source. Free, keyless, ODbL data — nothing else is added. */
const SOURCE = 'openmaptiles';

// ── Small expression builders ──────────────────────────────────────────────
// Written as plain helpers (not as one-off literals) so the tables below stay
// readable and a class list is stated exactly once.

/**
 * Anything a MapLibre filter/expression can hold, recursively: a string, a
 * number, a boolean, or a nested expression array. Named so the builders below
 * (and the style object that uses them) stay typed without hand-written casts.
 */
export type StyleExpression = string | number | boolean | ReadonlyArray<StyleExpression>;

/** A zoom ramp: `['interpolate', ['linear'], ['zoom'], z0, v0, z1, v1, …]`. */
function ramp(stops: ReadonlyArray<readonly [number, number]>): StyleExpression {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flat()];
}

/** `['match', ['get', 'class'], [classes], true, false]` — a class filter. */
function anyClass(classes: ReadonlyArray<string>): StyleExpression {
  return ['match', ['get', 'class'], classes, true, false];
}

/** Lines only: the `transportation` source-layer also carries areas (piers, plazas). */
const LINE_GEOMETRY: StyleExpression = [
  'match',
  ['get', 'geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
];

/** Not a bridge and not a tunnel — the surface road pass. */
const SURFACE: StyleExpression = ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true];

/** A bridge, whichever way the tile spells it. */
const BRIDGE: StyleExpression = ['match', ['get', 'brunnel'], ['bridge'], true, false];

/** A tunnel, whichever way the tile spells it. */
const TUNNEL: StyleExpression = ['match', ['get', 'brunnel'], ['tunnel'], true, false];

/**
 * Road classes, split the way the widths differ. `motorway_link` and friends
 * are separate classes in OpenMapTiles; `minor` is residential/unclassified/
 * living_street, and `service`/`track`/`path` are the narrowest things drawn.
 *
 * ### Why the hierarchy is three width *groups* and not one `match`
 *
 * A MapLibre expression may contain **one** zoom-based `interpolate`, and a
 * `match` whose branches each carry a zoom ramp is rejected — "Only one
 * zoom-based step or interpolate subexpression may be used in an expression".
 * A width hierarchy is therefore expressed as separate layers (the standard
 * style idiom), while the class *colours*, which need no zoom, stay a plain
 * `match` inside a layer.
 */
const CLASS_MOTORWAY: ReadonlyArray<string> = ['motorway', 'motorway_link'];
const CLASS_TRUNK = ['trunk', 'trunk_link'];
const CLASS_PRIMARY = ['primary', 'primary_link'];
const CLASS_SECONDARY = ['secondary', 'secondary_link', 'tertiary', 'tertiary_link'];
const CLASS_MINOR = ['minor', 'unclassified', 'living_street'];
const CLASS_SERVICE = ['service', 'track', 'path'];
const CLASS_MAJOR = [...CLASS_MOTORWAY, ...CLASS_TRUNK, ...CLASS_PRIMARY];
const CLASS_MID = [...CLASS_SECONDARY];
const CLASS_NARROW = [...CLASS_MINOR, ...CLASS_SERVICE];

/** Fill colour per class: Google's yellow/white road hierarchy (no zoom). */
export const ROAD_FILL_COLOR_MAJOR: StyleExpression = [
  'match',
  ['get', 'class'],
  CLASS_MOTORWAY,
  '#fdd663',
  CLASS_TRUNK,
  '#fdd663',
  '#f8c14a',
];

export const ROAD_FILL_COLOR_NARROW: StyleExpression = [
  'match',
  ['get', 'class'],
  CLASS_SECONDARY,
  '#fff2a8',
  CLASS_MINOR,
  '#ffffff',
  '#f1f3f4',
];

/** Casing colour per class: always the darker edge of the fill above (no zoom). */
export const ROAD_CASING_COLOR_MAJOR: StyleExpression = ['match', ['get', 'class'], CLASS_PRIMARY, '#daa93f', '#e8b95f'];

export const ROAD_CASING_COLOR_NARROW: StyleExpression = [
  'match',
  ['get', 'class'],
  CLASS_SECONDARY,
  '#e2d495',
  CLASS_MINOR,
  '#d5d7db',
  '#d5d7db',
];

/**
 * Width stops, in logical pixels, ramped by zoom. The casing stops are derived
 * from the fill stops (+1.4 px for the arterial roads, +1.2 px for the rest) so
 * the drawn edge of a road is the same weight everywhere and a table can never
 * be edited in one place and forgotten in the other.
 */
const FILL_STOPS_MAJOR: ReadonlyArray<readonly [number, number]> = [
  [5, 0.5],
  [8, 1.4],
  [12, 2.6],
  [14, 4.6],
  [18, 9.6],
  [20, 15],
];
const FILL_STOPS_SECONDARY: ReadonlyArray<readonly [number, number]> = [
  [11, 0],
  [12, 0.6],
  [13, 1.3],
  [14, 2.6],
  [18, 7],
  [20, 11.5],
];
const FILL_STOPS_MINOR: ReadonlyArray<readonly [number, number]> = [
  [12, 0],
  [13, 0.5],
  [14, 1.2],
  [18, 4.2],
  [20, 7],
];

/**
 * Flat casing colours for the two underground/overground passes. Named (and
 * exported) because the night style recolours a road by looking at the day
 * colour, so these strings are a contract between the two styles, not a
 * duplicated literal.
 */
export const TUNNEL_CASING_COLOR = '#dfe1e5';
export const BRIDGE_CASING_COLOR = '#c8ccd1';

/** `[[z, w], …]` → `[[z, w + extra], …]`, for the casing tables below. */
function widen(
  stops: ReadonlyArray<readonly [number, number]>,
  extra: number,
): ReadonlyArray<readonly [number, number]> {
  return stops.map(([zoom, width]) => [zoom, width + extra] as const);
}

/**
 * The width ladders, one pair per group. Exported because the night style must
 * use the SAME ladders — night changes colour, never geometry
 * (`kidbus-night.ts`, asserted by `style-variant.spec.ts`).
 */
export const ROAD_WIDTHS: ReadonlyArray<{
  readonly group: 'major' | 'secondary' | 'minor';
  readonly fill: StyleExpression;
  readonly casing: StyleExpression;
  readonly minzoom: number;
  readonly filter: StyleExpression;
}> = [
  {
    group: 'major',
    fill: ramp(FILL_STOPS_MAJOR),
    casing: ramp(widen(FILL_STOPS_MAJOR, 1.4)),
    minzoom: 6,
    filter: anyClass(CLASS_MAJOR),
  },
  {
    group: 'secondary',
    fill: ramp(FILL_STOPS_SECONDARY),
    casing: ramp(widen(FILL_STOPS_SECONDARY, 1.2)),
    minzoom: 11,
    filter: anyClass(CLASS_MID),
  },
  {
    group: 'minor',
    fill: ramp(FILL_STOPS_MINOR),
    casing: ramp(widen(FILL_STOPS_MINOR, 1.2)),
    minzoom: 12,
    filter: anyClass(CLASS_NARROW),
  },
];

/**
 * The 18 road layers: 3 brunnel passes × 3 width groups × (casing, fill).
 *
 * Written as a loop rather than 18 literals because the three passes differ
 * only in their surface filter and their colours, and a copy-paste pass is
 * exactly where a style drifts — one tunnel group silently painted at the
 * bridge's casing colour, one fill missing its `line-width`. `line-cap` is
 * `round` for casings (an edge must not be clipped) and `butt` for fills
 * (round caps would bulge past the casing at every end).
 */
function roadLayers() {
  /**
   * One entry per brunnel pass. `casing` may be a flat colour (the tunnel is
   * underground, the bridge deck is over everything) or a class match (the
   * surface pass), while the fill is always the class colour.
   */
  const passes: ReadonlyArray<{
    idPrefix: string;
    filter: StyleExpression;
    casing: (narrow: boolean) => StyleExpression;
  }> = [
    {
      idPrefix: 'road-tunnel',
      filter: TUNNEL,
      // Lighter than the surface casing: the road is in a hole.
      casing: () => TUNNEL_CASING_COLOR,
    },
    {
      idPrefix: 'road',
      filter: SURFACE,
      casing: (narrow) => (narrow ? ROAD_CASING_COLOR_NARROW : ROAD_CASING_COLOR_MAJOR),
    },
    {
      idPrefix: 'road-bridge',
      filter: BRIDGE,
      // Darker than the surface casing: the deck is the topmost thing drawn.
      casing: () => BRIDGE_CASING_COLOR,
    },
  ];

  return passes.flatMap((pass) =>
    ROAD_WIDTHS.flatMap((width) => {
      const narrow = width.group !== 'major';
      const shared = {
        type: 'line' as const,
        source: SOURCE,
        'source-layer': 'transportation',
        // Tunnels and bridges wait for street zoom; the surface pass uses the
        // group's own floor (arterials from z6, minor streets from z12).
        minzoom: pass.idPrefix === 'road' ? width.minzoom : Math.max(width.minzoom, 12),
        filter: ['all', LINE_GEOMETRY, pass.filter, width.filter],
      };
      return [
        {
          ...shared,
          id: `${pass.idPrefix}-casing-${width.group}`,
          layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
          paint: { 'line-color': pass.casing(narrow), 'line-width': width.casing },
        },
        {
          ...shared,
          id: `${pass.idPrefix}-fill-${width.group}`,
          layout: { 'line-cap': 'butt' as const, 'line-join': 'round' as const },
          paint: {
            'line-color': narrow ? ROAD_FILL_COLOR_NARROW : ROAD_FILL_COLOR_MAJOR,
            'line-width': width.fill,
          },
        },
      ];
    }),
  );
}

export const KIDBUS_DAY_STYLE = {
  version: 8,
  name: 'kidbus-day',
  /**
   * Same-origin on web (`web/public/map-sprites/kidbus*`, written by
   * `scripts/generate-kidbus-sprite.mjs`). Native cannot resolve a
   * root-relative URL, so `mobile/src/features/map/map-style.ts` resolves this
   * path against the API origin before handing the style to MapLibre — one
   * sprite, two resolvers, no third image host.
   */
  sprite: '/map-sprites/kidbus',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },

  layers: [
    // ── Ground ────────────────────────────────────────────────────────────
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f9fa' } },
    {
      id: 'landcover',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landcover',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          ['park', 'grass'],
          '#ceead6',
          ['wood'],
          '#c5e8b7',
          '#f8f9fa',
        ],
      },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      // Google's tints, so a school, a hospital or a park is visible as an
      // area before its label or icon loads.
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          ['park', 'grass', 'garden', 'playground', 'pitch', 'nature_reserve'],
          '#ceead6',
          ['school', 'college', 'university', 'kindergarten', 'education'],
          '#fdf6e3',
          ['hospital', 'clinic', 'doctors'],
          '#fce8e6',
          ['cemetery'],
          '#e6f4ea',
          ['commercial', 'retail', 'industrial', 'railway'],
          '#f1f3f4',
          '#f8f9fa',
        ],
        'fill-opacity': 0.7,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'water',
      paint: { 'fill-color': '#aadaff' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'waterway',
      paint: {
        'line-color': '#aadaff',
        'line-width': ramp([[8, 0.5], [12, 1.2], [16, 3.5], [20, 7]]),
      },
    },
    // Buildings belong to the base map, not only to the 3D mode: a flat
    // Google map has them too, and the 3D camera simply extrudes this same
    // footprint (`mapStyleForDimension` inserts its extrusion below the first
    // symbol layer, i.e. above this one).
    {
      id: 'building',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 13,
      paint: { 'fill-color': '#e8eaed', 'fill-outline-color': '#dadce0' },
    },

    // ── Rail: bottom of the road stack ────────────────────────────────────
    {
      id: 'rail',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['all', LINE_GEOMETRY, ['==', ['get', 'class'], 'rail']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#d6d6d6',
        'line-dasharray': [2, 2],
        'line-width': ramp([[10, 0.5], [14, 1], [18, 2.4]]),
      },
    },

    // ── Roads ─────────────────────────────────────────────────────────────
    // Three brunnel passes (tunnel → surface → bridge) × three width groups,
    // each a casing under a fill — the groups exist because a MapLibre
    // expression may hold only one zoom-based interpolate, so width classes
    // cannot be matched. The pass order stops a tunnel painting over a bridge,
    // or either painting over the surface road above it. Casings are always
    // 1.2–1.4 px wider than their fill. The colours inside a pass are the same
    // class colours everywhere, which is what makes a street recognisable as
    // the same street on a flyover.
    ...roadLayers(),

    // ── Boundaries ────────────────────────────────────────────────────────
    {
      id: 'boundary',
      type: 'line',
      source: SOURCE,
      'source-layer': 'boundary',
      // Admin 2+ (state and above). The old unfiltered layer drew city wards
      // as heavy grey lines straight through the middle of the map.
      filter: ['<=', ['get', 'admin_level'], 4],
      paint: {
        'line-color': '#9aa0a6',
        'line-dasharray': [3, 2],
        'line-width': ramp([[3, 0.6], [10, 1.1], [16, 1.6]]),
      },
    },

    // ── Labels, ground-up: water → roads → areas → places → POIs ──────────

    // Water names ride the water: line-placed along a river…
    {
      id: 'water_name',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'water_name',
      minzoom: 11,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Italic'],
        'text-size': ramp([[11, 11], [16, 13]]),
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'symbol-placement': 'line',
        'symbol-sort-key': 30,
        'text-max-angle': 30,
        'text-letter-spacing': 0.08,
        'text-padding': 8,
      },
      paint: { 'text-color': '#3f7fc1', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
    // …and point-placed in a lake or tank.
    {
      id: 'water_name-point',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'water_name',
      minzoom: 14,
      filter: ['match', ['get', 'class'], ['lake', 'pond', 'reservoir', 'basin'], true, false],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Italic'],
        'text-size': ramp([[14, 11], [18, 12.5]]),
        'text-max-width': 8,
        'symbol-sort-key': 40,
      },
      paint: { 'text-color': '#3f7fc1', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },

    // Road names: `symbol-placement: 'line'` — the name follows the road and
    // rotates with it, which is what the old point-placed layer never did.
    // Two layers because the rules differ: majors from z12 with a wide spacing,
    // minors from z14, smaller and lower priority.
    {
      id: 'transportation_name',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 12,
      filter: anyClass([...CLASS_MAJOR, ...CLASS_SECONDARY]),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        // Enough air between repeats that a long road is named, not stuttered.
        'symbol-spacing': 400,
        'text-size': ramp([[12, 11.5], [15, 12.5], [19, 14]]),
        'text-max-angle': 30,
        'text-padding': 4,
        'symbol-sort-key': 10,
      },
      paint: {
        'text-color': '#5f6368',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
        'text-halo-blur': 0.4,
      },
    },
    {
      id: 'transportation_name-minor',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: anyClass(CLASS_NARROW),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'symbol-spacing': 300,
        'text-size': ramp([[14, 10.5], [18, 11.5]]),
        'text-max-angle': 35,
        'text-padding': 4,
        // Just below a major road's name, so the arterial wins a collision.
        'symbol-sort-key': 12,
      },
      paint: {
        'text-color': '#6b7075',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.3,
        'text-halo-blur': 0.4,
      },
    },

    // ── Places ────────────────────────────────────────────────────────────
    // One layer per class. The order below is the priority order *between*
    // classes (drawn first = placed first = survives a collision first), and
    // `symbol-sort-key` is the priority *within* a layer. Both, the class
    // filters and the minzooms are asserted by `kidbus-cartography.spec.ts`.
    {
      id: 'place-city',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 2,
      filter: anyClass(['city']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Bold'],
        'text-size': ramp([[2, 11], [6, 14], [10, 18], [14, 22]]),
        'text-max-width': 8,
        'text-letter-spacing': 0.02,
        'text-padding': 12,
        // A capital outranks an ordinary city; the capital value 2 outranks 3–4.
        'symbol-sort-key': ['match', ['get', 'capital'], [2], 5, [3, 4], 10, 20],
      },
      paint: {
        'text-color': '#202124',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2.2,
        'text-halo-blur': 0.3,
      },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 6,
      filter: anyClass(['town']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Bold'],
        'text-size': ramp([[6, 12], [10, 14.5], [14, 17]]),
        'text-max-width': 9,
        'symbol-sort-key': 40,
      },
      paint: {
        'text-color': '#3c4043',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.8,
        'text-halo-blur': 0.3,
      },
    },
    {
      id: 'place-village',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 9,
      filter: anyClass(['village']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[9, 11.5], [13, 13], [17, 14.5]]),
        'text-max-width': 9,
        'symbol-sort-key': 50,
      },
      paint: { 'text-color': '#3c4043', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    },
    // The colony / area names — the band the complaint is about. Below
    // `village` in the hierarchy, so they lose a collision to a village name,
    // but they are *there*: suburb from z11, quarter from z12, hamlet and
    // neighbourhood from z13.
    {
      id: 'place-suburb',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 11,
      filter: anyClass(['suburb']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[11, 11.5], [14, 13.5], [18, 15]]),
        'text-max-width': 9,
        'text-padding': 6,
        'symbol-sort-key': 55,
      },
      paint: { 'text-color': '#4a4f54', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    },
    {
      id: 'place-quarter',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 12,
      filter: anyClass(['quarter']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[12, 11], [15, 12.5], [18, 13.5]]),
        'text-max-width': 9,
        'text-padding': 6,
        'symbol-sort-key': 60,
      },
      paint: { 'text-color': '#4a4f54', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
    },
    {
      id: 'place-hamlet',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 13,
      filter: anyClass(['hamlet']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[13, 11], [17, 12.5]]),
        'text-max-width': 9,
        'symbol-sort-key': 65,
      },
      paint: { 'text-color': '#55595e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
    },
    {
      id: 'place-neighbourhood',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 13,
      filter: anyClass(['neighbourhood', 'city_block']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[13, 10.5], [16, 12], [19, 13]]),
        'text-max-width': 9,
        'text-letter-spacing': 0.06,
        'text-transform': 'uppercase',
        'symbol-sort-key': 70,
      },
      paint: {
        'text-color': '#6b7075',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
        'text-halo-blur': 0.3,
      },
    },
    // State / province names: uppercase, spaced, wide padding, lowest priority
    // of the place layers so they never out-shout a road or a shop.
    {
      id: 'place-state',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'place',
      minzoom: 4,
      filter: anyClass(['state', 'province']),
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[4, 10], [9, 12], [14, 14]]),
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.15,
        'text-padding': 12,
        'symbol-sort-key': 80,
      },
      paint: { 'text-color': '#80868b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },

    // ── POIs (shops, landmarks, schools, hospitals, mandirs) ──────────────
    // The icon ids below are exactly what `scripts/generate-kidbus-sprite.mjs`
    // writes into the atlas, and `kidbus-cartography.spec.ts` fails if the two
    // ever drift. `rank` (OpenMapTiles' own importance rank) is thresholded by
    // zoom so street zoom shows landmarks and the closest zoom shows shops;
    // `symbol-sort-key` orders whatever survives, lowest first.
    {
      id: 'poi',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'poi',
      minzoom: 14,
      filter: [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['has', 'name'],
        // Furniture and address-only points are noise on a tracking screen.
        [
          'match',
          ['get', 'class'],
          [
            'entrance',
            'gate',
            'lift_gate',
            'lift',
            'waste_basket',
            'telephone',
            'post_box',
            'recycling',
            'drinking_water',
            'emergency_phone',
            'sheltered_housing',
            'toilets',
            'information',
            'bench',
            'bicycle_parking',
            'surveillance',
          ],
          false,
          true,
        ],
        // rank 1 is the most important POI in the tile; the bar relaxes with zoom.
        ['<=', ['coalesce', ['get', 'rank'], 30], ramp([[14, 12], [15, 20], [17, 30]])],
      ],
      layout: {
        'icon-image': [
          'match',
          ['get', 'class'],
          ['school', 'college', 'university', 'kindergarten'],
          'poi-school',
          ['hospital', 'clinic', 'doctors', 'nursing_home'],
          'poi-hospital',
          ['place_of_worship', 'religion', 'monastery', 'shrine', 'wayside_shrine'],
          'poi-place_of_worship',
          ['fuel', 'charging_station', 'car_repair'],
          'poi-fuel',
          ['police', 'fire_station'],
          'poi-police',
          [
            'park',
            'garden',
            'playground',
            'nature_reserve',
            'dog_park',
            'picnic_site',
            'campsite',
            'golf',
            'swimming_pool',
            'viewpoint',
            'attraction',
            'zoo',
            'theme_park',
            'garden_centre',
          ],
          'poi-park',
          ['restaurant', 'fast_food', 'cafe', 'food_court', 'bar', 'pub', 'biergarten', 'ice_cream', 'bakery', 'deli', 'confectionery'],
          'poi-restaurant',
          ['pharmacy', 'chemist', 'veterinary', 'dentist'],
          'poi-pharmacy',
          ['bank', 'atm', 'bureau_de_change'],
          'poi-bank',
          [
            'bus',
            'bus_station',
            'halt',
            'station',
            'railway',
            'tram_stop',
            'ferry_terminal',
            'airport',
            'airfield',
            'taxi',
          ],
          'poi-bus',
          [
            'shop',
            'supermarket',
            'convenience',
            'mall',
            'department_store',
            'butcher',
            'greengrocer',
            'clothes',
            'clothing_store',
            'shoe',
            'hairdresser',
            'marketplace',
            'florist',
            'electronics',
            'mobile_phone',
            'stationery',
            'hardware',
            'jewelry',
            'optician',
            'beauty',
            'variety_store',
            'kiosk',
            'grocery',
            'bookstore',
            'furniture',
            'gift',
            'laundry',
            'car',
            'car_shop',
          ],
          'poi-shop',
          'poi-default',
        ],
        'icon-size': ramp([[14, 0.62], [16, 0.75], [19, 0.85]]),
        // The label hops around the icon to dodge its neighbours, and is
        // optional: at the closest zooms the icons alone still draw.
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.85,
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ramp([[14, 10.5], [16, 11.5], [19, 12.5]]),
        'text-max-width': 8,
        'text-padding': 3,
        'icon-padding': 2,
        'text-optional': true,
        // 5 = school/gurdwara/mandir/health, 10 = police/park/transit,
        // 20 = shops and everything else.
        'symbol-sort-key': [
          'match',
          ['get', 'class'],
          ['school', 'college', 'university', 'kindergarten', 'place_of_worship', 'religion', 'monastery', 'shrine', 'wayside_shrine', 'hospital', 'clinic', 'doctors', 'nursing_home', 'pharmacy', 'chemist'],
          5,
          ['police', 'fire_station', 'park', 'garden', 'playground', 'bus_station', 'station', 'bus', 'railway', 'halt', 'tram_stop'],
          10,
          20,
        ],
      },
      paint: {
        'text-color': '#5f6368',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
        'text-halo-blur': 0.3,
      },
    },
  ],
} as const;

export type KidbusDayStyle = typeof KIDBUS_DAY_STYLE;
