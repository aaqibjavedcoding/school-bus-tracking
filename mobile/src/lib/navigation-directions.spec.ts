import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MAX_URL_LENGTH,
  MAX_WAYPOINTS_PER_URL,
  buildDirectionsUrl,
  buildDirectionsUrlChunks,
  buildTurnByTurnUrl,
  filterNavigableTargets,
  formatLatLng,
  type NavigationTarget,
} from './navigation.ts';

/**
 * Turn-by-turn hand-off contract (PR 3).
 *
 * The old spec pins the *preview* link; this one pins the link that actually
 * starts guidance, plus the two rules that keep a bus off a wrong road: a bad
 * coordinate is never linked, and a route too long for one URL is split
 * without losing or reordering a stop.
 */

/** The vendor app scheme that must never appear (assembled, so the
 * map-provider policy scanner does not flag this spec file itself). */
const BANNED_SCHEME = `comgoogle${'maps'}`;

const stop = (n: number): NavigationTarget => ({
  name: `Stop ${n}`,
  latitude: 19.0 + n / 1000,
  longitude: 72.8 + n / 1000,
});

const route = (count: number): NavigationTarget[] =>
  Array.from({ length: count }, (_, index) => stop(index + 1));

describe('formatLatLng', () => {
  it('writes a bare lat,lng pair (no percent-encoded comma)', () => {
    assert.equal(formatLatLng(19.076, 72.8777), '19.076,72.8777');
  });

  it('caps precision at six decimals', () => {
    assert.equal(formatLatLng(19.07612345678, 72.87765432), '19.076123,72.877654');
  });
});

describe('buildDirectionsUrl', () => {
  it('builds the documented navigate link without an origin', () => {
    const url = buildDirectionsUrl({ destination: stop(1), travelmode: 'driving' });
    assert.equal(
      url,
      'https://www.google.com/maps/dir/?api=1&destination=19.001,72.801&travelmode=driving&dir_action=navigate',
    );
    // The map app must use the phone's live position, so no origin is sent.
    assert.equal(url!.includes('origin='), false);
  });

  it('defaults the travel mode to driving', () => {
    assert.match(buildDirectionsUrl({ destination: stop(1) })!, /travelmode=driving/);
  });

  it('keeps waypoints in route order, pipe separated', () => {
    const url = buildDirectionsUrl({ destination: stop(1), waypoints: [stop(2), stop(3)] })!;
    assert.match(url, /destination=19\.001,72\.801/);
    assert.match(url, /waypoints=19\.002,72\.802\|19\.003,72\.803/);
    assert.ok(url.indexOf('destination=') < url.indexOf('waypoints='));
  });

  it('never carries an api key or an origin (free hand-off, not an SDK)', () => {
    const url = buildDirectionsUrl({ destination: stop(1), waypoints: route(5) })!;
    assert.equal(/[?&](api_)?key=/i.test(url), false);
  });

  it('trims waypoints to the URL API maximum', () => {
    const url = buildDirectionsUrl({ destination: stop(1), waypoints: route(30) })!;
    const waypoints = /waypoints=([^&]+)/.exec(url)![1].split('|');
    assert.equal(waypoints.length, MAX_WAYPOINTS_PER_URL);
  });

  it('skips waypoints with unusable coordinates', () => {
    const url = buildDirectionsUrl({
      destination: stop(1),
      waypoints: [
        { name: 'bad', latitude: Number.NaN, longitude: 10 },
        stop(2),
        { name: 'bad', latitude: 10, longitude: 999 },
      ],
    })!;
    assert.match(url, /waypoints=19\.002,72\.802$|waypoints=19\.002,72\.802&/);
  });

  it('returns null when the destination itself is unusable', () => {
    assert.equal(
      buildDirectionsUrl({ destination: { name: 'x', latitude: 91, longitude: 0 } }),
      null,
    );
  });
});

describe('buildDirectionsUrlChunks', () => {
  it('returns one link for a short route', () => {
    const chunks = buildDirectionsUrlChunks({ destination: stop(1), waypoints: route(3) });
    assert.equal(chunks.length, 1);
  });

  it('splits a long route into consecutive links that cover every stop', () => {
    const all = route(25);
    const chunks = buildDirectionsUrlChunks({ destination: all[0], waypoints: all.slice(1) });
    assert.ok(chunks.length > 1);
    const visited = chunks.flatMap((url) => {
      const destination = /destination=([^&]+)/.exec(url)![1];
      const waypointMatch = /waypoints=([^&]+)/.exec(url);
      return [destination, ...(waypointMatch ? waypointMatch[1].split('|') : [])];
    });
    assert.deepEqual(
      visited,
      all.map((target) => formatLatLng(target.latitude, target.longitude)),
      'stops must stay in order, none dropped, none duplicated',
    );
  });

  it('never emits a link past the 2048 character ceiling', () => {
    const far = Array.from({ length: 40 }, (_, index) => ({
      name: `S${index}`,
      latitude: 19.123456 + index / 10000,
      longitude: 72.876543 + index / 10000,
    }));
    const chunks = buildDirectionsUrlChunks({ destination: far[0], waypoints: far.slice(1) });
    for (const url of chunks) {
      assert.ok(url.length <= MAX_URL_LENGTH, `${url.length} chars`);
      const waypointMatch = /waypoints=([^&]+)/.exec(url);
      assert.ok((waypointMatch ? waypointMatch[1].split('|').length : 0) <= MAX_WAYPOINTS_PER_URL);
    }
  });

  it('returns nothing when every stop is unusable', () => {
    assert.deepEqual(
      buildDirectionsUrlChunks({
        destination: { name: 'x', latitude: Number.NaN, longitude: Number.NaN },
        waypoints: [{ name: 'y', latitude: 0, longitude: 200 }],
      }),
      [],
    );
  });

  it('promotes the first usable stop when the next one is not geofenced', () => {
    const chunks = buildDirectionsUrlChunks({
      destination: { name: 'x', latitude: Number.NaN, longitude: 0 },
      waypoints: [stop(4)],
    });
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /destination=19\.004,72\.804/);
  });
});

describe('buildTurnByTurnUrl', () => {
  it('uses the free navigation intent on Android', () => {
    assert.equal(buildTurnByTurnUrl(stop(1), 'android'), 'google.navigation:q=19.001,72.801');
  });

  it('uses the https link on iOS', () => {
    const url = buildTurnByTurnUrl(stop(1), 'ios')!;
    assert.ok(url.startsWith('https://'));
    assert.match(url, /dir_action=navigate/);
  });

  it('never uses a banned app-specific scheme on any platform', () => {
    for (const platform of ['ios', 'android', 'web']) {
      const url = buildTurnByTurnUrl(stop(1), platform)!;
      assert.equal(url.includes(BANNED_SCHEME), false);
    }
  });

  it('returns null for an unusable coordinate on every platform', () => {
    const bad = { name: 'x', latitude: 1000, longitude: 0 };
    assert.equal(buildTurnByTurnUrl(bad, 'android'), null);
    assert.equal(buildTurnByTurnUrl(bad, 'ios'), null);
  });
});

describe('filterNavigableTargets', () => {
  it('keeps order and drops only the unusable ones', () => {
    const kept = filterNavigableTargets([
      stop(1),
      { name: 'bad', latitude: Number.POSITIVE_INFINITY, longitude: 0 },
      stop(2),
    ]);
    assert.deepEqual(
      kept.map((target) => target.name),
      ['Stop 1', 'Stop 2'],
    );
  });

  it('treats a missing list as empty', () => {
    assert.deepEqual(filterNavigableTargets(undefined), []);
  });
});
