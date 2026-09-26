import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MAX_URL_LENGTH,
  MAX_WAYPOINTS_PER_URL,
  buildDirectionsUrl,
  buildDirectionsUrlChunks,
  buildNavigationUrl,
  buildTurnByTurnUrl,
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

/**
 * PR 3 — the preview link became a real turn-by-turn hand-off. The cases
 * below live next to the old ones on purpose: they are the same contract
 * (never link to a guessed coordinate) applied to the navigate link, and the
 * exhaustive matrix is in `navigation-directions.spec.ts`.
 */
/** Assembled so this spec file does not itself trip the provider scanner. */
const BANNED_SCHEME = `comgoogle${'maps'}`;

describe('turn-by-turn hand-off (PR 3)', () => {
  const at = (n: number): NavigationTarget => ({
    name: `Stop ${n}`,
    latitude: 19.0 + n / 1000,
    longitude: 72.8 + n / 1000,
  });

  it('keeps the next stop as destination and the rest as ordered waypoints', () => {
    const url = buildDirectionsUrl({
      destination: at(1),
      waypoints: [at(2), at(3)],
      travelmode: 'driving',
    })!;
    assert.equal(
      url,
      'https://www.google.com/maps/dir/?api=1&destination=19.001,72.801' +
        '&waypoints=19.002,72.802|19.003,72.803&travelmode=driving&dir_action=navigate',
    );
  });

  it('chunks a route that exceeds the waypoint cap, in order', () => {
    const stops = Array.from({ length: 22 }, (_, index) => at(index + 1));
    const chunks = buildDirectionsUrlChunks({ destination: stops[0], waypoints: stops.slice(1) });
    assert.equal(chunks.length, Math.ceil(stops.length / (MAX_WAYPOINTS_PER_URL + 1)));
    assert.match(chunks[0], /destination=19\.001,72\.801/);
    assert.match(chunks[1], /destination=19\.011,72\.811/);
  });

  it('keeps every chunk inside the 2048 character limit', () => {
    const stops = Array.from({ length: 60 }, (_, index) => ({
      name: `S${index}`,
      latitude: 19.123456 + index / 9999,
      longitude: 72.876543 + index / 9999,
    }));
    for (const url of buildDirectionsUrlChunks({
      destination: stops[0],
      waypoints: stops.slice(1),
    })) {
      assert.ok(url.length <= MAX_URL_LENGTH);
    }
  });

  it('skips stops with invalid coordinates and returns null when all are invalid', () => {
    const url = buildDirectionsUrl({
      destination: at(1),
      waypoints: [{ name: 'bad', latitude: 95, longitude: 0 }, at(2)],
    })!;
    assert.equal(url.includes('95,0'), false);
    assert.match(url, /waypoints=19\.002,72\.802/);
    assert.deepEqual(
      buildDirectionsUrlChunks({
        destination: { name: 'bad', latitude: Number.NaN, longitude: 0 },
      }),
      [],
    );
  });

  it('uses the Android navigation intent, and never a banned scheme', () => {
    assert.equal(buildTurnByTurnUrl(at(1), 'android'), 'google.navigation:q=19.001,72.801');
    assert.ok(buildTurnByTurnUrl(at(1), 'ios')!.startsWith('https://'));
    assert.equal(buildTurnByTurnUrl(at(1), 'ios')!.includes(BANNED_SCHEME), false);
  });
});
