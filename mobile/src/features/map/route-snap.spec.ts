import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SNAP_TO_ROUTE_MAX_OFFSET_M,
  createRouteSnapper,
  projectOntoRoute,
} from './route-snap.ts';
import { createBusMotion } from './bus-motion.ts';
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
    // 30 m past the last stop: still inside the offset bound, so the honest
    // answer is the endpoint itself rather than a point invented beyond it.
    const projection = projectOntoRoute(offLine(1_030, 3), STRAIGHT_ROUTE)!;
    assert.deepEqual(projection.point, onLine(1_000));
    assert.equal(projection.segmentFraction, 1);
    assert.ok(Math.abs(projection.distanceMeters - Math.hypot(30, 3)) < 0.5);
  });

  it('stops clamping to the endpoint once the bus has genuinely driven past it', () => {
    // Far beyond the last stop is off the route like any other off-route fix:
    // the marker draws the raw position instead of parking on the final stop.
    assert.equal(projectOntoRoute(offLine(1_100, 3), STRAIGHT_ROUTE), null);
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
  it('keeps the offset bound inside the "same road" band (40–50 m)', () => {
    // Wider than this and a parallel street one block over is still "on the
    // route", which is the off-route defect: a driver who left the planned
    // legs for traffic had the marker clamped back onto a line the bus was
    // not driving. Narrower and ordinary lateral GPS wobble on a wide
    // carriageway stops being damped at all.
    assert.ok(
      SNAP_TO_ROUTE_MAX_OFFSET_M >= 40 && SNAP_TO_ROUTE_MAX_OFFSET_M <= 50,
      `expected a 40–50 m snap bound, got ${SNAP_TO_ROUTE_MAX_OFFSET_M}`,
    );
  });

  it('refuses to snap a fix that is genuinely off the route', () => {
    // 100 m east of a 1 km route: the bus is on another road. Drawing it on
    // the line would be a bigger lie than the jitter was.
    assert.equal(projectOntoRoute(offLine(500, 100), STRAIGHT_ROUTE), null);
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

/**
 * The off-route guard, end to end: snapper → motion machine → marker.
 *
 * The field report this pins: a driver leaves the planned stop-to-stop legs
 * because of traffic, and the marker has to keep showing where the bus
 * actually is. The projection is display-only, so the test asserts the thing
 * a parent sees — the *rendered* coordinate — rather than an internal flag.
 */
describe('a driver who leaves the planned route (the marker keeps tracking)', () => {
  const EPOCH = Date.parse('2026-02-03T09:00:00.000Z');
  const fixAt = (point: { latitude: number; longitude: number }, step: number) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    heading: null,
    speed: 9,
    accuracy: 6,
    recorded_at: new Date(EPOCH + step * 4_000).toISOString(),
  });

  /** On the planned leg, then a detour around it, then back onto the leg. */
  const DRIVE = [
    offLine(400, 0),
    offLine(430, 20),
    offLine(455, 55),
    offLine(480, 95),
    offLine(520, 120),
    offLine(560, 25),
  ];

  it('draws a far-from-route fix at the RAW GPS position, not clamped to the line', () => {
    const motion = createBusMotion({
      reducedMotion: true,
      snapToRoute: createRouteSnapper(STRAIGHT_ROUTE),
    });
    const offRoute = DRIVE[3]; // 95 m east of the planned leg

    motion.push(fixAt(DRIVE[0], 0), 0);
    motion.push(fixAt(offRoute, 1), 4_000);
    const rendered = motion.sample(4_000);

    assert.ok(rendered !== null);
    assert.equal(rendered.latitude, offRoute.latitude, 'the marker is at the raw latitude');
    assert.equal(rendered.longitude, offRoute.longitude, 'and the raw longitude');
    assert.ok(
      Math.abs(rendered.longitude - LINE_LNG) > 90 * ONE_METER_LNG,
      'it must NOT have been pulled back onto the planned polyline',
    );
  });

  it('tracks the whole detour: on-route fixes snap, off-route fixes stay raw', () => {
    const motion = createBusMotion({
      reducedMotion: true,
      snapToRoute: createRouteSnapper(STRAIGHT_ROUTE),
    });

    const seen: { latitude: number; longitude: number }[] = [];
    DRIVE.forEach((point, step) => {
      motion.push(fixAt(point, step), step * 4_000);
      const rendered = motion.sample(step * 4_000);
      assert.ok(rendered !== null);
      seen.push({ latitude: rendered.latitude, longitude: rendered.longitude });

      const projection = projectOntoRoute(point, STRAIGHT_ROUTE);
      if (projection === null) {
        // Off the route: the drawn position IS the fix, to the last digit.
        assert.equal(rendered.latitude, point.latitude);
        assert.equal(rendered.longitude, point.longitude);
      } else {
        assert.ok(
          haversineMeters(rendered, projection.point) < 0.01,
          'near the route the lateral wobble is still damped onto the line',
        );
      }
      // Whatever is drawn, what is *reported* is always the raw fix.
      assert.equal(rendered.source.latitude, point.latitude);
      assert.equal(rendered.source.longitude, point.longitude);
    });

    // The detour fixes are the ones beyond the bound; the drive has both.
    const offRouteCount = DRIVE.filter(
      (point) => projectOntoRoute(point, STRAIGHT_ROUTE) === null,
    ).length;
    assert.ok(offRouteCount >= 3, 'the fixture really does leave the route');
    // And the marker moved on every single fix — it never froze on the line.
    for (let index = 1; index < seen.length; index += 1) {
      assert.ok(
        haversineMeters(seen[index - 1], seen[index]) > 1,
        `fix ${index} did not move the marker`,
      );
    }
  });

  it('animates between off-route fixes and lands exactly on the raw position', () => {
    const motion = createBusMotion({ snapToRoute: createRouteSnapper(STRAIGHT_ROUTE) });
    const from = DRIVE[3];
    const to = DRIVE[4];

    motion.push(fixAt(from, 0), 0);
    const outcome = motion.push(fixAt(to, 1), 4_000);
    assert.equal(outcome.action, 'animated', 'a normal off-route step still tweens');

    const midway = motion.sample(4_000 + 1_500);
    assert.ok(midway !== null && midway.moving, 'the marker travels between fixes');
    assert.ok(
      haversineMeters(midway, to) > 1 && haversineMeters(midway, from) > 1,
      'and it is genuinely in between, not jumping',
    );

    const settled = motion.sample(4_000 + 10_000);
    assert.ok(settled !== null);
    assert.equal(settled.latitude, to.latitude, 'the tween ends ON the raw fix');
    assert.equal(settled.longitude, to.longitude);
  });
});
