/**
 * Which map style the web console loads — and the one product rule that picks it.
 *
 * Mirrors `mobile/src/features/map/map-style.ts` in spirit and contract, but
 * with the web env variable `NEXT_PUBLIC_MAP_STYLE_URL`. The map must never
 * depend on a key, card, billing or metered tier — see
 * `docs/live-tracking-map.md` → "Map provider policy".
 *
 * Pure (no React, no Leaflet/MapLibre imports) so it is testable under
 * `node --test`.
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
 * The attribution the style is known for. Kept in sync with mobile.
 */
export const MAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, Data from OpenStreetMap';

/**
 * Env variable that overrides the default style on web.
 */
export const MAP_STYLE_ENV_VARIABLE = 'NEXT_PUBLIC_MAP_STYLE_URL';

let warnedAboutNonHttpsStyle = false;

/**
 * Resolves the style URL the map will load.
 *
 * - unset/blank → default
 * - https://… → that value verbatim (trimmed)
 * - anything else → one-time warning + default
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
    console.warn(
      `[map-style] ${MAP_STYLE_ENV_VARIABLE} must be an https:// URL ` +
        '(tile traffic carries GPS positions and must never ride plain http). ' +
        `Falling back to the default style: ${DEFAULT_MAP_STYLE_URL}`,
    );
  }
  return DEFAULT_MAP_STYLE_URL;
}

/** Test seam: reset warning state. */
export function __resetMapStyleWarningsForTests(): void {
  warnedAboutNonHttpsStyle = false;
}
