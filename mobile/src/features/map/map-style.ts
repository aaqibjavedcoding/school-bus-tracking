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
 * The default style: OpenFreeMap's public "liberty" style.
 *
 * No key, no registration, no limits advertised by the provider
 * (https://openfreemap.org); attribution "OpenFreeMap © OpenMapTiles, Data
 * from OpenStreetMap" is carried by MapLibre from the style JSON itself.
 */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

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
