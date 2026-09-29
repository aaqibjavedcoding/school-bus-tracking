import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * What the **installed** map engine actually does — asserted against the
 * package in `node_modules`, not against our own source.
 *
 * Every other map spec here tests our policy with a fake camera. That leaves
 * one class of bug completely uncovered, and it is the class that produced two
 * field reports: *the engine does not behave the way our policy assumes.* The
 * camera followed nothing on Android and the map "ate" no gestures inside the
 * trip screen's ScrollView, and both were properties of
 * `@maplibre/maplibre-react-native@11.4.0` rather than of our reducer.
 *
 * This suite pins the three engine facts the driver map depends on. When a
 * version bump changes one of them, this fails with the reason — instead of a
 * driver discovering it on a run:
 *
 * 1. the region events carry `center`, `zoom` and `userInteraction`
 *    (`useFollowCamera` reads all three);
 * 2. Android's `userInteraction` **also covers the app's own camera
 *    animations**, which is why the controller needs its self-move window;
 * 3. Android only claims the touch stream (`requestDisallowInterceptTouchEvent`)
 *    while its `dragPan` prop is explicitly on, which is why `DriverTripMap`
 *    passes it rather than relying on the documented default.
 *
 * It reads the package's shipped sources. That is deliberate: they are the
 * artefact that will be compiled into the app, and no device is available to
 * this runner.
 */

const require = createRequire(import.meta.url);

function packageRoot(): string | null {
  try {
    return dirname(require.resolve('@maplibre/maplibre-react-native/package.json'));
  } catch {
    return null;
  }
}

const root = packageRoot();

function read(relative: string): string {
  assert.ok(root, '@maplibre/maplibre-react-native is not installed');
  const path = join(root, relative);
  assert.ok(existsSync(path), `the installed package no longer ships ${relative}`);
  return readFileSync(path, 'utf8');
}

describe('installed MapLibre — the region event our camera reads', () => {
  it('reports the centre, the zoom and gesture attribution', () => {
    const source = read('src/components/map/Map.tsx');
    // `useFollowCamera` maps exactly these three fields: the centre feeds the
    // self-move check, the zoom feeds both the zoom buttons and the
    // latitude-span proxy, and `userInteraction` is the attribution signal.
    for (const field of ['center: LngLat', 'zoom: number', 'userInteraction: boolean']) {
      assert.ok(source.includes(field), `ViewState no longer carries \`${field}\``);
    }
  });

  it('still exposes the imperative camera stops the controller drives', () => {
    const source = read('src/components/camera/Camera.tsx');
    for (const method of ['easeTo', 'zoomTo', 'fitBounds']) {
      assert.ok(source.includes(`${method}:`), `CameraRef no longer implements ${method}`);
    }
  });
});

describe('installed MapLibre — Android attribution over-reports our own moves', () => {
  it('counts a developer animation as user interaction', () => {
    const tracker = read(
      'android/src/main/java/org/maplibre/reactnative/components/mapview/helpers/CameraChangeTracker.kt',
    );
    const normalised = tracker.replace(/\s+/g, ' ');
    assert.ok(
      normalised.includes('get() = reason == USER_GESTURE || reason == DEVELOPER_ANIMATION'),
      [
        'Android attribution changed. `DEVELOPER_ANIMATION` is the reason MapLibre',
        'reports for our own easeCamera/animateCamera, so today every follow pan comes',
        'back as `userInteraction: true` and the follow-camera controller relies on its',
        'self-move window to ignore it. If this now excludes DEVELOPER_ANIMATION, the',
        'window can be narrowed — re-read follow-camera-controller.ts before doing so.',
      ].join(' '),
    );
  });

  it('is the source of the `userInteraction` flag sent to JS', () => {
    const view = read(
      'android/src/main/java/org/maplibre/reactnative/components/mapview/MLRNMapView.kt',
    );
    assert.ok(
      view.includes('viewState.putBoolean("userInteraction", cameraChangeTracker.isUserInteraction)'),
      'Android no longer derives userInteraction from CameraChangeTracker',
    );
  });

  it('iOS, by contrast, excludes programmatic camera changes', () => {
    const view = read('ios/components/map-view/MLRNMapView.m');
    assert.ok(
      view.includes('isUserInteraction = (BOOL)(reason & ~MLNCameraChangeReasonProgrammatic)'),
      'iOS attribution changed — the platforms may now need different handling',
    );
  });
});

describe('installed MapLibre — Android gesture ownership inside a ScrollView', () => {
  it('claims the touch stream only while dragPan is on', () => {
    const view = read(
      'android/src/main/java/org/maplibre/reactnative/components/mapview/MLRNMapView.kt',
    );
    const normalised = view.replace(/\s+/g, ' ');
    // The native map asks its parents to stop intercepting — this is what
    // keeps a pan/pinch that starts on the map away from the screen's
    // ScrollView — but only when `scrollEnabled` is `true`, and that field
    // stays `null` until the `dragPan` prop is actually sent.
    assert.ok(
      normalised.includes(
        'override fun onTouchEvent(ev: MotionEvent?): Boolean { val result = super.onTouchEvent(ev) if (result && scrollEnabled == true) { requestDisallowInterceptTouchEvent(true) }',
      ),
      'Android no longer disallows parent touch interception the way DriverTripMap assumes',
    );
    assert.ok(
      normalised.includes('private var scrollEnabled: Boolean? = null'),
      'the scrollEnabled field is no longer tri-state — re-check whether DriverTripMap still has to pass dragPan explicitly',
    );
    assert.ok(
      normalised.includes('@ReactProp(name = "dragPan") override fun setDragPan( mapView: MLRNMapView, value: Boolean, ) { mapView.setReactScrollEnabled(value) }') ||
        read(
          'android/src/main/java/org/maplibre/reactnative/components/mapview/MLRNMapViewManager.kt',
        )
          .replace(/\s+/g, ' ')
          .includes('@ReactProp(name = "dragPan")'),
      '`dragPan` is no longer the prop that enables the native scroll gestures',
    );
  });
});
