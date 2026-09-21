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
 * The default style: OpenFreeMap's public "liberty" style.
 *
 * No key, no registration, no billing — https://openfreemap.org.
 * Attribution is rendered by MapLibre from the style JSON itself.
 */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

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
