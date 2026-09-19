import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * Marker anchoring and rotation invariants, as a source scanner.
 *
 * A React Native view tree cannot be rendered under `node --test` — there is no
 * renderer in this repo, and adding one (react-test-renderer + a native stub
 * loader) to assert four props would be a large dependency for a small claim. A
 * filesystem assertion is the idiom this repository already uses for exactly
 * this kind of structural rule (`theme/legibility.spec.ts`,
 * `lib/i18n-literals.spec.ts`, `features/crew/help-routing.spec.ts`).
 *
 * What is being protected is genuinely subtle and easy to regress:
 *
 * - `Marker.rotation` and `Marker.icon` are documented **"iOS: Google Maps
 *   only"** in react-native-maps 1.27.2, and this app ships Google Maps on
 *   Android only. Rotating through the `rotation` prop on iOS would silently do
 *   nothing, and the bus would appear stuck pointing north — a bug no unit test
 *   on the pure modules would ever catch.
 * - Anchoring must be the vehicle **centre** on both providers, or rotation
 *   swings the marker off the GPS coordinate.
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

describe('native bus marker invariants', () => {
  const marker = read('src/features/map/BusMarker.tsx');

  test('anchors at the vehicle centre on both providers', () => {
    assert.match(marker, /anchor=\{\{\s*x:\s*0\.5,\s*y:\s*0\.5\s*\}\}/, 'Google Maps anchor');
    assert.match(marker, /centerOffset=\{\{\s*x:\s*0,\s*y:\s*0\s*\}\}/, 'Apple Maps offset');
  });

  test('rotates natively on Android and via transform elsewhere', () => {
    assert.match(marker, /useNativeRotation = Platform\.OS === 'android'/);
    // iOS must rotate the child view: `rotation` is a no-op on Apple Maps.
    assert.match(marker, /transform: \[\{ rotate: `\$\{heading\}deg` \}\]/);
  });

  test('does not rely on the Google-only `icon` prop', () => {
    assert.doesNotMatch(marker, /\bicon=\{/, 'the bus must be a custom child view, not an image');
  });

  test('stops the Android view snapshotting after the first frame', () => {
    assert.match(marker, /tracksViewChanges=\{tracksViewChanges\}/);
    assert.match(marker, /requestAnimationFrame\(\(\) => setTracksViewChanges\(false\)\)/);
  });

  test('gives the marker a higher z-index than the stop pins', () => {
    const busZ = Number(/zIndex=\{(\d+)\}/.exec(marker)?.[1]);
    const map = read('src/features/map/BusMap.tsx');
    const stopZ = Number(/zIndex=\{(\d+)\}/.exec(map)?.[1]);
    assert.ok(Number.isFinite(busZ) && Number.isFinite(stopZ), 'z-index not found');
    assert.ok(busZ > stopZ, `bus ${busZ} must draw above stops ${stopZ}`);
  });
});

describe('native bus map invariants', () => {
  const map = read('src/features/map/BusMap.tsx');

  test('never passes a controlled `region` prop', () => {
    // The controlled `region` recomputed per fix is the bug this rewrite
    // removes: it re-fitted the route every few seconds and stole the camera
    // from the user. `initialRegion` is fine — the native map reads it once.
    assert.doesNotMatch(map, /^\s*region=\{/m, 'a controlled region prop re-appeared');
    assert.match(map, /initialRegion=\{initialRegion \?\? undefined\}/);
  });

  test('moves the camera without changing zoom', () => {
    assert.match(map, /map\.animateCamera\(\s*\{ center:/, 'follow pans by centre only');
    assert.doesNotMatch(
      map.slice(map.indexOf('const panTo'), map.indexOf('const maybeFollowPan')),
      /zoom:/,
      'a follow pan must never touch zoom',
    );
  });

  test('detects user gestures through gesture attribution, pan drag and zoom delta', () => {
    assert.match(map, /onPanDrag=\{onUserGesture\}/, 'Apple Maps has no isGesture');
    assert.match(map, /details\.isGesture === true/, 'Google Maps attribution');
    assert.match(map, /isZoomGesture\(expectedDeltaRef\.current, region\.latitudeDelta\)/);
  });

  test('keeps map controls clear of provider attribution', () => {
    // Google's logo/attribution is bottom-left, Apple's legal button and
    // Leaflet's attribution are bottom-right — so nothing may sit at the bottom.
    assert.match(map, /top: spacing\.sm,\s*\n\s*left: spacing\.sm,/, 'status panel top-left');
    assert.match(map, /top: spacing\.sm,\s*\n\s*right: spacing\.sm,/, 'follow control top-right');
    assert.doesNotMatch(map, /bottom:\s*spacing/, 'no control anchored to the bottom edge');
  });

  test('keeps a real touch target on the follow control', () => {
    assert.match(map, /minHeight: 44/);
    assert.match(map, /minWidth: 44/);
  });

  test('hides the decorative marker graphic from screen readers', () => {
    const graphic = read('src/features/map/BusMarkerGraphic.tsx');
    assert.match(graphic, /accessibilityElementsHidden/);
    assert.match(graphic, /importantForAccessibility="no-hide-descendants"/);
  });

  test('never claims live motion on non-live data', () => {
    assert.match(map, /presentation\.mayReportLiveMotion/);
    assert.match(map, /t\('map\.status\.lastKnown'\)/);
  });

  test('keeps the stop connectors honest about not being a route', () => {
    assert.match(map, /t\('map\.routeNotice'\)/);
  });
});

describe('frame updates stay off the screen render loop', () => {
  const hook = read('src/features/map/useBusMarkerMotion.ts');

  test('caps the frame rate with the shared constant', () => {
    assert.match(hook, /FRAME_MIN_INTERVAL_MS/);
  });

  test('feeds the camera imperatively instead of through React state', () => {
    assert.match(hook, /onFrameRef\.current\?\.\(rendered\)/);
  });

  test('cancels frames on unmount, backgrounding and trip switch', () => {
    assert.match(hook, /AppState\.addEventListener\('change'/);
    assert.match(hook, /motion\.cancelAnimation\(\)/);
    assert.match(hook, /motion\.reset\(\)/);
  });
});
