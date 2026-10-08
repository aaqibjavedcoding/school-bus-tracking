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
 * `resolveMapStyleUrl` is the single place that validates that optional URL
 * override, so nothing else in the app may hard-code a style endpoint. With no
 * override, native MapLibre receives one of the bundled style objects instead.
 *
 * ### The sprite (and why its URL is resolved here)
 *
 * The bundled KidBus styles name the POI sprite the same way the web app serves
 * it: `sprite: '/map-sprites/kidbus'` — root-relative, because that is what
 * makes it same-origin and CSP-clean on web. **Native MapLibre cannot resolve a
 * root-relative URL** (there is no document origin), and the sprite is not an
 * asset Metro could bundle: MapLibre fetches `<sprite>.json` and `<sprite>.png`
 * by appending the extensions to whatever string it is given, so a single
 * bundled PNG would point at an index that is not beside it. Servability
 * therefore means *serving* it: this module resolves the path against the API
 * origin — the same origin the app already trusts for every other request, and
 * the origin the web app serves the identical, byte-for-byte sprite from. No
 * third image host, no key, no second copy of an asset already in this repo.
 *
 * `withNativeSprite` is that resolution: an absolute https sprite is left
 * alone; a root-relative path becomes `<origin>/<path>`; with no usable origin
 * the field is dropped and warned about once (the map still draws every label,
 * it just has no POI icons) — never a fetch of a relative path that could only
 * fail.
 *
 * ### Why https-only
 *
 * A tile request over plain `http` would leak every GPS fix the map makes to
 * the wire in the clear on any network. That is not an acceptable failure
 * mode for a bus-full of children's routes, so a non-https override is
 * rejected (warned once, at bundle time — the value is inlined by Metro, so
 * the process-level warning is the honest one) and the bundled object is used
 * instead. The default object has no style URL to downgrade or resolve.
 *
 * The module is pure — no React, no native imports, no `process` — so every
 * branch is pinned by `map-style.spec.ts` under plain `node --test`.
 */

import {
  KIDBUS_DAY_STYLE,
  KIDBUS_NIGHT_STYLE,
  type KidbusDayStyle,
  type KidbusNightStyle,
} from '@school-bus-tracking/map-assets';

/**
 * The native default is the bundled KidBus style object, not a URL. The day
 * and night objects are shipped with the app; the device's colour scheme picks
 * between them before the object reaches MapLibre. Their vector source and
 * glyphs still use OpenFreeMap's public OpenStreetMap tiles, with no key,
 * account, or billing.
 *
 * `DEFAULT_MAP_STYLE_URL` remains as the URL-policy compatibility value used
 * by `resolveMapStyleUrl` when there is no usable override. It is deliberately
 * empty: the native default is an object, so there is no default URL to fetch
 * and no origin for React Native to resolve. `useMapStyle` never passes this
 * value to MapLibre.
 */
export const BUNDLED_MAP_STYLES: Readonly<{
  day: KidbusDayStyle;
  night: KidbusNightStyle;
}> = {
  day: KIDBUS_DAY_STYLE,
  night: KIDBUS_NIGHT_STYLE,
};

export const DEFAULT_MAP_STYLE = BUNDLED_MAP_STYLES.day;
export const DEFAULT_MAP_STYLE_URL = '';

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
 * Resolves only the optional style URL override.
 *
 * - unset (or blank) `EXPO_PUBLIC_MAP_STYLE_URL` → the bundled-style sentinel;
 * - a value that is `https://…` → that value, verbatim (trimmed);
 * - a same-origin path → that path, for compatibility with the existing
 *   override contract;
 * - anything else (http, a bare hostname, garbage) → a one-time warning plus
 *   the bundled-style sentinel. The native default is selected separately by
 *   `resolveMapStyleInput`, so this function never makes React Native resolve a
 *   root-relative default path.
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
  if (url.startsWith('https://') || url.startsWith('/')) {
    return url;
  }
  if (!warnedAboutNonHttpsStyle) {
    warnedAboutNonHttpsStyle = true;
    // Deliberately no value echo beyond the scheme class: a misconfigured URL
    // is a build error, and the warning goes to the developer, not the phone.
    console.warn(
      `[map-style] ${MAP_STYLE_ENV_VARIABLE} must be an https:// URL or same-origin path ` +
        '(tile traffic carries GPS positions and must never ride plain http). ' +
        'Falling back to the bundled KidBus style object.',
    );
  }
  return DEFAULT_MAP_STYLE_URL;
}

export type MapStyleInput = string | object;
export type BundledMapStyle = KidbusDayStyle | KidbusNightStyle;

/**
 * Selects the source handed to the native style pipeline. A non-blank valid
 * override remains a URL and keeps the existing fetch/inspect/retry path;
 * otherwise the selected bundled object is used directly, with no style JSON
 * request and no origin-dependent URL.
 */
export function resolveMapStyleInput(
  env: Record<string, string | undefined>,
  scheme: 'light' | 'dark' = 'light',
  resolvedUrl?: string,
): MapStyleInput {
  const raw = env[MAP_STYLE_ENV_VARIABLE];
  if (raw === undefined || raw.trim() === '') {
    return scheme === 'dark' ? BUNDLED_MAP_STYLES.night : BUNDLED_MAP_STYLES.day;
  }
  const resolved = resolvedUrl ?? resolveMapStyleUrl(env);
  if (resolved === DEFAULT_MAP_STYLE_URL) {
    return scheme === 'dark' ? BUNDLED_MAP_STYLES.night : BUNDLED_MAP_STYLES.day;
  }
  return resolved;
}

// ── The sprite on native ───────────────────────────────────────────────────
//
// See the module doc: the bundled styles use the same root-relative sprite path
// the web app serves same-origin, and native has no origin to resolve it
// against. These three pure functions are the whole fix; the pipeline in
// `use-map-style.ts` calls `withNativeSprite` with the API origin.

/** The style field that needs an origin on native. */
export const SPRITE_STYLE_FIELD = 'sprite';

/**
 * The origin of an absolute API base URL, or null.
 *
 * Deliberately a regex rather than `new URL`: React Native's `URL` is a partial
 * polyfill whose `origin` is not dependable across versions, and this runs on
 * the phone, not in Node. Any userinfo (`https://user:pass@host`) is stripped —
 * a credential never belongs in an image URL, and a spec pins that.
 */
export function apiOriginFromBaseUrl(apiBaseUrl: string | null | undefined): string | null {
  if (typeof apiBaseUrl !== 'string') return null;
  const match = /^(https?):\/\/([^/?#]+)/i.exec(apiBaseUrl.trim());
  if (match === null) return null;
  const authority = match[2].includes('@')
    ? match[2].slice(match[2].lastIndexOf('@') + 1)
    : match[2];
  if (authority === '') return null;
  return `${match[1].toLowerCase()}://${authority}`;
}

/**
 * Resolves a style `sprite` value for the native engine.
 *
 * - `https://…` (already absolute) → verbatim: a self-hoster's own sprite.
 * - `/path` → `<origin>/path` when an origin is known, else `''`.
 * - anything else (protocol-relative, malformed) → verbatim, so nothing is
 *   rewritten in a way the caller did not ask for.
 *
 * An empty return means "this style cannot name a sprite on native"; the caller
 * drops the field rather than hand the engine a path it cannot fetch.
 */
export function resolveMapSpriteUrl(
  sprite: string,
  assetOrigin: string | null | undefined,
): string {
  if (sprite.startsWith('https://')) return sprite;
  if (!sprite.startsWith('/') || sprite.startsWith('//')) return sprite;
  const origin = apiOriginFromBaseUrl(assetOrigin);
  if (origin === null) return '';
  return `${origin}${sprite}`;
}

let warnedAboutUnresolvableSprite = false;

/**
 * Applies `resolveMapSpriteUrl` to a style for the native engine.
 *
 * Returns the input untouched when there is nothing to do (a URL input, a style
 * with no sprite, an already-absolute sprite), a shallow copy carrying the
 * resolved sprite otherwise, and a copy **without** the field when no origin is
 * known — never a mutated bundled object: `KIDBUS_DAY_STYLE` is a shared module
 * constant and the web build reads the same shape.
 */
export function withNativeSprite(
  style: MapStyleInput,
  assetOrigin: string | null | undefined,
): MapStyleInput {
  if (typeof style !== 'object' || style === null || Array.isArray(style)) return style;
  const candidate = style as Record<string, unknown>;
  const sprite = candidate[SPRITE_STYLE_FIELD];
  if (typeof sprite !== 'string' || sprite === '') return style;
  const resolved = resolveMapSpriteUrl(sprite, assetOrigin);
  if (resolved === sprite) return style;
  if (resolved === '') {
    if (!warnedAboutUnresolvableSprite) {
      warnedAboutUnresolvableSprite = true;
      // No value echo: the sprite path is ours, the origin is the deployment's.
      console.warn(
        '[map-style] the map sprite could not be resolved against an API origin ' +
          '(EXPO_PUBLIC_API_URL unset or unusable), so POI icons will not draw. ' +
          'Labels, stops, the route and the bus are unaffected.',
      );
    }
    const withoutSprite: Record<string, unknown> = { ...candidate };
    delete withoutSprite[SPRITE_STYLE_FIELD];
    return withoutSprite;
  }
  return { ...candidate, [SPRITE_STYLE_FIELD]: resolved };
}

/** Test seam: back to the "never warned" sprite state. */
export function __resetSpriteWarningForTests(): void {
  warnedAboutUnresolvableSprite = false;
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
// The pipeline (`use-map-style.ts`) inspects the bundled object directly or
// fetches an override style JSON in JS, repairs the `glyphs` template if it is
// missing or non-https, rewrites every fontstack request to its encoded form
// via `TransformRequestManager`, probes one real glyph URL to *verify* the
// endpoint answers, and reports every failure into the map-diagnostics store —
// never blank-silent.

/** The canonical OpenFreeMap fonts endpoint, https like everything we load. */
export const OPENFREEMAP_GLYPHS_TEMPLATE =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** What a map issue means for the panels (`map.issue.*` copy keys). */
export type MapStyleIssueCode =
  /**
   * Terminal: nothing renders. Reached only when even the bundled offline
   * fallback style — which needs zero network — failed to load. This is the
   * one code that keeps the red treatment.
   */
  | 'styleLoad'
  /**
   * Degraded but working: the online style could not be fetched, so the
   * bundled offline base style is what the map is drawing. Stops, the route
   * and the bus are all still on screen, so calling this "failed" was a lie.
   * Rendered as a neutral chip with a retry affordance.
   */
  | 'offlineFallback'
  /** Labels cannot draw (the glyph endpoint was probed and did not answer). */
  | 'glyphs';

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
