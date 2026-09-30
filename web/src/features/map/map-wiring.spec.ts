import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * The web map's *wiring* invariants, as a source scanner.
 *
 * There is no React renderer in this repo (the web specs run under plain
 * `node --test --experimental-strip-types`, which cannot even parse JSX), so
 * a filesystem assertion is the idiom used for structural rules — the same
 * shape as `mobile/src/features/map/bus-marker-invariants.spec.ts`.
 *
 * Both defects fixed here were pure wiring, and both are easy to reintroduce
 * with a one-line edit that no unit test on the pure modules would catch:
 *
 * - **A.** the bus-marker effect must depend on map *readiness*, not merely
 *   return early when the map is missing — otherwise a map created after the
 *   first fix never gets a bus;
 * - **B.** a MapLibre `error` event must go through the policy module, never
 *   straight to "Map failed to load".
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

const mapView = read('src/features/map/MapViewInner.tsx');
const tripTracker = read('src/features/tracking/TripTracker.tsx');
const connectionIndicator = read('src/features/tracking/ConnectionIndicator.tsx');

/** Every `useEffect` dependency array in the file, as written. */
function dependencyArrays(source: string): string[] {
  return [...source.matchAll(/\n\s*\}, \[([^\]]*)\]\);/g)].map((match) => match[1]);
}

describe('defect A — map readiness is an input, not an early return', () => {
  test('there is an explicit readiness signal', () => {
    assert.match(
      mapView,
      /const \[mapReady, setMapReady\] = useState\(false\)/,
      'the map has no React-visible readiness signal, so no effect can wait for it',
    );
  });

  test('it is set inside the load handler and cleared when the map is torn down', () => {
    assert.match(mapView, /const onStyleReady = \(\) => \{[\s\S]*?setMapReady\(true\);/);
    assert.match(mapView, /map\.on\('load', onStyleReady\)/, 'readiness must follow `load`');
    const cleanup = mapView.slice(mapView.indexOf('      stopLoop();\n      map.remove();'));
    assert.match(cleanup, /setMapReady\(false\)/, 'a removed map is not a ready map');
    assert.match(cleanup, /overlaysRef\.current\.reset\(\)/, 'dead marker handles must be dropped');
  });

  test('every overlay write goes through the one shared routine', () => {
    assert.match(mapView, /createOverlaySync</, 'overlays are written by overlay-sync.ts');
    assert.match(
      mapView,
      /syncOverlaysRef\.current\(\);/,
      'the load handler must run the same routine the data effects run',
    );
  });

  test('every effect that calls it also depends on mapReady', () => {
    const syncing = dependencyArrays(mapView).filter((deps) => deps.includes('syncOverlays'));
    assert.ok(syncing.length >= 2, `expected the overlay effects, found ${syncing.length}`);
    for (const deps of syncing) {
      assert.ok(
        /\bmapReady\b/.test(deps),
        `an effect that writes overlays must re-run when the map appears: [${deps}]`,
      );
    }
  });

  test('the camera fit cannot be burned before a camera exists', () => {
    // `data-available` flips `hasFitted` whether or not a map was there to
    // move, so dispatching it early leaves the bus drawn but off-screen.
    const fits = dependencyArrays(mapView).filter((deps) => /mappedStops\.length/.test(deps));
    assert.ok(fits.length >= 1);
    for (const deps of fits) assert.match(deps, /\bmapReady\b/);
  });

  test('the bus marker asks for a fit the first time it is created', () => {
    assert.match(
      mapView,
      /result\.busMarkerCreated && !followRef\.current\.hasFitted[\s\S]{0,120}dispatch\(\{ type: 'data-available' \}\)/,
      'a bus that appears after the fit would otherwise never be framed',
    );
  });

  test('the old fix-only dependency array is gone for good', () => {
    assert.doesNotMatch(
      mapView,
      /\}, \[fix, presentation\.animate, applyFrame, startLoop\]\);/,
      'this exact array is the bug: it never re-runs when the map appears',
    );
  });
});

describe('defect B — a MapLibre error event is not a verdict', () => {
  test('errors are classified by the policy module, never surfaced raw', () => {
    assert.match(mapView, /createMapErrorTracker\(/, 'the policy decides, not the callsite');
    assert.match(mapView, /errorTrackerRef\.current\.record\(event, Date\.now\(\)\)/);
    assert.doesNotMatch(
      mapView,
      /onMapErrorRef\.current\?\.\('Map failed to load'\)/,
      'no unconditional "Map failed to load" may survive in the error handler',
    );
  });

  test('a successful render clears the notice automatically', () => {
    assert.match(mapView, /map\.on\('idle', onMapRecovered as never\)/);
    assert.match(mapView, /map\.on\('styledata', onMapRecovered as never\)/);
    assert.match(mapView, /errorTrackerRef\.current\.recover\(\)/);
  });

  test('the network coming back re-loads the style with no user action', () => {
    assert.match(mapView, /window\.addEventListener\('online', onOnline\)/);
    assert.match(mapView, /window\.removeEventListener\('online', onOnline\)/);
  });

  test('the style is re-set on a bounded backoff while the copy says "retrying"', () => {
    assert.match(mapView, /STYLE_RESET_DELAYS_MS\[styleResetsRef\.current\]/);
    assert.match(mapView, /notice\.kind === 'retrying'\) scheduleStyleReset\(\)/);
  });

  test('TripTracker renders the verdict it is handed, and clears on null', () => {
    assert.match(tripTracker, /useState<MapErrorReport \| null>\(null\)/);
    assert.match(tripTracker, /onMapError=\{setMapError\}/, 'the map owns the clear, not the button');
    assert.match(connectionIndicator, /mapError\.terminal \? 'map-error' : 'map-warning'/);
    assert.match(connectionIndicator, /\{mapError\.message\}/, 'the copy comes from the policy');
    assert.doesNotMatch(
      connectionIndicator,
      /^\s*Map failed to load\s*$/m,
      'the badge must not hard-code the terminal copy for every failure',
    );
  });
});
