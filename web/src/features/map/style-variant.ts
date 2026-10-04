import { DEFAULT_MAP_STYLE_URL, MAP_STYLE_ENV_VARIABLE, resolveMapStyleUrl } from './map-style.ts';

/**
 * Day/night style selection (web, Session 6 step 3).
 *
 * The app has exactly ONE theme signal — the OS `prefers-color-scheme`
 * media query, read live by `usePrefersColorScheme` (the sibling of the
 * existing `usePrefersReducedMotion` hook, same platform primitive, no new
 * user setting). This module is the pure half of the decision: given that
 * signal, which style URL does the map load?
 *
 * Two rules, pinned by `style-variant.spec.ts`:
 *
 * 1. **A valid `NEXT_PUBLIC_MAP_STYLE_URL` override always wins.** It is the
 *    self-hosting escape hatch (docs/live-tracking-map.md → "Map provider
 *    policy"); a deploy that pins a style must not be silently rethemed. The
 *    override path goes through the EXISTING `resolveMapStyleUrl`, so the
 *    https-/same-origin-only validation and the warn-once behaviour cannot
 *    drift.
 * 2. **Otherwise the theme picks between the two shipped styles** — the
 *    Session 5 `kidbus-day` and the Session 6 `kidbus-night`, identical
 *    sources/sprite/glyphs, palette only (`packages/map-assets`).
 */

export const KIDBUS_NIGHT_STYLE_URL = '/map-styles/kidbus-night.json';

/** The app's existing theme signal, reduced to what the decision needs. */
export type MapColorScheme = 'light' | 'dark';

/** Which shipped style the theme asks for (override already accounted for). */
export function defaultStyleUrlForScheme(scheme: MapColorScheme): string {
  return scheme === 'dark' ? KIDBUS_NIGHT_STYLE_URL : DEFAULT_MAP_STYLE_URL;
}

/**
 * The full selection: a set, non-blank override resolves exactly as before
 * (verbatim when valid, warn-once + day default when not); a missing/blank
 * one defers to the theme.
 */
export function resolveThemedMapStyleUrl(
  env: Record<string, string | undefined>,
  scheme: MapColorScheme,
): string {
  const raw = env[MAP_STYLE_ENV_VARIABLE];
  if (raw !== undefined && raw.trim() !== '') {
    return resolveMapStyleUrl(env);
  }
  return defaultStyleUrlForScheme(scheme);
}
