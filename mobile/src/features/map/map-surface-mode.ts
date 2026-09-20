import type { RuntimeEnvironment } from '../../lib/runtime-environment.ts';

/**
 * What the native map surface area of a tracking screen should render.
 *
 * From Expo SDK 53 on, **Google Maps is not in the Expo Go app on Android**
 * (Expo SDK 52 changelog, "Deprecations": "Google Maps will no longer be
 * supported in Expo Go for Android in SDK 53 … You can use Google Maps in
 * development builds."). On such a runtime `react-native-maps` renders a blank
 * grey box — historically the whole reason drivers thought the map was "broken"
 * while every other part of the trip worked.
 *
 * Instead the surface shows a labelled panel that names the cause. The
 * decision is a pure function of the runtime facts (D1) and the data the map
 * would draw, so it is pinned by `map-surface-mode.spec.ts` under plain
 * `node --test` — no React, no native modules.
 */
export type MapSurfaceMode =
  | /** The native map can render tiles here. */
    'map' /** The map provider cannot exist in this runtime (Expo Go on Android). */
  | 'needs-dev-build' /** No stops and no fix to draw — the existing "no coordinates" state. */
  | 'no-coordinates';

/**
 * Chooses the surface mode.
 *
 * Precedence: a runtime that cannot show the map at all wins over everything,
 * because no coordinates or fixes will ever make the blank box render — the
 * cause must be said, not left as "this route has no mapped stops yet", which
 * would be a lie on a route that has stops.
 *
 * @param runtime the derived runtime description (`getRuntime()`).
 * @param hasCoordinates whether at least one stop carries coordinates.
 * @param hasFix whether there is a position to draw (live fix / device fix).
 */
export function mapSurfaceMode(
  runtime: RuntimeEnvironment,
  hasCoordinates: boolean,
  hasFix: boolean,
): MapSurfaceMode {
  if (!runtime.googleMapsAvailable) {
    return 'needs-dev-build';
  }
  if (!hasCoordinates && !hasFix) {
    return 'no-coordinates';
  }
  return 'map';
}
