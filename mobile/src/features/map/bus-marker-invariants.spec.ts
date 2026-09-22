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
 * What is being protected is genuinely subtle and easy to regress (the
 * MapLibre equivalents of the old provider's traps):
 *
 * - MapLibre annotations have **no native rotation prop** — the child view IS
 *   the marker. If the bus stopped rotating through the child's `transform`,
 *   it would sit pointing north forever — a bug no unit test on the pure
 *   modules would ever catch.
 * - On Android the child is rasterised offscreen into a bitmap, and a
 *   transform change never triggers a layout change — so the rotation must be
 *   re-captured with the annotation's `refresh()`, or the bus would turn only
 *   in the live (iOS) view and not in the Android bitmap.
 * - Anchoring must be the vehicle **centre** (`anchor="center"`), or rotation
 *   swings the marker off the GPS coordinate.
 * - The bus must draw above the stop dots: MapLibre annotations have no
 *   zIndex, so z-order is tree order (bus after stops).
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

describe('native bus marker invariants', () => {
  const marker = read('src/features/map/BusMarker.tsx');

  test('anchors at the vehicle centre', () => {
    assert.match(marker, /anchor="center"/, 'rotation must happen around the GPS coordinate');
  });

  test('rotates through the child view transform (MapLibre has no native rotation prop)', () => {
    assert.match(marker, /transform: \[\{ rotate: `\$\{heading\}deg` \}\]/);
  });

  test('re-captures the Android bitmap whenever the heading changes', () => {
    // A transform never fires a layout change, so the offscreen raster on
    // Android must be refreshed explicitly when — and only when — the heading
    // changes (iOS renders the child live; refresh() is a no-op there).
    assert.match(marker, /annotationRef\.current\?\.refresh\(\)/);
    const effect = marker.slice(marker.indexOf('hasCommittedRef'));
    assert.match(effect, /}, \[heading\]\);/, 'the refresh must be keyed on the heading');
  });

  test('does not rely on a static icon image', () => {
    assert.doesNotMatch(
      marker,
      /\biconImage=|\bicon=\{/,
      'the bus must be a custom child view, not an image',
    );
    assert.match(marker, /<BusMarkerGraphic/, 'and it must be the one shared graphic');
  });

  test('gives the marker a higher draw order than the stop pins', () => {
    // No zIndex in MapLibre — annotation order in the tree IS the z-order, so
    // the bus must render after every stop.
    const map = read('src/features/map/BusMap.tsx');
    const stopsAt = map.indexOf('{stops.map((stop) => (');
    const busAt = map.indexOf('<BusMarker');
    assert.ok(stopsAt !== -1 && busAt !== -1, 'stop markers and bus marker not found');
    assert.ok(busAt > stopsAt, 'the bus must render after the stops, or it draws below them');
  });
});

describe('native bus map invariants', () => {
  const map = read('src/features/map/BusMap.tsx');

  test('never drives the camera from props (the controlled-region bug stays dead)', () => {
    // MapLibre's `Map` takes no region prop; the camera is a `<Camera>` child
    // read once for its initial state, then moved only imperatively.
    assert.match(map, /initialViewState=\{initialCamera \?\? undefined\}/);
    assert.doesNotMatch(
      map,
      /flyTo\(|jumpTo\(|easeTo\(|setStop\(/,
      'no imperative camera call in the map component',
    );
  });

  test('keeps a single style URL, resolved by the policy module', () => {
    assert.match(map, /resolveMapStyleUrl\(/, 'the style URL must come from map-style.ts');
    assert.match(map, /mapStyle=\{MAP_STYLE_URL\}/);
  });

  /**
   * The camera *wiring* lives in `follow-camera-controller.ts` (pure) and
   * `useFollowCamera.ts` (the React binding), so both native maps — the
   * observer map here and the Driver Trip map — run one implementation.
   * These guards follow the code to its home; what they protect is unchanged,
   * and `follow-camera-controller.spec.ts` asserts the same behaviours against
   * a fake camera as well.
   */
  test('moves the camera without changing zoom', () => {
    const controller = read('src/features/map/follow-camera-controller.ts');
    const pan = controller.slice(
      controller.indexOf('function panTo'),
      controller.indexOf('function maybeFollowPan'),
    );
    assert.match(pan, /deps\.port\.animateCamera\(/, 'follow pans go through the camera port');
    assert.doesNotMatch(pan, /zoom:/, 'a follow pan must never touch zoom');
    // A zoom may only be *added* when one was asked for explicitly.
    const hook = read('src/features/map/useFollowCamera.ts');
    assert.match(hook, /if \(options\.zoom !== undefined\) stop\.zoom = options\.zoom;/);
  });

  test('detects user gestures through the engine attribution, kept fallback and all', () => {
    // MapLibre reports `userInteraction` on its region events on both
    // platforms; the binding reads it, and the pure controller still carries
    // the provider-independent zoom-delta fallback.
    const hook = read('src/features/map/useFollowCamera.ts');
    assert.match(hook, /view\.userInteraction === true/, 'gesture attribution from the engine');
    assert.match(map, /onRegionIsChanging=\{onRegionChange\}/, 'region change wired');
    assert.match(
      map,
      /onRegionDidChange=\{onRegionChangeComplete\}/,
      'region change complete wired',
    );
    const controller = read('src/features/map/follow-camera-controller.ts');
    assert.match(controller, /details\.isGesture === true/, 'attribution path');
    assert.match(
      controller,
      /isZoomGesture\(expectedDelta, region\.latitudeDelta\)/,
      'the provider-independent zoom fallback',
    );
  });

  test('both native maps share one camera implementation', () => {
    for (const file of ['src/features/map/BusMap.tsx', 'src/features/crew/DriverTripMap.tsx']) {
      const source = read(file);
      assert.match(source, /useFollowCamera\(/, `${file} must not roll its own camera`);
      assert.doesNotMatch(
        source,
        /reduceFollowCamera/,
        `${file} must not drive the camera reducer directly`,
      );
    }
  });

  test('keeps map controls clear of provider attribution', () => {
    // MapLibre renders the attribution and logo in the bottom corners, so
    // nothing may sit at the bottom.
    assert.match(map, /top: spacing\.sm,\s*\n\s*left: spacing\.sm,/, 'status panel top-left');
    assert.match(map, /top: spacing\.sm,\s*\n\s*right: spacing\.sm,/, 'follow control top-right');
    assert.doesNotMatch(map, /bottom:\s*spacing/, 'no control anchored to the bottom edge');
  });

  test('keeps the attribution and the logo visible (the OSM-derived tiles require it)', () => {
    assert.match(map, /\battribution\b/, 'attribution ornament on');
    assert.match(map, /\blogo\b/, 'logo ornament on');
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

  test('draws the accuracy ring centred on the reported fix', () => {
    assert.match(map, /accuracyCirclePolygon\(/, 'the ring is the measurement, not the tween');
    assert.match(map, /latitude: fix\.latitude, longitude: fix\.longitude/);
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

describe('the marker has room to turn', () => {
  const marker = read('src/features/map/BusMarker.tsx');
  const graphic = read('src/features/map/BusMarkerGraphic.tsx');

  /**
   * A 26 × 42 bus rotated 45° occupies about 48 × 48 dp. React Native clips a
   * child at its parent's bounds, and on Android the annotation *is* a bitmap of
   * the child's measured frame — so a box sized to the unrotated footprint shaves
   * the corners off the bus on every diagonal heading. The marker view is
   * therefore sized to the footprint's diagonal, and the rotation lives on an
   * inner view so the measured frame stays axis-aligned.
   */
  test('sizes the marker box to the rotated footprint, not the straight one', () => {
    assert.match(
      graphic,
      /BUS_MARKER_ROTATION_BOX = Math\.ceil\(\s*Math\.hypot\(BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT\)/,
      'the box must be derived from the footprint, never hard-coded to 26 × 42',
    );
    assert.match(marker, /width: BUS_MARKER_ROTATION_BOX/);
    assert.match(marker, /height: BUS_MARKER_ROTATION_BOX/);
    assert.match(marker, /overflow: 'visible'/);
    assert.match(marker, /transform: \[\{ rotate: `\$\{heading\}deg` \}\]/);
  });
});
