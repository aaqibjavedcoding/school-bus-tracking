import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildArgs, buildEnv, targetsDevClient } from './start-expo.mjs';

/**
 * Regression tests for the "QR code scans but nothing opens" bug.
 *
 * `expo start --go` alone still printed a QR encoding the interstitial page
 * (`http://<lan-ip>:8081/_expo/loading`) because `expo-dev-client` is a
 * dependency of this workspace — Expo Go cannot open an http:// URL, so the
 * scan silently did nothing. `EXPO_NO_REDIRECT_PAGE=1` is what makes the CLI
 * fall back to the `exp://<lan-ip>:8081` deep link Expo Go understands.
 */

describe('buildEnv', () => {
  it('disables the interstitial redirect page so the QR is an exp:// link', () => {
    assert.equal(buildEnv({}).EXPO_NO_REDIRECT_PAGE, '1');
  });

  it('treats an empty value as unset', () => {
    assert.equal(buildEnv({ EXPO_NO_REDIRECT_PAGE: '' }).EXPO_NO_REDIRECT_PAGE, '1');
  });

  it('honours an explicit opt back in to the redirect page', () => {
    assert.equal(buildEnv({ EXPO_NO_REDIRECT_PAGE: '0' }).EXPO_NO_REDIRECT_PAGE, '0');
  });

  it('preserves the rest of the environment', () => {
    const env = buildEnv({ EXPO_PUBLIC_API_URL: 'http://10.0.0.5:3001/api/v1' });
    assert.equal(env.EXPO_PUBLIC_API_URL, 'http://10.0.0.5:3001/api/v1');
  });

  it('does not mutate the environment it was given', () => {
    const base = {};
    buildEnv(base);
    assert.deepEqual(base, {});
  });
});

describe('buildArgs', () => {
  it('defaults to the Expo Go target', () => {
    assert.deepEqual(buildArgs([]), ['start', '--go']);
  });

  it('keeps extra flags after the target', () => {
    assert.deepEqual(buildArgs(['--tunnel']), ['start', '--go', '--tunnel']);
    assert.deepEqual(buildArgs(['--clear']), ['start', '--go', '--clear']);
  });

  it('does not duplicate an explicit --go', () => {
    assert.deepEqual(buildArgs(['--go']), ['start', '--go']);
    assert.deepEqual(buildArgs(['-g', '--tunnel']), ['start', '-g', '--tunnel']);
  });

  it('never forces Expo Go onto a development-build run', () => {
    assert.deepEqual(buildArgs(['--dev-client']), ['start', '--dev-client']);
    assert.deepEqual(buildArgs(['-d']), ['start', '-d']);
  });
});

describe('targetsDevClient', () => {
  it('detects the development-build target', () => {
    assert.equal(targetsDevClient(['start', '--dev-client']), true);
    assert.equal(targetsDevClient(['start', '-d']), true);
  });

  it('reports Expo Go runs as not dev-client', () => {
    assert.equal(targetsDevClient(['start', '--go', '--tunnel']), false);
  });
});
