import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RouteGeometry, Route, School, Stop } from '../../database/models';
import { hashRouteStops } from './stops-hash';
import { MissingRouteGeometryService } from './missing-route-geometry.service';

/**
 * The platform missing-list (`GET /admin/routes/geometry/missing`):
 *
 *  - a route is missing when its CURRENT located stops hash to a key with no
 *    live cache row; changed stops ⇒ missing, a cached row for the current
 *    stops ⇒ not listed;
 *  - routes with fewer than two located stops are counted, never listed;
 *  - stops only count inside their own route's school (the same scoping as
 *    the read path);
 *  - pagination is over the full sorted missing set, and the per-school
 *    counts and totals always cover ALL schools, not just the page;
 *  - the work is a fixed set of set-based queries, not one per route/school.
 */

const SCHOOL_ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCHOOL_GONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

type StopRow = {
  id: string;
  route_id: string;
  school_id: string;
  latitude: number | null;
  longitude: number | null;
  sequence_number: number;
};

type RouteRow = { id: string; school_id: string; name: string; code: string };

type CacheRow = { route_id: string; stops_hash: string };

interface Fixture {
  schools: Array<{ id: string; name: string }>;
  routes: RouteRow[];
  stops: StopRow[];
  cache: CacheRow[];
}

/** Stops of one route, numbered in manifest order. */
function stopsOf(
  routeId: string,
  schoolId: string,
  points: Array<[number, number] | null>,
  idPrefix: string,
): StopRow[] {
  return points.map((point, index) => ({
    id: `${idPrefix}${index + 1}`,
    route_id: routeId,
    school_id: schoolId,
    latitude: point === null ? null : point[0],
    longitude: point === null ? null : point[1],
    sequence_number: index + 1,
  }));
}

/** The hash the server computes for these located stops. */
function hashOf(stops: StopRow[]): string {
  return hashRouteStops(
    stops
      .filter((stop) => stop.latitude !== null && stop.longitude !== null)
      .map((stop) => ({
        stopId: stop.id,
        latitude: stop.latitude as number,
        longitude: stop.longitude as number,
      })),
  );
}

/**
 * Fake models answering the four set-based reads the service makes. The
 * stop query mirrors the SQL it stands for: null coordinates are excluded
 * and rows come back in sequence order.
 */
function fakeModels(fixture: Fixture) {
  const calls = { schools: 0, routes: 0, stops: 0, geometries: 0 };
  const models = {
    schools: {
      findAll: async () => {
        calls.schools += 1;
        return fixture.schools;
      },
    } as unknown as typeof School,
    routes: {
      findAll: async () => {
        calls.routes += 1;
        return fixture.routes;
      },
    } as unknown as typeof Route,
    stops: {
      findAll: async () => {
        calls.stops += 1;
        return fixture.stops
          .filter((stop) => stop.latitude !== null && stop.longitude !== null)
          .sort((a, b) => a.sequence_number - b.sequence_number);
      },
    } as unknown as typeof Stop,
    geometries: {
      findAll: async () => {
        calls.geometries += 1;
        return fixture.cache;
      },
    } as unknown as typeof RouteGeometry,
  };
  return { models, calls };
}

function serviceFor(fixture: Fixture) {
  const { models, calls } = fakeModels(fixture);
  const service = new MissingRouteGeometryService(
    models.routes,
    models.stops,
    models.geometries,
    models.schools,
  );
  return { service, calls };
}

/** A fixture with one route of each kind, across two schools. */
function mixedFixture(): Fixture {
  // Alpha: R1 missing, R2 cached for its current stops, R3 unlocated.
  const r1Stops = stopsOf(
    'r1',
    SCHOOL_ALPHA,
    [
      [33.6844, 73.0479],
      [33.6901, 73.0551],
      [33.6972, 73.0613],
    ],
    'a1-',
  );
  const r2Stops = stopsOf(
    'r2',
    SCHOOL_ALPHA,
    [
      [33.7001, 73.0701],
      [33.7102, 73.0802],
    ],
    'a2-',
  );
  const r3Stops = stopsOf('r3', SCHOOL_ALPHA, [[33.71, 73.09], null], 'a3-');

  // Beta: R4 stops moved since its cached row ⇒ missing; R5 has no stops ⇒
  // unlocated; R6 has two stops but they belong to ANOTHER school ⇒ unlocated.
  const r4Current = stopsOf(
    'r4',
    SCHOOL_BETA,
    [
      [33.8, 73.1],
      [33.81, 73.11],
    ],
    'b4-',
  );
  const r4Previous = stopsOf(
    'r4',
    SCHOOL_BETA,
    [
      [33.8, 73.1],
      [33.8105, 73.1105],
    ],
    'b4-',
  );
  // R6 belongs to Beta, but its stops are tagged with Alpha: they must not
  // locate it (the read path filters stops by the route's own school).
  const r6Stops = stopsOf(
    'r6',
    SCHOOL_ALPHA,
    [
      [33.9, 73.2],
      [33.91, 73.21],
    ],
    'b6-',
  );

  return {
    schools: [
      { id: SCHOOL_BETA, name: 'Beta School' },
      { id: SCHOOL_ALPHA, name: 'Alpha School' },
    ],
    routes: [
      { id: 'r1', school_id: SCHOOL_ALPHA, name: 'Route 1', code: 'A-1' },
      { id: 'r2', school_id: SCHOOL_ALPHA, name: 'Route 2', code: 'A-2' },
      { id: 'r3', school_id: SCHOOL_ALPHA, name: 'Route 3', code: 'A-3' },
      { id: 'r4', school_id: SCHOOL_BETA, name: 'Route 4', code: 'B-4' },
      { id: 'r5', school_id: SCHOOL_BETA, name: 'Route 5', code: 'B-5' },
      { id: 'r6', school_id: SCHOOL_BETA, name: 'Route 6', code: 'B-6' },
    ],
    stops: [...r1Stops, ...r2Stops, ...r3Stops, ...r4Current, ...r6Stops],
    cache: [
      { route_id: 'r2', stops_hash: hashOf(r2Stops) },
      // The cached row was computed for the OLD stop list of R4.
      { route_id: 'r4', stops_hash: hashOf(r4Previous) },
    ],
  };
}

const ALL = { page: 1, limit: 100 };

describe('MissingRouteGeometryService.listMissing — what counts as missing', () => {
  it('lists a route with no cached row, keyed by the hash of its current stops', async () => {
    const fixture = mixedFixture();
    const { service } = serviceFor(fixture);
    const result = await service.listMissing(ALL);

    const r1 = result.items.find((item) => item.route_id === 'r1');
    assert.ok(r1, 'R1 has no cached row and must be listed');
    assert.equal(r1.school_id, SCHOOL_ALPHA);
    assert.equal(r1.school_name, 'Alpha School');
    assert.equal(r1.route_name, 'Route 1');
    assert.equal(r1.route_code, 'A-1');
    assert.equal(r1.stops_hash, hashOf(fixture.stops.filter((stop) => stop.route_id === 'r1')));
    assert.deepEqual(
      r1.stops.map((stop) => stop.stop_id),
      ['a1-1', 'a1-2', 'a1-3'],
      'the stops come back in manifest order — the engine input',
    );
    assert.deepEqual(r1.stops[0], { stop_id: 'a1-1', latitude: 33.6844, longitude: 73.0479 });
  });

  it('does NOT list a route whose cached row matches its current stops', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing(ALL);
    assert.equal(
      result.items.some((item) => item.route_id === 'r2'),
      false,
      'R2 has a live row under its current hash — it is not missing',
    );
  });

  it('lists a route whose stops changed since its cached row (new hash, no row)', async () => {
    const fixture = mixedFixture();
    const { service } = serviceFor(fixture);
    const result = await service.listMissing(ALL);

    const r4 = result.items.find((item) => item.route_id === 'r4');
    assert.ok(r4, 'R4 moved a stop after its row was cached ⇒ missing');
    const currentHash = hashOf(fixture.stops.filter((stop) => stop.route_id === 'r4'));
    assert.equal(
      r4.stops_hash,
      currentHash,
      'the key is the CURRENT stop list, not the cached one',
    );
    assert.notEqual(r4.stops_hash, fixture.cache.find((row) => row.route_id === 'r4')?.stops_hash);
  });

  it('counts routes with fewer than two located stops as unlocated, never listed', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing(ALL);

    const listed = result.items.map((item) => item.route_id);
    assert.equal(listed.includes('r3'), false, 'R3 has one located stop');
    assert.equal(listed.includes('r5'), false, 'R5 has no stops at all');
    assert.equal(listed.includes('r6'), false, 'R6 stops belong to another school');
    assert.equal(result.totals.routes_unlocated, 3);
  });

  it('ignores stops tagged with another school, like the read path does', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing(ALL);

    const r6 = result.items.find((item) => item.route_id === 'r6');
    assert.equal(r6, undefined, 'R6 has two stops, but both belong to another school');
    const beta = result.schools.find((school) => school.school_id === SCHOOL_BETA);
    assert.equal(beta?.routes_unlocated, 2, 'R5 (no stops) and R6 (foreign stops)');
  });

  it('skips the routes of a school that no longer exists (soft-deleted)', async () => {
    const fixture = mixedFixture();
    fixture.routes.push({ id: 'gone', school_id: SCHOOL_GONE, name: 'Gone', code: 'G' });
    fixture.stops.push(
      ...stopsOf(
        'gone',
        SCHOOL_GONE,
        [
          [33.5, 73.0],
          [33.51, 73.01],
        ],
        'g-',
      ),
    );
    const { service } = serviceFor(fixture);
    const result = await service.listMissing(ALL);

    assert.equal(
      result.items.some((item) => item.route_id === 'gone'),
      false,
    );
    assert.equal(
      result.schools.some((school) => school.school_id === SCHOOL_GONE),
      false,
    );
  });
});

describe('MissingRouteGeometryService.listMissing — pagination', () => {
  it('pages over the full sorted missing set with no duplicates or gaps', async () => {
    const schoolStops: StopRow[] = [];
    const routes: RouteRow[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const id = `p${index}`;
      routes.push({ id, school_id: SCHOOL_ALPHA, name: `Pagination ${index}`, code: `P-${index}` });
      schoolStops.push(
        ...stopsOf(
          id,
          SCHOOL_ALPHA,
          [
            [33.6 + index / 100, 73.0],
            [33.61 + index / 100, 73.01],
          ],
          `${id}-`,
        ),
      );
    }
    const fixture: Fixture = {
      schools: [{ id: SCHOOL_ALPHA, name: 'Alpha School' }],
      routes,
      stops: schoolStops,
      cache: [],
    };
    const { service } = serviceFor(fixture);

    const first = await service.listMissing({ page: 1, limit: 2 });
    const second = await service.listMissing({ page: 2, limit: 2 });
    const third = await service.listMissing({ page: 3, limit: 2 });

    assert.deepEqual(first.meta, {
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    assert.equal(third.meta.hasNextPage, false);
    assert.equal(third.meta.hasPreviousPage, true);

    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.route_id);
    assert.deepEqual(ids, ['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('returns an empty page beyond the last one, with the true total', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing({ page: 9, limit: 20 });
    assert.deepEqual(result.items, []);
    assert.equal(result.meta.total, 2);
    assert.equal(result.meta.totalPages, 1);
  });
});

describe('MissingRouteGeometryService.listMissing — per-school counts and totals', () => {
  it('reports every school’s counts, even when the page holds only one school', async () => {
    const { service } = serviceFor(mixedFixture());
    const page = await service.listMissing({ page: 1, limit: 1 });

    assert.equal(page.items.length, 1, 'the page is one item');
    assert.deepEqual(
      page.schools.map((school) => school.school_name),
      ['Alpha School', 'Beta School'],
      'both schools are counted, sorted by name',
    );
  });

  it('gives counts that add up to each route exactly once', async () => {
    const { service } = serviceFor(mixedFixture());
    const { schools, totals } = await service.listMissing(ALL);

    const alpha = schools.find((school) => school.school_id === SCHOOL_ALPHA);
    const beta = schools.find((school) => school.school_id === SCHOOL_BETA);
    assert.deepEqual(alpha, {
      school_id: SCHOOL_ALPHA,
      school_name: 'Alpha School',
      routes_total: 3,
      routes_cached: 1,
      routes_missing: 1,
      routes_unlocated: 1,
      outsideBbox: null,
      fillable: 1,
    });
    assert.deepEqual(beta, {
      school_id: SCHOOL_BETA,
      school_name: 'Beta School',
      routes_total: 3,
      routes_cached: 0,
      routes_missing: 1,
      routes_unlocated: 2,
      outsideBbox: null,
      fillable: 1,
    });
    assert.deepEqual(totals, {
      routes_total: 6,
      routes_cached: 1,
      routes_missing: 2,
      routes_unlocated: 3,
      outsideBbox: null,
      fillable: 2,
    });
    for (const school of schools) {
      assert.equal(
        school.routes_cached + school.routes_missing + school.routes_unlocated,
        school.routes_total,
      );
    }
  });
});

describe('MissingRouteGeometryService.listMissing — cost', () => {
  it('reads with a fixed set of queries, whatever the number of schools and routes', async () => {
    const fixture = mixedFixture();
    const { service, calls } = serviceFor(fixture);
    await service.listMissing(ALL);

    assert.deepEqual(calls, { schools: 1, routes: 1, stops: 1, geometries: 1 });
  });
});

describe('MissingRouteGeometryService.listMissing — bbox filter', () => {
  // The Nagpur region, large enough to admit Alpha School's R1 (the stops
  // cluster around 33.68N, 73.05E) and the Beta R4 stops (33.8N, 73.1E).
  const NAGPUR_BBOX = '72.0,32.0,75.0,35.0';
  // A tighter box: maxLat 33.7 admits R1 (lat 33.68) but excludes R4
  // (lat 33.8) — the geometry the preflight + dry-run need to see.
  const NAGPUR_CENTRAL_BBOX = '72.0,33.0,74.0,33.7';

  it('without a bbox, every missing route has stopsOutsideBbox=null and fillable=missing', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing(ALL);

    for (const item of result.items) {
      assert.equal(item.stopsOutsideBbox, null, `${item.route_id} has no bbox info`);
    }
    for (const school of result.schools) {
      assert.equal(school.outsideBbox, null);
      // Without a bbox, every missing route is `fillable` (the run itself
      // finds the NoRoute / NoSegment ones per route, that's the point of
      // path C — the engine is asked, and the honest answer is reported).
      assert.equal(school.fillable, school.routes_missing);
    }
    assert.equal(result.totals.outsideBbox, null);
    assert.equal(result.totals.fillable, result.totals.routes_missing);
  });

  it('with a bbox that covers every stop, every missing route is fillable', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing({ ...ALL, bbox: NAGPUR_BBOX });

    for (const item of result.items) {
      assert.equal(item.stopsOutsideBbox, 0, `${item.route_id} is fully inside the box`);
    }
    for (const school of result.schools) {
      assert.equal(school.outsideBbox, 0);
      assert.equal(school.fillable, school.routes_missing);
    }
    assert.equal(result.totals.outsideBbox, 0);
    assert.equal(result.totals.fillable, result.totals.routes_missing);
  });

  it('with a smaller bbox, every route whose stops fall inside is fillable and the rest are not', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing({ ...ALL, bbox: NAGPUR_CENTRAL_BBOX });

    // Both R1 (Alpha, inside the box) and R4 (Beta, outside) are listed
    // (the engine will get NoRoute for R4), but only R1 is fillable.
    const r1 = result.items.find((item) => item.route_id === 'r1');
    const r4 = result.items.find((item) => item.route_id === 'r4');
    assert.ok(r1 && r4);
    assert.equal(r1.stopsOutsideBbox, 0);
    assert.equal(
      r4.stopsOutsideBbox,
      2,
      'both R4 stops sit at 33.8N, 73.1E — outside the central box',
    );

    const alpha = result.schools.find((school) => school.school_id === SCHOOL_ALPHA);
    const beta = result.schools.find((school) => school.school_id === SCHOOL_BETA);
    assert.deepEqual(
      { alpha: { outsideBbox: alpha?.outsideBbox, fillable: alpha?.fillable } },
      { alpha: { outsideBbox: 0, fillable: alpha?.routes_missing } },
    );
    assert.deepEqual(
      { beta: { outsideBbox: beta?.outsideBbox, fillable: beta?.fillable } },
      {
        beta: {
          outsideBbox: (beta?.routes_missing ?? 0) - 0,
          fillable: 0,
        },
      },
    );
    // The platform total is the sum of per-school counts.
    const expectedOutside = (alpha?.outsideBbox ?? 0) + (beta?.outsideBbox ?? 0);
    const expectedFillable = (alpha?.fillable ?? 0) + (beta?.fillable ?? 0);
    assert.equal(result.totals.outsideBbox, expectedOutside);
    assert.equal(result.totals.fillable, expectedFillable);
    assert.equal(result.totals.fillable + expectedOutside, result.totals.routes_missing);
  });

  it('annotates every listed item with its own stopsOutsideBbox count, even routes with all stops inside', async () => {
    const { service } = serviceFor(mixedFixture());
    const result = await service.listMissing({ ...ALL, bbox: NAGPUR_BBOX });

    for (const item of result.items) {
      assert.notEqual(item.stopsOutsideBbox, null, `${item.route_id} must carry the count`);
      assert.equal(
        (item.stopsOutsideBbox ?? -1) >= 0 && (item.stopsOutsideBbox ?? -1) <= item.stops.length,
        true,
        `${item.route_id} count is between 0 and the number of stops`,
      );
    }
  });

  it('rejects a bbox with a stop outside the range (minLon > maxLon), 400', async () => {
    const { service } = serviceFor(mixedFixture());
    await assert.rejects(
      () => service.listMissing({ ...ALL, bbox: '74.0,32.0,72.0,35.0' }),
      (error: { getStatus?: () => number; message: string }) => {
        assert.equal(error.getStatus?.(), 400);
        assert.match(error.message, /minLon must be strictly less than maxLon/);
        return true;
      },
    );
  });

  it('rejects a bbox whose latitude is out of range, 400', async () => {
    const { service } = serviceFor(mixedFixture());
    await assert.rejects(
      () => service.listMissing({ ...ALL, bbox: '72.0,-95.0,75.0,35.0' }),
      (error: { getStatus?: () => number; message: string }) => {
        assert.equal(error.getStatus?.(), 400);
        assert.match(error.message, /latitudes must lie in/);
        return true;
      },
    );
  });

  it('rejects a bbox whose longitude is out of range, 400', async () => {
    const { service } = serviceFor(mixedFixture());
    await assert.rejects(
      () => service.listMissing({ ...ALL, bbox: '72.0,32.0,195.0,35.0' }),
      (error: { getStatus?: () => number; message: string }) => {
        assert.equal(error.getStatus?.(), 400);
        assert.match(error.message, /longitudes must lie in/);
        return true;
      },
    );
  });

  it('rejects a bbox where minLat == maxLat (empty box), 400', async () => {
    const { service } = serviceFor(mixedFixture());
    await assert.rejects(
      () => service.listMissing({ ...ALL, bbox: '72.0,32.0,75.0,32.0' }),
      (error: { getStatus?: () => number; message: string }) => {
        assert.equal(error.getStatus?.(), 400);
        assert.match(error.message, /minLat must be strictly less than maxLat/);
        return true;
      },
    );
  });
});
