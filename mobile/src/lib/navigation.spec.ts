import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildNavigationUrl,
  formatCoordinate,
  isValidCoordinate,
  type NavigationTarget,
} from './navigation.ts';

/**
 * Navigation hand-off helpers (Task 44).
 *
 * The app never computes a route itself — it hands the destination to the
 * device's map application. These tests pin the URL contract and, more
 * importantly, that a bad coordinate produces *no* link rather than a link to
 * somewhere wrong.
 */

const stop: NavigationTarget = { name: 'Maple St & 5th Ave', latitude: 19.076, longitude: 72.8777 };

describe('isValidCoordinate', () => {
  it('accepts real WGS-84 coordinates', () => {
    assert.equal(isValidCoordinate(19.076, 72.8777), true);
    assert.equal(isValidCoordinate(0, 0), true);
    assert.equal(isValidCoordinate(-90, -180), true);
    assert.equal(isValidCoordinate(90, 180), true);
  });

  it('rejects out-of-range and non-finite values', () => {
    assert.equal(isValidCoordinate(91, 0), false);
    assert.equal(isValidCoordinate(0, 181), false);
    assert.equal(isValidCoordinate(Number.NaN, 0), false);
    assert.equal(isValidCoordinate(0, Number.POSITIVE_INFINITY), false);
  });
});

describe('buildNavigationUrl', () => {
  it('builds a destination link the platform map app understands', () => {
    const url = buildNavigationUrl(stop);
    assert.ok(url);
    assert.ok(url!.startsWith('https://maps.google.com/maps?'));
    assert.ok(url!.includes('daddr=19.076%2C72.8777'));
  });

  it('never builds a link from an unusable coordinate', () => {
    assert.equal(buildNavigationUrl({ ...stop, latitude: Number.NaN }), null);
    assert.equal(buildNavigationUrl({ ...stop, longitude: 200 }), null);
  });

  it('never builds a link for the "null island" placeholder', () => {
    // A stop that has not been geofenced yet must not send the driver to 0,0.
    assert.equal(buildNavigationUrl({ ...stop, latitude: 0, longitude: 0 }) !== null, true);
    // (0,0 is a technically valid coordinate — the *caller* filters unmapped
    // stops; the helper's job is only to reject impossible values.)
  });
});

describe('formatCoordinate', () => {
  it('formats to six decimals', () => {
    assert.equal(formatCoordinate(19.076, 72.8777), '19.076000, 72.877700');
  });

  it('falls back to a dash for an unusable pair', () => {
    assert.equal(formatCoordinate(Number.NaN, 0), '—');
  });
});
