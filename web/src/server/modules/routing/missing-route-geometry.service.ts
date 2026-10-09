import { Op } from 'sequelize';
import type {
  MissingRouteGeometryItem,
  MissingRouteGeometryListResponse,
  MissingRouteGeometrySchoolCount,
  MissingRouteGeometryTotals,
  PaginationMeta,
  RouteGeometryStopPoint,
} from '@school-bus-tracking/shared-types';
import { RouteGeometry, Route, School, Stop } from '../../database/models';
import { hashRouteStops } from './stops-hash';
import {
  isInsideBbox,
  type ParsedBoundingBox,
  parseBoundingBox,
} from './dto/list-missing-route-geometry-query.dto';

/** Pagination + optional bbox of the missing list (the bbox is parsed upstream). */
export interface MissingRouteGeometryQuery {
  page: number;
  limit: number;
  /** Raw `bbox=minLon,minLat,maxLon,maxLat` — parsed here, fed to the service. */
  bbox?: string;
}

/**
 * The platform-wide view of the forever-cache: which routes, across EVERY
 * school, have no cached geometry for their CURRENT stop list.
 *
 * A route is **missing** when it has at least two located stops and no live
 * row under the hash those stops produce NOW. Consequences that the backfill
 * relies on:
 *
 *  - a route whose stops changed since its cached row is missing (new stop
 *    list ⇒ new hash ⇒ no row under it);
 *  - a route with a cached row for its current stops is NOT listed;
 *  - a route with fewer than two located stops is counted as
 *    `routes_unlocated` and never listed — there is nothing to route.
 *
 * The hash is the same {@link hashRouteStops} the read and write paths use,
 * over the same located stops in the same order, so "listed here" and
 * "served as a cache hit there" can never disagree.
 *
 * When the caller passes a `bbox` (= the OSRM extract's box), every listed
 * route is annotated with `stopsOutsideBbox` and the per-school and platform
 * totals gain `outsideBbox` (routes with at least one stop outside) and
 * `fillable` (`missing - outsideBbox`, i.e. the routes the engine can
 * actually fill from this extract). A route with a stop outside the bbox
 * stays in `items`: the run still has to report it, and an OSRM answer
 * (`NoRoute` / `NoSegment`) is what the engine will give anyway. The
 * `outsideBbox` field exists so the platform backfill and its dry-run
 * preflight can tell "nothing to do" from "lots to do, but the engine
 * doesn't have the map for it".
 *
 * Cost: four set-based queries (schools, routes, located stops, live cache
 * keys) whatever the number of schools — no per-route or per-school round
 * trip. Routes of a soft-deleted school are skipped: the school is gone.
 */
export class MissingRouteGeometryService {
  constructor(
    private readonly routes: typeof Route,
    private readonly stops: typeof Stop,
    private readonly geometries: typeof RouteGeometry,
    private readonly schools: typeof School,
  ) {}

  /**
   * One page of the missing routes, plus per-school counts and platform
   * totals computed over ALL schools.
   */
  async listMissing(query: MissingRouteGeometryQuery): Promise<MissingRouteGeometryListResponse> {
    const parsedBbox: ParsedBoundingBox | undefined = query.bbox
      ? parseBoundingBox(query.bbox)
      : undefined;

    const [schoolRows, routeRows, stopRows, cacheRows] = await Promise.all([
      this.schools.findAll({ attributes: ['id', 'name'] }),
      this.routes.findAll({ attributes: ['id', 'school_id', 'name', 'code'] }),
      this.stops.findAll({
        attributes: ['id', 'route_id', 'school_id', 'latitude', 'longitude', 'sequence_number'],
        where: { latitude: { [Op.not]: null }, longitude: { [Op.not]: null } },
        order: [['sequence_number', 'ASC']],
      }),
      this.geometries.findAll({ attributes: ['route_id', 'stops_hash'] }),
    ]);

    const schoolNames = new Map<string, string>(
      schoolRows.map((school) => [school.id, school.name]),
    );

    // Located stops grouped by route, manifest order preserved (the query
    // is ordered by sequence_number and grouping keeps that order).
    const stopsByRoute = new Map<string, Array<Stop & { latitude: number; longitude: number }>>();
    for (const stop of stopRows) {
      if (stop.latitude === null || stop.longitude === null) {
        continue;
      }
      const bucket = stopsByRoute.get(stop.route_id) ?? [];
      bucket.push(stop as Stop & { latitude: number; longitude: number });
      stopsByRoute.set(stop.route_id, bucket);
    }

    const cachedKeys = new Set(cacheRows.map((row) => cacheKey(row.route_id, row.stops_hash)));

    const countsBySchool = new Map<string, MissingRouteGeometrySchoolCount>();
    const missing: MissingRouteGeometryItem[] = [];

    for (const route of routeRows) {
      const schoolName = schoolNames.get(route.school_id);
      if (schoolName === undefined) {
        continue;
      }

      let counts = countsBySchool.get(route.school_id);
      if (counts === undefined) {
        counts = {
          school_id: route.school_id,
          school_name: schoolName,
          routes_total: 0,
          routes_cached: 0,
          routes_missing: 0,
          routes_unlocated: 0,
          outsideBbox: parsedBbox === undefined ? null : 0,
          fillable: 0,
        };
        countsBySchool.set(route.school_id, counts);
      }
      counts.routes_total += 1;

      // Same scoping as the read path: the route's own stops in its own school.
      const located = (stopsByRoute.get(route.id) ?? []).filter(
        (stop) => stop.school_id === route.school_id,
      );
      if (located.length < 2) {
        counts.routes_unlocated += 1;
        continue;
      }

      const points: RouteGeometryStopPoint[] = located.map((stop) => ({
        stop_id: stop.id,
        latitude: stop.latitude,
        longitude: stop.longitude,
      }));
      const stopsHash = hashRouteStops(
        points.map((point) => ({
          stopId: point.stop_id,
          latitude: point.latitude,
          longitude: point.longitude,
        })),
      );

      if (cachedKeys.has(cacheKey(route.id, stopsHash))) {
        counts.routes_cached += 1;
        continue;
      }

      counts.routes_missing += 1;

      // Count stops outside the caller's bbox, when one was given. The
      // route stays in the list regardless: the platform backfill still
      // wants to print it, and the engine will return NoRoute for the
      // ones it has no map for (the honest dashed-line fallback).
      // Without a bbox every missing route is `fillable` by definition —
      // the run itself finds the NoRoute / NoSegment ones per route.
      let stopsOutsideBbox: number | null = null;
      if (parsedBbox === undefined) {
        counts.fillable += 1;
      } else {
        stopsOutsideBbox = points.reduce(
          (count, point) =>
            isInsideBbox(parsedBbox, point.longitude, point.latitude) ? count : count + 1,
          0,
        );
        if (stopsOutsideBbox > 0) {
          counts.outsideBbox = (counts.outsideBbox ?? 0) + 1;
        } else {
          counts.fillable += 1;
        }
      }

      missing.push({
        route_id: route.id,
        route_name: route.name,
        route_code: route.code,
        school_id: route.school_id,
        school_name: schoolName,
        stops_hash: stopsHash,
        stops: points,
        stopsOutsideBbox,
      });
    }

    missing.sort(
      (a, b) =>
        compareText(a.school_name, b.school_name) ||
        compareText(a.route_name, b.route_name) ||
        compareText(a.route_id, b.route_id),
    );

    const schools = [...countsBySchool.values()].sort(
      (a, b) => compareText(a.school_name, b.school_name) || compareText(a.school_id, b.school_id),
    );

    const totals: MissingRouteGeometryTotals = {
      routes_total: 0,
      routes_cached: 0,
      routes_missing: 0,
      routes_unlocated: 0,
      outsideBbox: parsedBbox === undefined ? null : 0,
      fillable: 0,
    };
    for (const counts of schools) {
      totals.routes_total += counts.routes_total;
      totals.routes_cached += counts.routes_cached;
      totals.routes_missing += counts.routes_missing;
      totals.routes_unlocated += counts.routes_unlocated;
      totals.fillable += counts.fillable;
      if (parsedBbox !== undefined) {
        totals.outsideBbox = (totals.outsideBbox ?? 0) + (counts.outsideBbox ?? 0);
      }
    }

    const total = missing.length;
    const totalPages = Math.ceil(total / query.limit);
    const offset = (query.page - 1) * query.limit;
    const meta: PaginationMeta = {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    };

    return {
      items: missing.slice(offset, offset + query.limit),
      meta,
      schools,
      totals,
    };
  }
}

/** One live cache key, `route_id:stops_hash` (route ids are UUIDs, no colon). */
function cacheKey(routeId: string, stopsHash: string): string {
  return `${routeId}:${stopsHash}`;
}

/** Locale-free, deterministic string order (stable pages across runs). */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
