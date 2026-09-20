import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_ENVIRONMENTS,
  EXPO_GO_APP_OWNERSHIP,
  backgroundUnavailableReasonFor,
  describeRuntime,
  getRuntime,
  isExpoGoEnvironment,
  registerRuntimeFacts,
  __resetRuntimeEnvironmentForTests,
  type RuntimeEnvironmentFacts,
} from './runtime-environment.ts';

/**
 * Pins the runtime capability matrix that the rest of the app decides from:
 * Expo Go (SDK ≥ 53) has no Google Maps on Android, no background location
 * and no remote push; a development build or standalone build has all of it.
 */

const facts = (overrides: Partial<RuntimeEnvironmentFacts> = {}): RuntimeEnvironmentFacts => ({
  executionEnvironment: null,
  appOwnership: null,
  platform: 'android',
  ...overrides,
});

const EXPO_GO = {
  executionEnvironment: EXECUTION_ENVIRONMENTS.StoreClient,
  appOwnership: EXPO_GO_APP_OWNERSHIP,
};

const DEV_CLIENT = { executionEnvironment: EXECUTION_ENVIRONMENTS.StoreClient, appOwnership: null };
const STANDALONE = { executionEnvironment: EXECUTION_ENVIRONMENTS.Standalone, appOwnership: null };
const BARE = { executionEnvironment: EXECUTION_ENVIRONMENTS.Bare, appOwnership: null };

describe('isExpoGoEnvironment', () => {
  it('is true only for storeClient WITH Expo Go ownership', () => {
    assert.equal(isExpoGoEnvironment(facts(EXPO_GO)), true);
    // SDK 57 reports `storeClient` for dev builds too — `appOwnership` is
    // what separates them, so this must NOT read as Expo Go.
    assert.equal(isExpoGoEnvironment(facts(DEV_CLIENT)), false);
    assert.equal(isExpoGoEnvironment(facts(STANDALONE)), false);
    assert.equal(isExpoGoEnvironment(facts(BARE)), false);
    assert.equal(isExpoGoEnvironment(facts()), false);
  });

  it('ownership alone is not enough (an Expo Go shell never runs bare/standalone)', () => {
    assert.equal(
      isExpoGoEnvironment(facts({ ...BARE, appOwnership: EXPO_GO_APP_OWNERSHIP })),
      false,
    );
  });
});

describe('describeRuntime', () => {
  it('Expo Go on Android: no Google Maps, no background location, no remote push', () => {
    const runtime = describeRuntime(facts(EXPO_GO));
    assert.equal(runtime.isExpoGo, true);
    assert.equal(runtime.platform, 'android');
    assert.equal(
      runtime.googleMapsAvailable,
      false,
      'SDK ≥ 53: Expo Go has no Google Maps on Android',
    );
    assert.equal(runtime.backgroundLocationAvailable, false);
    assert.equal(runtime.remotePushAvailable, false);
  });

  it('Expo Go on iOS: Apple Maps available, background location and push unavailable', () => {
    const runtime = describeRuntime(facts({ ...EXPO_GO, platform: 'ios' }));
    assert.equal(runtime.isExpoGo, true);
    assert.equal(runtime.googleMapsAvailable, true, 'Expo Go on iOS runs Apple Maps, which works');
    assert.equal(runtime.backgroundLocationAvailable, false);
    assert.equal(runtime.remotePushAvailable, false);
  });

  it('development build on Android: everything available (unchanged behaviour)', () => {
    const runtime = describeRuntime(facts(DEV_CLIENT));
    assert.equal(runtime.isExpoGo, false);
    assert.equal(runtime.googleMapsAvailable, true);
    assert.equal(runtime.backgroundLocationAvailable, true);
    assert.equal(runtime.remotePushAvailable, true);
  });

  it('standalone build: everything available', () => {
    const runtime = describeRuntime(facts({ ...STANDALONE, platform: 'ios' }));
    assert.equal(runtime.isExpoGo, false);
    assert.equal(runtime.googleMapsAvailable, true);
    assert.equal(runtime.backgroundLocationAvailable, true);
    assert.equal(runtime.remotePushAvailable, true);
  });

  it('bare workflow: everything available', () => {
    const runtime = describeRuntime(facts(BARE));
    assert.equal(runtime.isExpoGo, false);
    assert.equal(runtime.googleMapsAvailable, true);
    assert.equal(runtime.backgroundLocationAvailable, true);
    assert.equal(runtime.remotePushAvailable, true);
  });

  it('is deterministic (same facts, same description)', () => {
    const input = facts(EXPO_GO);
    assert.deepEqual(describeRuntime(input), describeRuntime({ ...input }));
  });
});

describe('backgroundUnavailableReasonFor', () => {
  it('maps an unavailable background to its cause', () => {
    assert.equal(backgroundUnavailableReasonFor(describeRuntime(facts(EXPO_GO))), 'expo-go');
    // A runtime that is not Expo Go but still lacks background location
    // (future platform restriction) is reported as a platform limit.
    const platformBlocked = describeRuntime(facts(DEV_CLIENT));
    const pretend = { ...platformBlocked, backgroundLocationAvailable: false };
    assert.equal(backgroundUnavailableReasonFor(pretend), 'platform');
  });

  it('is null whenever background location is available', () => {
    assert.equal(backgroundUnavailableReasonFor(describeRuntime(facts(DEV_CLIENT))), null);
    assert.equal(backgroundUnavailableReasonFor(describeRuntime(facts(STANDALONE))), null);
  });
});

describe('getRuntime (registered facts)', () => {
  it('reflects the registered facts', () => {
    registerRuntimeFacts(facts({ ...EXPO_GO, platform: 'ios' }));
    const runtime = getRuntime();
    assert.equal(runtime.isExpoGo, true);
    assert.equal(runtime.googleMapsAvailable, true);
    assert.equal(runtime.backgroundLocationAvailable, false);
    assert.equal(runtime.remotePushAvailable, false);
  });

  it('reads like a native build when unregistered (never disables by accident)', () => {
    __resetRuntimeEnvironmentForTests();
    const runtime = getRuntime();
    assert.equal(runtime.isExpoGo, false);
    assert.equal(runtime.googleMapsAvailable, true);
    assert.equal(runtime.backgroundLocationAvailable, true);
    assert.equal(runtime.remotePushAvailable, true);
    assert.equal(runtime.platform, 'unknown');
  });

  it('re-registration switches the description (the simulation seam)', () => {
    registerRuntimeFacts(facts(EXPO_GO));
    assert.equal(getRuntime().isExpoGo, true);
    registerRuntimeFacts(facts(DEV_CLIENT));
    assert.equal(getRuntime().isExpoGo, false);
    assert.equal(getRuntime().backgroundLocationAvailable, true);
    __resetRuntimeEnvironmentForTests();
  });
});
