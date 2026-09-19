import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPushFailure,
  describePushConfiguration,
  googleServicesPackageMatches,
} from './push-config.ts';

/**
 * Push configuration diagnostics: "no notification arrived" must be answerable
 * as either a build-configuration problem (fix: rebuild the native app) or a
 * runtime delivery problem (fix: retry / look at the server delivery row).
 */

const android = (overrides: Partial<Parameters<typeof describePushConfiguration>[0]> = {}) =>
  describePushConfiguration({
    platform: 'android',
    isExpoGo: false,
    googleServicesConfigured: true,
    packageMatches: true,
    ...overrides,
  });

describe('describePushConfiguration', () => {
  it('is ready in a native build with the Firebase app wired', () => {
    const report = android();
    assert.equal(report.state, 'ready');
    assert.equal(report.needsNativeRebuild, false);
    assert.equal(report.retryable, true);
  });

  it('reports Expo Go as an explicit, non-crashing skip', () => {
    const report = android({ isExpoGo: true, googleServicesConfigured: false });
    assert.equal(report.state, 'expo-go-skip');
    assert.equal(report.needsNativeRebuild, true);
    assert.match(report.detail, /Expo Go/);
    assert.ok(
      !report.detail.includes('google-services.json is missing'),
      'Expo Go must not be told its Firebase config is broken',
    );
  });

  it('reports an unsupported platform without blaming configuration', () => {
    const report = describePushConfiguration({
      platform: 'web',
      isExpoGo: false,
      googleServicesConfigured: null,
      packageMatches: null,
    });
    assert.equal(report.state, 'platform-unsupported');
    assert.equal(report.retryable, false);
  });

  it('separates a missing native config from a delivery failure', () => {
    const missing = android({ googleServicesConfigured: false });
    assert.equal(missing.state, 'missing-native-config');
    assert.equal(missing.retryable, false, 'retrying a build gap never helps');
    assert.equal(missing.needsNativeRebuild, true);

    const delivery = android({ tokenObtained: false });
    assert.equal(delivery.state, 'token-unavailable');
    assert.equal(delivery.retryable, true);
    assert.equal(delivery.needsNativeRebuild, false);
  });

  it('reports a Firebase/app package mismatch as a hard configuration error', () => {
    const report = android({ packageMatches: false });
    assert.equal(report.state, 'package-mismatch');
    assert.equal(report.needsNativeRebuild, true);
    assert.equal(report.retryable, false);
  });

  it('reports a denied notification permission distinctly', () => {
    const report = android({ permissionGranted: false });
    assert.equal(report.state, 'permission-denied');
    assert.equal(report.retryable, true);
  });

  it('never reports an unknown configuration as misconfigured', () => {
    const report = android({ googleServicesConfigured: null, packageMatches: null });
    assert.equal(report.state, 'ready');
  });

  it('does not apply the Android-only google-services rule to iOS', () => {
    const report = describePushConfiguration({
      platform: 'ios',
      isExpoGo: false,
      googleServicesConfigured: false,
      packageMatches: null,
    });
    assert.equal(report.state, 'ready', 'iOS uses GoogleService-Info.plist / APNs, not this file');
  });
});

describe('classifyPushFailure', () => {
  it('recognises an uninitialised Firebase app as missing native config', () => {
    assert.equal(
      classifyPushFailure(new Error('Default FirebaseApp is not initialized in this process')),
      'missing-native-config',
    );
  });

  it('recognises missing Google Play services as a token problem', () => {
    assert.equal(
      classifyPushFailure(new Error('Google Play services are required to obtain a token')),
      'token-unavailable',
    );
    assert.equal(classifyPushFailure(new Error('UnavailabilityError')), 'token-unavailable');
  });

  it('recognises a denied permission', () => {
    assert.equal(classifyPushFailure(new Error('Permission denied by the user')), 'permission-denied');
  });

  it('defaults to a retryable delivery failure instead of blaming the build', () => {
    assert.equal(classifyPushFailure(new Error('socket hang up')), 'delivery-failed');
    assert.equal(classifyPushFailure(undefined), 'delivery-failed');
  });
});

describe('googleServicesPackageMatches', () => {
  it('compares packages and refuses to guess when one side is unknown', () => {
    assert.equal(
      googleServicesPackageMatches('com.schoolbustracking.app', 'com.schoolbustracking.app'),
      true,
    );
    assert.equal(googleServicesPackageMatches('com.other.app', 'com.schoolbustracking.app'), false);
    assert.equal(googleServicesPackageMatches(null, 'com.schoolbustracking.app'), null);
    assert.equal(googleServicesPackageMatches('com.schoolbustracking.app', ''), null);
  });
});
