import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  MAX_URL_LENGTH,
  MAX_WAYPOINTS_PER_URL,
  buildCrewRouteUrl,
  buildDirectionsUrl,
  buildDirectionsUrlChunks,
  filterNavigableTargets,
  formatLatLng,
  isNavigableStop,
  isValidCoordinate,
  navigationTargetOf,
  type NavigableStopLike,
  type NavigationTarget,
} from './navigation.ts';

/**
 * Web crew navigation hand-off contract.
 *
 * Pins the same rules `mobile/src/lib/navigation-directions.spec.ts` pins on
 * mobile — the two builders must stay byte-identical so a driver switching
 * between phone and web console lands in the same Google Maps guidance:
 * a bad coordinate is never linked, no origin is ever sent, waypoints are
 * capped and chunked without losing or reordering a stop. The crew-page
 * derivations (next stop, per-stop state, waiting kids, driven trail) live
 * in `crew-progress.spec.ts`.
 */

const target = (n: number): NavigationTarget => ({
  name: `Stop ${n}`,
  latitude: 19.0 + n / 1000,
  longitude: 72.8 + n / 1000,
});

const route = (count: number): NavigationTarget[] =>
  Array.from({ length: count }, (_, index) => target(index + 1));

const stopLike = (n: number, coords = true): NavigableStopLike => ({
  id: `stop-${n}`,
  name: `Stop ${n}`,
  sequence_number: n,
  latitude: coords ? 19.0 + n / 1000 : null,
  longitude: coords ? 72.8 + n / 1000 : null,
});

describe('isValidCoordinate', () => {
  it('accepts in-range coordinates and rejects NaN / out-of-range ones', () => {
    assert.equal(isValidCoordinate(19.076, 72.8777), true);
    assert.equal(isValidCoordinate(-90, 180), true);
    assert.equal(isValidCoordinate(90.0001, 0), false);
    assert.equal(isValidCoordinate(0, -180.5), false);
    assert.equal(isValidCoordinate(Number.NaN, 72), false);
    assert.equal(isValidCoordinate(19, Number.POSITIVE_INFINITY), false);
  });
});

describe('formatLatLng', () => {
  it('writes a bare lat,lng pair (no percent-encoded comma)', () => {
    assert.equal(formatLatLng(19.076, 72.8777), '19.076,72.8777');
  });

  it('caps precision at six decimals', () => {
    assert.equal(formatLatLng(19.07612345678, 72.87765432), '19.076123,72.877654');
  });
});

describe('buildDirectionsUrl', () => {
  it('builds the documented navigate link without an origin (same as mobile)', () => {
    const url = buildDirectionsUrl({ destination: target(1), travelmode: 'driving' });
    assert.equal(
      url,
      'https://www.google.com/maps/dir/?api=1&destination=19.001,72.801&travelmode=driving&dir_action=navigate',
    );
    // The map app must use the device's live position, so no origin is sent.
    assert.equal(url!.includes('origin='), false);
  });

  it('defaults the travel mode to driving', () => {
    assert.match(buildDirectionsUrl({ destination: target(1) })!, /travelmode=driving/);
  });

  it('joins waypoints with | in route order', () => {
    const url = buildDirectionsUrl({ destination: target(1), waypoints: [target(2), target(3)] });
    assert.match(url!, /waypoints=19\.002,72\.802\|19\.003,72\.803/);
  });

  it('caps waypoints at the URL-API limit', () => {
    const url = buildDirectionsUrl({ destination: target(1), waypoints: route(20).slice(1) });
    const waypoints = /waypoints=([^&]+)/.exec(url!)![1].split('|');
    assert.equal(waypoints.length, MAX_WAYPOINTS_PER_URL);
  });

  it('drops invalid waypoints but never an invalid destination', () => {
    const bad: NavigationTarget = { name: 'bad', latitude: Number.NaN, longitude: 72.8 };
    const url = buildDirectionsUrl({ destination: target(1), waypoints: [bad, target(2)] });
    assert.match(url!, /waypoints=19\.002,72\.802/);
    assert.equal(buildDirectionsUrl({ destination: bad }), null);
  });
});

describe('buildDirectionsUrlChunks', () => {
  it('returns one chunk for a short route', () => {
    const chunks = buildDirectionsUrlChunks({
      destination: target(1),
      waypoints: route(5).slice(1),
    });
    assert.equal(chunks.length, 1);
  });

  it('splits a long route without losing or reordering a stop', () => {
    const stops = route(23);
    const chunks = buildDirectionsUrlChunks({ destination: stops[0], waypoints: stops.slice(1) });
    assert.ok(chunks.length > 1);
    const seen: string[] = [];
    for (const chunk of chunks) {
      assert.ok(chunk.length <= MAX_URL_LENGTH);
      const destination = /destination=([^&]+)/.exec(chunk)![1];
      const waypoints = /waypoints=([^&]+)/.exec(chunk)?.[1]?.split('|') ?? [];
      seen.push(destination, ...waypoints);
    }
    assert.deepEqual(
      seen,
      stops.map((point) => formatLatLng(point.latitude, point.longitude)),
    );
  });

  it('returns [] when nothing is navigable', () => {
    const bad: NavigationTarget = { name: 'bad', latitude: 91, longitude: 0 };
    assert.deepEqual(buildDirectionsUrlChunks({ destination: bad }), []);
  });
});

describe('filterNavigableTargets / navigationTargetOf', () => {
  it('drops targets with unusable coordinates', () => {
    const bad: NavigationTarget = { name: 'bad', latitude: 91, longitude: 0 };
    assert.deepEqual(filterNavigableTargets([bad, target(1)]), [target(1)]);
    assert.deepEqual(filterNavigableTargets(undefined), []);
  });

  it('a stop without coordinates is not a navigation target', () => {
    assert.equal(navigationTargetOf(stopLike(1, false)), null);
    assert.equal(isNavigableStop(stopLike(1, false)), false);
    assert.deepEqual(navigationTargetOf(stopLike(2)), target(2));
  });
});

describe('buildCrewRouteUrl', () => {
  it('navigates to the next stop with the remaining stops as ordered waypoints', () => {
    const url = buildCrewRouteUrl(stopLike(2), [stopLike(4), stopLike(3)]);
    assert.match(url!, /destination=19\.002,72\.802/);
    // Waypoints re-sorted into route order regardless of input order.
    assert.match(url!, /waypoints=19\.003,72\.803\|19\.004,72\.804/);
    assert.match(url!, /dir_action=navigate/);
  });

  it('excludes the next stop itself from the waypoints', () => {
    const url = buildCrewRouteUrl(stopLike(2), [stopLike(2), stopLike(3)]);
    assert.match(url!, /waypoints=19\.003,72\.803(&|$)/);
  });

  it('skips unsurveyed upcoming stops but returns null for an unsurveyed destination', () => {
    const url = buildCrewRouteUrl(stopLike(1), [stopLike(2, false), stopLike(3)]);
    assert.match(url!, /waypoints=19\.003,72\.803/);
    assert.equal(buildCrewRouteUrl(stopLike(1, false), [stopLike(2)]), null);
  });
});

