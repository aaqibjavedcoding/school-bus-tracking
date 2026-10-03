import { UniqueConstraintError } from 'sequelize';
import { NotFoundException } from '../../framework';
import type {
  RouteGeometryAvailableResponse,
  RouteGeometryLeg,
  RouteGeometryLineString,
  RouteGeometryResponse,
} from '@school-bus-tracking/shared-types';
import { Route, RouteGeometry, Stop } from '../../database/models';
import { ROUTE_NOT_FOUND_MESSAGE } from '../routes/routes.constants';
import { hashRouteStops } from './stops-hash';
import type { RoadRoute } from './osrm-response';
import type { RouteCoordinate } from './osrm.provider';

/**
 * Engine seam of the geometry cache. `OsrmRoutingProvider` implements it;
 * `null` at the service means routing is disabled on this deployment
 * (`ROUTING_SERVICE_URL` blank).
 */
export interface RouteGeometryProvider {
  readonly name: string;
  computeRoute(coordinates: readonly RouteCoordinate[]): Promise<RoadRoute | null>;
}

/** Everything the response mapping needs from a cache row. */
interface StoredGeometryRow {
  stops_hash: string;
  geometry: RouteGeometryLineString;
  distance_meters: number;
  duration_seconds: number;
  legs: RouteGeometryLeg[];
  provider: string;
  computed_at: Date;
}

/**
 * Read path of the road-following route geometry: tenant-pinned cache
 * lookup, compute-on-miss, store, serve.
 *
 * The economics of the feature live here:
 *
 *  - **Cache hit** is one indexed point lookup — zero engine traffic, zero
 *    reshaping (the row stores exactly the wire payload).
 *  - **Cache miss** performs at most ONE engine call per stop list,
 *    process-wide: concurrent readers join the single in-flight compute
 *    instead of each firing their own (the per-second engine throttle would
 *    otherwise turn twenty simultaneous "show my route" taps into twenty
 *    queued engine calls for identical output). Across processes the unique
 *    `(route_id, stops_hash)` index is the backstop — a loser of that race
 *    simply serves the winner's row.
 *  - **A failure is never cached.** `unavailable` means "cannot serve right
 *    now", and the next read tries the engine again; caching a failure
 *    would turn a 30-second engine restart into a permanent wrong answer.
 *  - **Tenant safety is structural**: the route lookup is pinned to the
 *    authenticated school, so a cross-tenant id gets the same generic 404
 *    as a nonexistent one, exactly like `GET /routes/:id`.
 */
export class RouteGeometryService {
  /**
   * Computes currently in flight, keyed `routeId:stopsHash`. Joined, never
   * duplicated; entries are dropped on settlement so a failed compute is
   * retried by the very next reader.
   */
  private readonly inFlight = new Map<string, Promise<RouteGeometryResponse>>();

  constructor(
    private readonly routes: typeof Route,
    private readonly stops: typeof Stop,
    private readonly geometries: typeof RouteGeometry,
    /** `null` disables road geometry deployment-wide: always `unavailable`. */
    private readonly provider: RouteGeometryProvider | null,
  ) {}

  /**
   * `GET /api/v1/routes/:id/geometry` — the cached road route, or
   * `{ status: 'unavailable' }` when routing is disabled, fewer than two
   * stops are located, or the engine could not compute a route.
   *
   * @throws NotFoundException when the route does not exist *in the
   *         authenticated school* — cross-tenant probes are indistinguishable
   *         from typos.
   */
  async getGeometry(schoolId: string, routeId: string): Promise<RouteGeometryResponse> {
    const route = await this.routes.findOne({
      where: { id: routeId, school_id: schoolId },
    });
    if (route === null) {
      throw new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
    }

    // Disabled deployments never touch the network — and skip the stop
    // query too, so the unavailable answer is also the cheapest one.
    if (this.provider === null) {
      return { status: 'unavailable' };
    }

    const stops = await this.stops.findAll({
      where: { route_id: routeId, school_id: schoolId },
      order: [['sequence_number', 'ASC']],
    });
    const located = stops.filter(
      (stop): stop is Stop & { latitude: number; longitude: number } =>
        stop.latitude !== null && stop.longitude !== null,
    );
    if (located.length < 2) {
      // Fewer than two surveyed points draw a dot, not a route.
      return { status: 'unavailable' };
    }

    const stopsHash = hashRouteStops(
      located.map((stop) => ({
        stopId: stop.id,
        latitude: stop.latitude,
        longitude: stop.longitude,
      })),
    );

    const cached = await this.geometries.findOne({
      where: { route_id: routeId, stops_hash: stopsHash },
    });
    if (cached !== null) {
      return toAvailableResponse(routeId, cached);
    }

    return this.computeOnce(routeId, stopsHash, located);
  }

  /**
   * The single-flight compute: every concurrent reader of the same
   * (route, stop list) awaits the same promise, so one miss costs one
   * engine call — never one per reader.
   */
  private computeOnce(
    routeId: string,
    stopsHash: string,
    located: Array<{ id: string; latitude: number; longitude: number }>,
  ): Promise<RouteGeometryResponse> {
    const key = `${routeId}:${stopsHash}`;
    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const flight = this.computeAndStore(routeId, stopsHash, located);
    this.inFlight.set(key, flight);
    // Drop the key on settlement: a success is cached in the DB, a failure
    // must be retried by the next reader — either way the flight is over.
    // The follow-up catch only disarms the derived promise; callers keep
    // the original outcome.
    flight
      .finally(() => {
        this.inFlight.delete(key);
      })
      .catch(() => undefined);
    return flight;
  }

  /** One engine call, one insert — or `unavailable`, which is never stored. */
  private async computeAndStore(
    routeId: string,
    stopsHash: string,
    located: Array<{ id: string; latitude: number; longitude: number }>,
  ): Promise<RouteGeometryResponse> {
    const provider = this.provider;
    if (provider === null) {
      return { status: 'unavailable' };
    }

    const coordinates: RouteCoordinate[] = located.map((stop) => [
      stop.longitude,
      stop.latitude,
    ]);
    const roadRoute = await provider.computeRoute(coordinates);
    if (roadRoute === null) {
      // Not cached by design: the next read retries the engine.
      return { status: 'unavailable' };
    }

    const row: StoredGeometryRow = {
      stops_hash: stopsHash,
      geometry: roadRoute.geometry,
      distance_meters: roadRoute.distanceMeters,
      duration_seconds: roadRoute.durationSeconds,
      legs: toStoredLegs(roadRoute),
      provider: provider.name,
      computed_at: new Date(),
    };

    try {
      await this.geometries.create({ route_id: routeId, ...row });
    } catch (error) {
      // Cross-process single-flight backstop: another worker computed the
      // same stop list first. Its row is exactly what we would have
      // written — serve it instead of erroring a perfectly good read.
      if (error instanceof UniqueConstraintError) {
        const winner = await this.geometries.findOne({
          where: { route_id: routeId, stops_hash: stopsHash },
        });
        if (winner !== null) {
          return toAvailableResponse(routeId, winner);
        }
      }
      throw error;
    }

    return toAvailableResponse(routeId, row);
  }
}

/** RoadRoute (engine vocabulary) → stored/served legs (wire vocabulary). */
function toStoredLegs(route: RoadRoute): RouteGeometryLeg[] {
  return route.legs.map((leg) => ({
    distance_meters: leg.distanceMeters,
    duration_seconds: leg.durationSeconds,
    maneuvers: leg.maneuvers.map((maneuver) => ({
      type: maneuver.type,
      modifier: maneuver.modifier,
      road_name: maneuver.roadName,
      distance_meters: maneuver.distanceMeters,
      location: maneuver.location,
    })),
  }));
}

/** The `status: 'ok'` payload of a stored row — the row IS the payload. */
function toAvailableResponse(
  routeId: string,
  row: StoredGeometryRow,
): RouteGeometryAvailableResponse {
  return {
    status: 'ok',
    route_id: routeId,
    stops_hash: row.stops_hash,
    geometry: row.geometry,
    distance_meters: row.distance_meters,
    duration_seconds: row.duration_seconds,
    legs: row.legs,
    provider: row.provider,
    computed_at: row.computed_at.toISOString(),
  };
}
