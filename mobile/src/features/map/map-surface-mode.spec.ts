import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeRuntime } from '../../lib/runtime-environment.ts';
import { mapSurfaceMode, type MapSurfaceMode } from './map-surface-mode.ts';

/**
 * The map surface decision.
 *
 * The one regression this pins: inside **the Expo Go app** (MapLibre is a
 * custom native module the Go shell does not carry — on **every** platform)
 * the native map renders a blank box. The surface must instead show the
 * labelled development-build panel — and that must win over every other
 * state, because "this route has no mapped stops" would be a lie on a route
 * that does have stops.
 *
 * The runtimes are derived through the real `describeRuntime` from injected
 * facts, so this spec also re-pins the capability rules it depends on.
 */

const EXPO_GO_ANDROID = describeRuntime({
  executionEnvironment: 'storeClient',
  appOwnership: 'expo',
  platform: 'android',
});
const EXPO_GO_IOS = describeRuntime({
  executionEnvironment: 'storeClient',
  appOwnership: 'expo',
  platform: 'ios',
});
const DEV_BUILD_ANDROID = describeRuntime({
  // SDK 57 reports development builds as 'storeClient' too — only
  // appOwnership distinguishes them from the Expo Go shell.
  executionEnvironment: 'storeClient',
  appOwnership: null,
  platform: 'android',
});
const STANDALONE_IOS = describeRuntime({
  executionEnvironment: 'standalone',
  appOwnership: null,
  platform: 'ios',
});

function assertMode(
  runtime: ReturnType<typeof describeRuntime>,
  hasCoordinates: boolean,
  hasFix: boolean,
  expected: MapSurfaceMode,
  message: string,
): void {
  assert.equal(mapSurfaceMode(runtime, hasCoordinates, hasFix), expected, message);
}

describe('mapSurfaceMode', () => {
  it('Expo Go on Android needs the dev-build panel in every data state', () => {
    assert.equal(EXPO_GO_ANDROID.nativeMapAvailable, false, 'precondition: no map engine');
    assertMode(EXPO_GO_ANDROID, true, true, 'needs-dev-build', 'stops + live fix');
    assertMode(EXPO_GO_ANDROID, true, false, 'needs-dev-build', 'stops, no fix');
    assertMode(EXPO_GO_ANDROID, false, true, 'needs-dev-build', 'fix only');
    assertMode(
      EXPO_GO_ANDROID,
      false,
      false,
      'needs-dev-build',
      'no stops, no fix: the missing engine is said, not fobbed off as "no mapped stops"',
    );
  });

  it('Expo Go on iOS needs the dev-build panel too (the engine is custom, not a platform service)', () => {
    assert.equal(
      EXPO_GO_IOS.nativeMapAvailable,
      false,
      'precondition: the Go shell carries no MapLibre engine on iOS either',
    );
    assertMode(EXPO_GO_IOS, true, true, 'needs-dev-build', 'stops + fix');
    assertMode(EXPO_GO_IOS, true, false, 'needs-dev-build', 'stops, no fix');
    assertMode(EXPO_GO_IOS, false, true, 'needs-dev-build', 'fix only');
    assertMode(EXPO_GO_IOS, false, false, 'needs-dev-build', 'nothing to draw');
  });

  it('a development build on Android keeps the map', () => {
    assert.equal(DEV_BUILD_ANDROID.nativeMapAvailable, true, 'precondition: engine present');
    assert.equal(DEV_BUILD_ANDROID.isExpoGo, false, 'and it is not the Expo Go shell');
    assertMode(DEV_BUILD_ANDROID, true, true, 'map', 'stops + fix');
    assertMode(DEV_BUILD_ANDROID, false, false, 'no-coordinates', 'nothing to draw');
  });

  it('a standalone build keeps the map', () => {
    assert.equal(STANDALONE_IOS.nativeMapAvailable, true);
    assertMode(STANDALONE_IOS, true, false, 'map', 'stops, no fix');
  });

  it('the no-coordinates state is unchanged where the map can render', () => {
    // The existing placeholder behaviour: only when there is genuinely
    // nothing to draw AND the tiles could render.
    for (const runtime of [DEV_BUILD_ANDROID, STANDALONE_IOS]) {
      assertMode(runtime, false, false, 'no-coordinates', 'no stops, no fix');
      assertMode(runtime, true, false, 'map', 'stops exist — draw the route');
      assertMode(runtime, false, true, 'map', 'a fix exists — draw the position');
    }
  });
});
