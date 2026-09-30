/**
 * Which map style the native map loads — and the one product rule that picks it.
 *
 * ### The rule (documented in `docs/live-tracking-map.md` → "Map provider
 * policy")
 *
 * This is a SaaS that may grow to 1000 schools / 100k students, so the map
 * must never depend on a service that needs an API key, a credit card, a
 * billing account or a metered free tier. The style therefore comes from
 * open-source software (MapLibre) over OpenStreetMap data
 * (OpenFreeMap's public instance by default).
 *
 * ### Why the URL is a variable at all
 *
 * The scale path is to **self-host** OpenFreeMap
 * (https://github.com/hyperknot/openfreemap) on our own server and change
 * **one variable** — `EXPO_PUBLIC_MAP_STYLE_URL` — with no app code change.
 * `resolveMapStyleUrl` is the single place that decides which URL the map
 * actually loads, so nothing else in the app may hard-code a tile endpoint.
 *
 * ### Why https-only
 *
 * A tile request over plain `http` would leak every GPS fix the map makes to
 * the wire in the clear on any network. That is not an acceptable failure
 * mode for a bus-full of children's routes, so a non-https override is
 * rejected (warned once, at bundle time — the value is inlined by Metro, so
 * the process-level warning is the honest one) and the default is used
 * instead. The default itself is https, so the fallback is never a downgrade.
 *
 * The module is pure — no React, no native imports, no `process` — so every
 * branch is pinned by `map-style.spec.ts` under plain `node --test`.
 */

/**
 * The default style: OpenFreeMap's public **"bright"** style.
 *
 * No key, no registration, no limits advertised by the provider
 * (https://openfreemap.org); attribution "OpenFreeMap © OpenMapTiles, Data from
 * OpenStreetMap" is carried by MapLibre from the style JSON itself.
 *
 * ### Why this style and not the other one on the same host

 * Labels were never a provider problem: both public OpenFreeMap styles declare
 * road, place and area label layers and carry their `glyphs` and `sprite` on the
 * **same host** as the tiles, so nothing extra had to be allowed by the CSP for
 * text to draw. Two things made the map look unlabeled, and both are fixed:
 *
 * 1. the camera policy (`fitBounds` in `MapViewInner`) settles on the **lowest**
 *    zoom that contains the whole route — z10–z12 for a several-kilometre run,
 *    where a street map has every reason to omit minor roads and area names. The
 *    web fit is now floored at `MIN_FIT_ZOOM`;
 * 2. `"bright"` is the variant of the same free style family that keeps its
 *    road, shield, neighbourhood, park and water labels across the mid zooms a
 *    tracking screen actually sits at, which is what the fix asks for: a map that
 *    reads like a normal map.
 *
 * The swap is a style id inside one URL: same host, no key, no billing, no CSP
 * change.
 */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

/**
 * The attribution the style is known for. MapLibre renders the attribution
 * carried by the style JSON automatically; this constant is the single source
 * of the text for docs and for the policy guard, so the two can never drift
 * into claiming a different provider than the one actually rendering.
 */
export const MAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, Data from OpenStreetMap';

/**
 * The env variable that overrides the default style. Read by the caller
 * (Metro inlines `process.env.EXPO_PUBLIC_*` at bundle time) and passed in,
 * because this module must stay loadable under plain `node --test`.
 */
export const MAP_STYLE_ENV_VARIABLE = 'EXPO_PUBLIC_MAP_STYLE_URL';

let warnedAboutNonHttpsStyle = false;

/**
 * Resolves the style URL the map will load.
 *
 * - unset (or blank) `EXPO_PUBLIC_MAP_STYLE_URL` → the OpenFreeMap default;
 * - a value that is `https://…` → that value, verbatim (trimmed);
 * - anything else (http, a bare hostname, garbage) → a one-time warning plus
 *   the default. The map must never silently point at a keyed or plaintext
 *   tile endpoint.
 *
 * @param env the environment as the app sees it (at minimum the
 *   `EXPO_PUBLIC_MAP_STYLE_URL` entry).
 */
export function resolveMapStyleUrl(env: Record<string, string | undefined>): string {
  const raw = env[MAP_STYLE_ENV_VARIABLE];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAP_STYLE_URL;
  }
  const url = raw.trim();
  if (url.startsWith('https://')) {
    return url;
  }
  if (!warnedAboutNonHttpsStyle) {
    warnedAboutNonHttpsStyle = true;
    // Deliberately no value echo beyond the scheme class: a misconfigured URL
    // is a build error, and the warning goes to the developer, not the phone.
    console.warn(
      `[map-style] ${MAP_STYLE_ENV_VARIABLE} must be an https:// URL ` +
        '(tile traffic carries GPS positions and must never ride plain http). ' +
        `Falling back to the default style: ${DEFAULT_MAP_STYLE_URL}`,
    );
  }
  return DEFAULT_MAP_STYLE_URL;
}

/** Test seam: back to the "never warned" state. */
export function __resetMapStyleWarningsForTests(): void {
  warnedAboutNonHttpsStyle = false;
}

// ── Glyph / label health ───────────────────────────────────────────────────
//
// The map is worthless as a tracking surface if street and place names do not
// draw. Two independent failure modes took the labels away and both are
// handled from here (details in `docs/live-tracking-map.md`):
//
// 1. layers without an explicit `text-font` fall back to MapLibre's default
//    stack ("Open Sans Regular,Arial Unicode MS Regular"), whose OpenFreeMap
//    font URL 404s — every symbol layer then draws with zero glyphs and the
//    map is silently unlabeled (LiveTrafficStan#82);
// 2. the Android MapLibre build drops labels when the glyph fetch URL carries
//    unencoded spaces in the fontstack segment (maplibre-native#3939 family),
//    so the fontstack path must be requested percent-encoded.
//
// The pipeline (`use-map-style.ts`) fetches the style JSON in JS, repairs the
// `glyphs` template if it is missing or non-https, rewrites every fontstack
// request to its encoded form via `TransformRequestManager`, probes one real
// glyph URL to *verify* the endpoint answers, and reports every failure into
// the map-diagnostics store — never blank-silent.

/** The canonical OpenFreeMap fonts endpoint, https like everything we load. */
export const OPENFREEMAP_GLYPHS_TEMPLATE =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/**
 * What a map issue means for the panels (`map.issue.*` copy keys).
 *
 * Three codes, and the distinction between the first two is the whole point:
 *
 * - `styleOffline` — the bundled offline base style is what is rendering.
 *   The map **works**: stops, the bus, the accuracy ring and the status panel
 *   all draw over it. This is a neutral chip with a Retry affordance, never a
 *   red line, because calling a working map a failure is how the app started
 *   lying about its own health.
 * - `styleLoad` — the terminal state: the engine could not render even the
 *   zero-network fallback. This one is red, and only this one.
 * - `glyphs` — the fonts endpoint is verifiably unreachable, so labels cannot
 *   draw (a single missing glyph range is not this — see
 *   `map-log-classifier.ts`).
 */
export type MapStyleIssueCode = 'styleLoad' | 'styleOffline' | 'glyphs';

// ── The offline fallback style (deep-fix R3) ───────────────────────────────
//
// When the style fetch and the bounded retries are all spent (a genuine dead
// zone), the map must not be a dead box. This bundled style is the floor: it
// loads with **zero network** — no tile sources, no glyphs, no sprite — and
// paints one neutral background, so the stop dots, the bus marker, the
// accuracy circle and the status panel (all React Native overlays, nothing
// the style provides) still render over an honest base. The `styleLoad` issue
// line stays up while this is on screen: the fallback is a base map, not a
// claim that the tiles came back.
//
// `version: 8` is the style-spec version MapLibre natively consumes; the rest
// is deliberately the smallest legal style. Nothing here may ever name a URL:
// a fallback that needs the network is not a fallback (spec-pinned).

/**
 * The bundled offline base style: a plain background, no sources, no
 * external references of any kind. Compared by reference to detect "the
 * fallback is showing", so it must stay this one frozen object.
 */
export const OFFLINE_FALLBACK_MAP_STYLE: Readonly<{
  version: 8;
  name: string;
  sources: Record<string, never>;
  layers: ReadonlyArray<Record<string, unknown>>;
}> = Object.freeze({
  version: 8,
  name: 'sbt-offline-fallback',
  sources: {},
  layers: [
    {
      id: 'sbt-offline-background',
      type: 'background',
      // neutral-200: light enough that the dark stop dots and the amber bus
      // stay legible, grey enough not to read as a loaded street map.
      paint: { 'background-color': '#e7e5e4' },
    },
  ],
});

/** True when `style` is the bundled offline fallback (reference identity). */
export function isOfflineFallbackStyle(style: unknown): boolean {
  return style === OFFLINE_FALLBACK_MAP_STYLE;
}

/**
 * A re-issueable copy of a style object for a **re-set retry** (R3).
 *
 * `use-map-style.ts` passes the style to the Map as a prop, and the engine
 * bridge (`@maplibre/maplibre-react-native` `Map.tsx`) forwards it as
 * `JSON.stringify(mapStyle)` — so two objects with the same content produce
 * the SAME string, React's prop diff sees no change, and the native view is
 * never asked to load the style again. A retry that re-sets the identical
 * object would silently do nothing; a root-level `metadata` entry is legal
 * style spec and is the one byte-honest way to make the retried string
 * differ without changing what the style means.
 */
export function restyleForRetry(
  style: Record<string, unknown>,
  retryGeneration: number,
): Record<string, unknown> {
  const metadata =
    style['metadata'] !== null &&
    typeof style['metadata'] === 'object' &&
    !Array.isArray(style['metadata'])
      ? (style['metadata'] as Record<string, unknown>)
      : {};
  return {
    ...style,
    metadata: { ...metadata, 'sbt:retry-generation': retryGeneration },
  };
}

/** A serializable `TransformRequestManager` rewrite: raw fontstack → encoded. */
export interface GlyphUrlTransform {
  /** Stable across runs — the manager keys transforms by id. */
  id: string;
  /** Matches the raw (unencoded) form only, so applying twice is a no-op. */
  find: string;
  replace: string;
}

/** The result of diagnosing (and, when needed, repairing) a style JSON. */
export interface StyleInspection {
  /** The style to load — the input, with `glyphs` repaired when required. */
  style: Record<string, unknown>;
  /** The glyphs template in force (`null` only for a non-object style). */
  glyphsTemplate: string | null;
  /** Unique `text-font` stacks of the style's symbol layers, in order. */
  fontStacks: string[];
  /** True when the input's `glyphs` template was missing or unsafe. */
  glyphsRepaired: boolean;
}

/** Percent-encodes a fontstack path segment: spaces only, commas preserved. */
export function encodeFontStack(fontStack: string): string {
  return fontStack
    .split(',')
    .map((name) => name.trim().split(' ').join('%20'))
    .join(',');
}

/**
 * The glyph URL to probe for one stack — the exact form the engine should
 * request (`Noto%20Sans%20Regular`, range `0-255`).
 */
export function buildGlyphProbeUrl(template: string, fontStack: string): string {
  return template
    .replace('{fontstack}', encodeFontStack(fontStack))
    .replace('{range}', '0-255');
}

/** Collects the unique `text-font` stacks declared by the style's symbol layers. */
export function collectTextFontStacks(style: unknown): string[] {
  const layers = (style as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return [];
  const stacks: string[] = [];
  for (const layer of layers) {
    const candidate = layer as {
      type?: unknown;
      layout?: { 'text-font'?: unknown };
    };
    if (candidate?.type !== 'symbol') continue;
    const font = candidate.layout?.['text-font'];
    if (!Array.isArray(font)) continue;
    const stack = font.filter((entry): entry is string => typeof entry === 'string').join(',');
    if (stack !== '' && !stacks.includes(stack)) stacks.push(stack);
  }
  return stacks;
}

/**
 * Diagnoses a style JSON and repairs its `glyphs` template when missing or
 * non-https (a plaintext font request would leak positions to the wire — the
 * same rule `resolveMapStyleUrl` enforces for tiles). Repair injects the
 * canonical OpenFreeMap fonts endpoint, because that is where the style
 * family's Noto Sans stacks actually live.
 */
export function inspectMapStyle(styleJson: unknown): StyleInspection {
  if (styleJson === null || typeof styleJson !== 'object' || Array.isArray(styleJson)) {
    return { style: {}, glyphsTemplate: null, fontStacks: [], glyphsRepaired: false };
  }
  const style = styleJson as Record<string, unknown>;
  const raw = typeof style['glyphs'] === 'string' ? (style['glyphs'] as string) : null;
  const usable =
    raw !== null &&
    raw.startsWith('https://') &&
    raw.includes('{fontstack}') &&
    raw.includes('{range}');
  const glyphsTemplate = usable ? raw : OPENFREEMAP_GLYPHS_TEMPLATE;
  return {
    style: usable ? style : { ...style, glyphs: glyphsTemplate },
    glyphsTemplate,
    fontStacks: collectTextFontStacks(style),
    glyphsRepaired: !usable,
  };
}

/**
 * One `TransformRequestManager` rewrite per stack: the raw fontstack as the
 * engine would put it in the URL path, replaced by its percent-encoded form.
 * `find` matches only the raw form, so the pipeline is idempotent — safe even
 * if a future engine version encodes the segment itself.
 */
export function glyphUrlTransforms(fontStacks: readonly string[]): GlyphUrlTransform[] {
  return fontStacks.map((stack, index) => ({
    id: `sbt-glyph-${index}`,
    find: stack,
    replace: encodeFontStack(stack),
  }));
}
