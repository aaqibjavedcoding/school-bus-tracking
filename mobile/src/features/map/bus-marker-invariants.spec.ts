import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
const readBinary = (path: string): Buffer => readFileSync(`${process.cwd()}/${path}`);

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

  test('gates the moving cone and pulse through the shared 3 km/h motion threshold', () => {
    assert.match(marker, /MOTION_THRESHOLDS\.headingMinSpeedKmh/);
    assert.match(marker, /Animated\.loop/, 'live movement gets a gentle presence halo');
    assert.match(marker, /showPulse = liveMoving && !reducedMotion/);
    assert.match(marker, /<BusMarkerGraphic desaturated=\{!animate\}/);
    assert.match(marker, /The shadow is intentionally outside the rotated bus group/);
  });

  test('gives the marker a higher draw order than the stop layer', () => {
    // No zIndex in MapLibre — tree order IS the z-order, so the bus must
    // render after the stops. The stops are now ONE GeoJSON layer (see
    // `stop-layer.ts`) in the shared surface, so the ordering is asserted
    // there: the `sbt-stops` source must appear before the `<BusMarker`.
    const surface = read('src/features/map/LiveMapSurface.tsx');
    const stopsAt = surface.indexOf('id="sbt-stops"');
    const busAt = surface.indexOf('<BusMarker');
    assert.ok(stopsAt !== -1 && busAt !== -1, 'stop layer and bus marker not found');
    assert.ok(busAt > stopsAt, 'the bus must render after the stops, or it draws below them');
  });
});

describe('native bus map invariants', () => {
  // The map itself is ONE surface now: `LiveMapSurface.tsx` renders the
  // engine, camera, layers and controls for every role, and the wrappers
  // (`BusMap.tsx` observer, `DriverTripMap.tsx` driver) own only their panels.
  // Surface-level invariants are asserted against the surface; the freshness
  // and accuracy-ring invariants stay against `BusMap.tsx`, where that
  // derivation lives.
  const surface = read('src/features/map/LiveMapSurface.tsx');
  const observer = read('src/features/map/BusMap.tsx');
  const driver = read('src/features/crew/DriverTripMap.tsx');

  test('never drives the camera from props (the controlled-region bug stays dead)', () => {
    // MapLibre's `Map` takes no region prop; the camera is a `<Camera>` child
    // read once for its initial state, then moved only imperatively.
    assert.match(surface, /initialViewState=\{initialCamera \?\? undefined\}/);
    assert.doesNotMatch(
      surface,
      /flyTo\(|jumpTo\(|easeTo\(|setStop\(/,
      'no imperative camera call in the map component',
    );
  });

  test('keeps a single style URL, resolved by the policy module', () => {
    // The style pipeline (`use-map-style.ts`) is the one place that resolves
    // the URL via the policy module (`map-style.ts`) and feeds the map — the
    // component never carries a tile/style endpoint of its own.
    const pipeline = read('src/features/map/use-map-style.ts');
    assert.match(pipeline, /resolveMapStyleUrl\(/, 'the style URL must come from map-style.ts');
    assert.match(surface, /useMapStyle\(/, 'the surface takes its style from the pipeline');
    assert.match(surface, /mapStyle=\{mapStyle\}/);
  });

  /**
   * Deep-fix R3: a `styleLoad` failure used to be permanent — one flaky
   * first fetch on mobile data left a dead map and a red line until the app
   * restarted. The surface must route the engine's failure/loaded events
   * through the style pipeline's bounded recovery, never straight at the
   * diagnostics store, and a successful load must clear the line.
   */
  test('routes engine load events through the pipeline recovery, on the one shared map', () => {
    // Both role variants (driver and observer) render this one surface, so
    // pinning it here covers every map in the app; the wrappers must not
    // render their own `<Map`.
    const source = read('src/features/map/LiveMapSurface.tsx');
    assert.match(
      source,
      /onDidFailLoadingMap=\{onStyleLoadFailed\}/,
      "the engine's failure must run the bounded re-set policy",
    );
    assert.match(
      source,
      /onDidFinishLoadingMap=\{\(\) => \{\s*onStyleLoaded\(\);\s*onMapReady\(\);\s*\}\}/,
      'a successful load clears the line before the camera re-fits',
    );
    assert.doesNotMatch(
      source,
      /onDidFailLoadingMap=\{\(\) => reportMapIssue/,
      'bare reporting has no recovery — the pipeline owns this now',
    );
    for (const wrapper of [observer, driver]) {
      assert.doesNotMatch(
        wrapper,
        /onDidFailLoadingMap/,
        'the wrappers must render the shared surface, not their own map',
      );
    }
  });

  test('the pipeline retries fetches with bounded backoff and clears on recovery', () => {
    const pipeline = read('src/features/map/use-map-style.ts');
    assert.match(pipeline, /runWithBackoff\(/, 'the fetch runs under the bounded policy');
    assert.match(
      pipeline,
      /planStyleLoadFailure\(/,
      'native failures are decided by the pure policy, not inline',
    );
    assert.match(pipeline, /clearMapIssue\('styleLoad'\)/, 'a real load clears the style line');
    assert.match(pipeline, /clearMapIssue\('glyphs'\)/, 'a verified probe clears the label line');
    assert.match(
      pipeline,
      /OFFLINE_FALLBACK_MAP_STYLE/,
      'total exhaustion drops to the bundled offline base style',
    );
    // The offline fallback rendering is not the tiles coming back, so the
    // degraded chip must survive it. Note which code that is now: the map
    // *works* while the bundled fallback draws, so the state it advertises is
    // `offlineFallback` (neutral, retryable) and not the terminal `styleLoad`
    // — which is exactly why `styleLoad` is cleared unconditionally by a load
    // that succeeded (something rendered) one line above.
    assert.match(
      pipeline,
      /if \(!showingFallback\) clearMapIssue\('offlineFallback'\)/,
      'the fallback loading is not a recovery — the degraded chip must stay',
    );
    assert.match(
      pipeline,
      /reportMapIssue\('offlineFallback'\)/,
      'a working offline map is degraded, never "failed"',
    );
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
    assert.match(surface, /onRegionIsChanging=\{onRegionChange\}/, 'region change wired');
    assert.match(
      surface,
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

  test('every native map role shares ONE camera implementation', () => {
    // The driver and observer variants are both `LiveMapSurface`, so there is
    // exactly one binding — and the thin wrappers must not grow their own.
    assert.match(surface, /useFollowCamera\(/, 'the surface must not roll its own camera');
    for (const [name, wrapper] of [
      ['BusMap', observer],
      ['DriverTripMap', driver],
    ] as const) {
      assert.doesNotMatch(
        wrapper,
        /useFollowCamera\(|reduceFollowCamera/,
        `${name} must delegate the camera to the shared surface`,
      );
      assert.match(wrapper, /<LiveMapSurface/, `${name} must render the shared surface`);
    }
  });

  test('keeps map controls clear of provider attribution', () => {
    // MapLibre renders the attribution and logo in the bottom corners, so
    // nothing may sit at the bottom.
    assert.match(observer, /top: spacing\.sm,\s*\n\s*left: spacing\.sm,/, 'status panel top-left');
    assert.match(
      surface,
      /top: spacing\.sm,\s*\n\s*right: spacing\.sm,/,
      'follow control top-right',
    );
    for (const [name, source] of [
      ['LiveMapSurface', surface],
      ['BusMap', observer],
      ['DriverTripMap', driver],
    ] as const) {
      assert.doesNotMatch(
        source,
        /bottom:\s*spacing/,
        `${name}: no control anchored to the bottom edge`,
      );
    }
  });

  test('keeps the attribution and the logo visible (the OSM-derived tiles require it)', () => {
    assert.match(surface, /\battribution\b/, 'attribution ornament on');
    assert.match(surface, /\blogo\b/, 'logo ornament on');
  });

  test('keeps a real touch target on the follow control', () => {
    assert.match(surface, /minHeight: 44/);
    assert.match(surface, /minWidth: 44/);
  });

  test('hides the decorative marker graphic from screen readers', () => {
    const graphic = read('src/features/map/BusMarkerGraphic.tsx');
    assert.match(graphic, /accessibilityElementsHidden/);
    assert.match(graphic, /importantForAccessibility="no-hide-descendants"/);
  });

  test('never claims live motion on non-live data', () => {
    assert.match(observer, /presentation\.mayReportLiveMotion/);
    assert.match(observer, /t\('map\.status\.lastKnown'\)/);
  });

  test('keeps the stop connectors honest about not being a route', () => {
    assert.match(surface, /t\('map\.routeNotice'\)/);
  });

  test('draws the accuracy ring centred on the reported fix', () => {
    assert.match(observer, /accuracyCirclePolygon\(/, 'the ring is the measurement, not the tween');
    assert.match(observer, /latitude: fix\.latitude, longitude: fix\.longitude/);
  });
});

describe('the marker tracks the drawn route line (R4)', () => {
  const marker = read('src/features/map/BusMarker.tsx');

  test('the marker builds one snapper per route and hands it to the motion machine', () => {
    assert.match(marker, /createRouteSnapper\(route\)/, 'the port comes from route-snap.ts');
    assert.match(marker, /snapToRoute,/, 'and reaches useBusMarkerMotion');
  });

  test('both native map variants feed the marker the same polyline they draw', () => {
    const source = read('src/features/map/LiveMapSurface.tsx');
    assert.match(
      source,
      /route=\{route\}/,
      'the BusMarker must get the route for its display snap',
    );
    assert.match(
      source,
      /route=\{routeCoordinates\}/,
      "the surface's route IS the drawn stop-to-stop polyline",
    );
  });

  test('the hook applies the port to the machine, never to the fix', () => {
    const hook = read('src/features/map/useBusMarkerMotion.ts');
    assert.match(hook, /motion\.setSnapToRoute\(snapToRoute\)/);
    assert.doesNotMatch(hook, /fix = fix && snapToRoute/, 'the raw fix must never be rewritten');
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

describe('the marker is the bundled bus sprite', () => {
  const graphic = read('src/features/map/BusMarkerGraphic.tsx');

  test('renders the bundled PNG at exactly the pinned 26 x 42 box', () => {
    assert.match(
      graphic,
      /require\('\.\.\/\.\.\/\.\.\/assets\/bus-marker\.png'\)/,
      'the marker is the bundled PNG — RN resolves @2x/@3x from this one require',
    );
    assert.match(
      graphic,
      /width: BUS_MARKER_WIDTH,\n\s*height: BUS_MARKER_HEIGHT,/,
      'the image is drawn at exactly the pinned box, so nothing resamples at render time',
    );
  });

  test('rasterises the density sprites from the shared SVG and keeps the master out of app assets', () => {
    const generator = read('scripts/generate-assets.mjs');
    assert.match(generator, /BUS_MARKER_ART_SVG/);
    assert.match(generator, /busMarkerPng/);
    assert.match(generator, /@school-bus-tracking\/map-assets/);
    assert.equal(existsSync('assets/gen/bus-master.png'), false, 'the 1.6 MB master must not ship');
    assert.equal(
      existsSync('scripts/assets/bus-master.png'),
      true,
      'the build-time master was moved',
    );
  });

  test('the bundled sprite ships @1x/@2x/@3x at exactly the pinned pixel sizes', () => {
    // Parse the real IHDR of each file so a regenerated, mangled or dropped
    // asset fails HERE instead of shipping blurry — or silently falling back
    // to a hi-res file — on cheap phones.
    const expected: [string, number, number][] = [
      ['assets/bus-marker.png', 26, 42],
      ['assets/bus-marker@2x.png', 52, 84],
      ['assets/bus-marker@3x.png', 78, 126],
    ];
    for (const [file, width, height] of expected) {
      const bytes = readBinary(file);
      assert.ok(
        bytes.length > 25 && bytes.readUInt32BE(12) === 0x49484452,
        `${file}: a PNG with an IHDR`,
      );
      assert.equal(bytes.readUInt32BE(16), width, `${file}: width`);
      assert.equal(bytes.readUInt32BE(20), height, `${file}: height`);
      assert.equal(bytes[25], 6, `${file}: RGBA (alpha — the marker floats over tiles)`);
    }
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
