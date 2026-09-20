import type { RuntimeEnvironment } from '../../lib/runtime-environment.ts';

/**
 * What the native map surface area of a tracking screen should render.
 *
 * The map engine is MapLibre (`@maplibre/maplibre-react-native`) — a custom
 * native module, not part of the Expo SDK. Inside the **Expo Go app** (every
 * platform) there is therefore no engine to render tiles with: the old
 * provider at least ran on iOS, but MapLibre runs nowhere in the Go shell.
 *
 * Instead of a blank box the surface shows a labelled panel that names the
 * cause. The decision is a pure function of the runtime facts (D1) and the
 * data the map would draw, so it is pinned by `map-surface-mode.spec.ts`
 * under plain `node --test` — no React, no native modules.
 */
export type MapSurfaceMode =
  | /** The native map can render tiles here. */
    'map' /** The map engine cannot exist in this runtime (Expo Go, any platform). */
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
  if (!runtime.nativeMapAvailable) {
    return 'needs-dev-build';
  }
  if (!hasCoordinates && !hasFix) {
    return 'no-coordinates';
  }
  return 'map';
}
