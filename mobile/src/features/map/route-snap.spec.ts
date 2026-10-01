import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SNAP_TO_ROUTE_MAX_OFFSET_M,
  createRouteSnapper,
  projectOntoRoute,
} from './route-snap.ts';
import { haversineMeters } from '../../lib/geo.ts';

/**
 * The snap-to-route geometry, pinned with straight-line and corner fixtures.
 *
 * The fixtures model the field defect exactly: a bus driving a straight road
 * north while its GPS wanders ±5 m sideways between fixes. The rendered
 * (projected) path must stay **on** the drawn route line — cross-track ≈ 0 —
 * while the along-road motion matches the fixes. All coordinates are
 * synthetic (a straight road near Pune).
 */

/** One metre of latitude, in degrees. */
const ONE_METER_LAT = 1 / 111_320;
/** One metre of longitude, in degrees, at the fixture latitude (~18.5° N). */
const ONE_METER_LNG = 1 / (111_320 * Math.cos((18.5 * Math.PI) / 180));

const LINE_LAT = 18.5;
const LINE_LNG = 73.85;
const onLine = (metresNorth: number) => ({
  latitude: LINE_LAT + metresNorth * ONE_METER_LAT,
  longitude: LINE_LNG,
});
const offLine = (metresNorth: number, metresEast: number) => ({
  latitude: LINE_LAT + metresNorth * ONE_METER_LAT,
  longitude: LINE_LNG + metresEast * ONE_METER_LNG,
});

/** A straight 1 km north-south route: the road the bus is really on. */
const STRAIGHT_ROUTE = [onLine(0), onLine(1_000)];

describe('projectOntoRoute: onto a straight line', () => {
  it('projects a fix onto the line, removing the lateral wobble', () => {
    const projection = projectOntoRoute(offLine(400, 5), STRAIGHT_ROUTE);
    assert.ok(projection !== null);
    assert.ok(
      Math.abs(projection.point.latitude - (LINE_LAT + 400 * ONE_METER_LAT)) < ONE_METER_LAT * 0.1,
      'the along-line coordinate is preserved',
    );
    assert.ok(
      Math.abs(projection.point.longitude - LINE_LNG) < ONE_METER_LNG * 0.001,
      'the projected point sits ON the line',
    );
    assert.ok(Math.abs(projection.distanceMeters - 5) < 0.2, 'cross-track ≈ the 5 m offset');
    // The projection is really back on the drawn polyline: re-measure it.
    assert.ok(
      haversineMeters(projection.point, {
        latitude: projection.point.latitude,
        longitude: LINE_LNG,
      }) < 0.01,
    );
  });

  it('keeps a zig-zag stream on the line, with monotonic along-road progress', () => {
    // The field recording, idealised: northbound at ~40 m/fix, GPS alternating
    // ±5 m sideways — the exact pattern that used to draw a zig-zagging bus.
    const fixes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((step) =>
      offLine(step * 40 + 20, step % 2 === 0 ? 5 : -5),
    );
    const rendered = fixes.map((fix) => {
      const projection = projectOntoRoute(fix, STRAIGHT_ROUTE);
      assert.ok(projection !== null);
      return projection;
    });
    let previousAlong = Number.NEGATIVE_INFINITY;
    for (const projection of rendered) {
      assert.ok(
        Math.abs(projection.point.longitude - LINE_LNG) < ONE_METER_LNG * 0.001,
        'every rendered point is on the road line — no zig-zag to draw',
      );
      assert.ok(projection.distanceMeters > 0, 'the raw fixes really were off the line');
      assert.ok(projection.segmentFraction >= 0 && projection.segmentFraction <= 1);
      assert.ok(
        projection.point.latitude > previousAlong,
        'the rendered path never jumps backwards along the road',
      );
      previousAlong = projection.point.latitude;
    }
  });

  it('projects onto the nearer of two equal-offset sides symmetrically', () => {
    const east = projectOntoRoute(offLine(500, 12), STRAIGHT_ROUTE)!;
    const west = projectOntoRoute(offLine(500, -12), STRAIGHT_ROUTE)!;
    assert.ok(Math.abs(east.distanceMeters - west.distanceMeters) < 0.01);
    assert.ok(Math.abs(east.point.latitude - west.point.latitude) < 1e-12);
  });
});

describe('projectOntoRoute: segment ends, corners and parallel legs', () => {
  it('clamps past-the-end fixes to the endpoint — never extrapolates the route', () => {
    // Inside the (tighter) offset bound, measured from the endpoint itself.
    const projection = projectOntoRoute(offLine(1_030, 3), STRAIGHT_ROUTE)!;
    assert.deepEqual(projection.point, onLine(1_000));
    assert.equal(projection.segmentFraction, 1);
    assert.ok(Math.abs(projection.distanceMeters - Math.hypot(30, 3)) < 0.5);
  });

  it('clamps before-the-start fixes to the route start', () => {
    const projection = projectOntoRoute(offLine(-40, 2), STRAIGHT_ROUTE)!;
    assert.deepEqual(projection.point, onLine(0));
    assert.equal(projection.segmentFraction, 0);
  });

  it('follows a corner: a fix past the turn projects onto the eastbound leg', () => {
    // The route turns east at 1 km north.
    const cornerRoute = [onLine(0), onLine(1_000), offLine(1_000, 400)];
    const projection = projectOntoRoute(offLine(1_000, 100), cornerRoute)!;
    assert.equal(projection.segmentIndex, 1, 'the eastbound leg wins after the turn');
    assert.ok(projection.distanceMeters < 0.5, 'the fix is on the second leg already');
    assert.ok(projection.point.longitude > LINE_LNG + 99 * ONE_METER_LNG);
  });

  it('picks the nearest segment when the route folds back on itself', () => {
    // Out and back along the same corridor, 20 m apart.
    const foldback = [onLine(0), onLine(1_000), offLine(1_000, 20), offLine(0, 20)];
    const fix = offLine(500, 20);
    const projection = projectOntoRoute(fix, foldback)!;
    assert.equal(projection.segmentIndex, 2, 'the return leg is 0 m away; the outbound is 20');
    assert.ok(projection.distanceMeters < 0.5);
  });

  it('treats a duplicated stop as a zero-length point candidate', () => {
    const withDuplicate = [onLine(0), onLine(0), onLine(500)];
    const projection = projectOntoRoute(offLine(250, 4), withDuplicate)!;
    assert.equal(projection.segmentIndex, 1, 'the usable segment carries the projection');
    assert.ok(Math.abs(projection.distanceMeters - 4) < 0.2);
  });
});

describe('projectOntoRoute: the honesty bounds', () => {
  it('keeps the bound tight enough that a diverted bus is never glued to the plan', () => {
    // ~40-50 m: a wide carriageway plus a coarse urban fix, and no more.
    assert.ok(SNAP_TO_ROUTE_MAX_OFFSET_M >= 40 && SNAP_TO_ROUTE_MAX_OFFSET_M <= 50);
  });

  it('renders a far-from-route fix at its RAW position (traffic reroute)', () => {
    // The driver leaves the planned legs for a diversion one street over.
    // The marker must keep tracking the vehicle where it really is, so the
    // snapper declines (null = "leave the raw fix alone") for every fix on
    // that parallel street — it must never jump back onto the planned line,
    // and it must never stop producing a position.
    const snap = createRouteSnapper(STRAIGHT_ROUTE);
    for (let metresNorth = 0; metresNorth <= 1_000; metresNorth += 100) {
      const diverted = offLine(metresNorth, 120);
      assert.equal(
        snap(diverted),
        null,
        'an off-route fix is drawn raw, not clamped onto the planned leg',
      );
      const projection = projectOntoRoute(diverted, STRAIGHT_ROUTE);
      assert.equal(projection, null);
    }
    // And the moment the bus rejoins the route, snapping resumes.
    const rejoined = snap(offLine(600, 6));
    assert.ok(rejoined !== null);
    assert.ok(Math.abs(rejoined.longitude - LINE_LNG) < ONE_METER_LNG * 0.001);
  });

  it('refuses to snap a fix that is genuinely off the route', () => {
    // 100 m east of a 1 km route: the bus is on another road. Drawing it on
    // the line would be a bigger lie than the jitter was.
    assert.equal(projectOntoRoute(offLine(500, 100), STRAIGHT_ROUTE), null);
    assert.equal(projectOntoRoute(offLine(500, 55), STRAIGHT_ROUTE), null, '55 m is past the bound');
    assert.equal(projectOntoRoute(offLine(500, SNAP_TO_ROUTE_MAX_OFFSET_M + 1), STRAIGHT_ROUTE), null);
    const inside = projectOntoRoute(
      offLine(500, SNAP_TO_ROUTE_MAX_OFFSET_M - 5),
      STRAIGHT_ROUTE,
    );
    assert.ok(inside !== null, 'just inside the offset bound still snaps');
  });

  it('honours a caller-provided offset bound', () => {
    assert.equal(projectOntoRoute(offLine(500, 25), STRAIGHT_ROUTE, 20), null);
    assert.ok(projectOntoRoute(offLine(500, 15), STRAIGHT_ROUTE, 20) !== null);
  });

  it('returns null when there is no line to snap to', () => {
    assert.equal(projectOntoRoute(onLine(100), []), null);
    assert.equal(projectOntoRoute(onLine(100), [onLine(0)]), null);
    assert.equal(
      projectOntoRoute(onLine(100), [
        { latitude: Number.NaN, longitude: LINE_LNG },
        { latitude: LINE_LAT, longitude: Number.NaN },
      ]),
      null,
    );
  });

  it('returns null for a fix we would never draw anyway', () => {
    assert.equal(projectOntoRoute({ latitude: Number.NaN, longitude: LINE_LNG }, STRAIGHT_ROUTE), null);
    assert.equal(projectOntoRoute({ latitude: 91, longitude: LINE_LNG }, STRAIGHT_ROUTE), null);
    assert.equal(projectOntoRoute({ latitude: 0, longitude: 0 }, STRAIGHT_ROUTE), null);
  });
});

describe('createRouteSnapper (the motion-machine port)', () => {
  it('hands back the projected point for a fix near the route', () => {
    const snap = createRouteSnapper(STRAIGHT_ROUTE);
    const snapped = snap(offLine(300, -7));
    assert.ok(snapped !== null);
    assert.ok(Math.abs(snapped.longitude - LINE_LNG) < ONE_METER_LNG * 0.001);
  });

  it('returns null — leave the raw fix alone — off the route', () => {
    const snap = createRouteSnapper(STRAIGHT_ROUTE);
    assert.equal(snap(offLine(300, 250)), null);
  });
});
