import type { Feature, LineString, Point, Polygon } from 'geojson';
import type {
  RouteGeometryLineString,
  StopResponse,
  TripLocationHistoryResponse,
  TripLocationResponse,
} from '@school-bus-tracking/shared-types';
import { isValidCoordinate } from '../../lib/navigation.ts';
import { accuracyCirclePolygon } from '../map/accuracy-circle.ts';
import { projectOntoRoute } from '../map/route-snap.ts';
import { arrivalZoneOfStop } from './arrival-zone.ts';

/**
 * Driver-map line geometry — pure, React-free, MapLibre-free.
 *
 * The Driver Trip map draws two honest lines next to the stops, and the whole
 * point of this module is that *what each line may claim* is decided here,
 * where a spec can pin it, not inside a render function where a shortcut is
 * one edit away:
 *
 * - **the trail** (`buildTrailLine`) — where this bus has actually been, from
 *   the fixes the server recorded (`GET /trips/:id/location/history`, oldest
 *   first). It is drawn as a dotted breadcrumb, and it is the only line on the
 *   map allowed to be described as "driven";
 * - **the planned legs** (`buildPlannedLegsLine`) — what is *ahead*: straight
 *   stop-to-stop segments from the next stop onward. This is explicitly **not
 *   a road route** — straight lines between stops, with no knowledge of the
 *   roads between them — so whenever it is drawn the map's caption must say
 *   "planned order";
 * - **the road route** (`buildRoadRouteLine`) — what is *ahead*, on the roads:
 *   the routing engine's cached polyline for this route (`GET
 *   /routes/:id/geometry`), trimmed to start at the next stop. It replaces the
 *   planned legs whenever it can be drawn honestly; `null` hands the line back
 *   to `buildPlannedLegsLine`, so the amber "ahead" line always exists in
 *   exactly one shape and the caption follows the shape (see
 *   `map.roadNotice` / `map.plannedNotice`).
 *
 * The map component decides *colours and dash patterns*; this module only
 * decides *what geometry exists*. Every function returns `null` for "nothing
 * to draw" instead of an empty feature, so the surface never adds a source
 * for an invisible line, and every input is filtered through
 * `isValidCoordinate` so a NaN or out-of-range coordinate can never reach a
 * GeoJSON payload.
 */

/**
 * Stops from the next stop onward, in route order — the stops the bus has yet
 * to reach. The next-stop id comes from `deriveTripProgressForTrip` (server
 * `next_stop` behind the client frontier); the map never picks a next stop of
 * its own, and an id that is not one of the route's stops draws nothing.
 */
export function upcomingStopsFrom(
  stops: readonly StopResponse[],
  nextStopId: string | null | undefined,
): StopResponse[] {
  if (!nextStopId) return [];
  const sorted = [...stops].sort((a, b) => a.sequence_number - b.sequence_number);
  const index = sorted.findIndex((stop) => stop.id === nextStopId);
  if (index < 0) return [];
  return sorted.slice(index);
}

/**
 * The travelled path as one LineString, or `null` with fewer than two usable
 * fixes. Invalid coordinates are dropped, not trusted; a fix list that
 * collapses to fewer than two valid points has no line to draw.
 */
export function buildTrailLine(
  fixes: ReadonlyArray<Pick<TripLocationResponse, 'latitude' | 'longitude'>>,
): Feature<LineString> | null {
  const coordinates: Array<[number, number]> = [];
  for (const fix of fixes) {
    if (!isValidCoordinate(fix.latitude, fix.longitude)) continue;
    coordinates.push([fix.longitude, fix.latitude]);
  }
  if (coordinates.length < 2) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

/**
 * The planned stop-to-stop line from the next stop to the end of the route,
 * or `null` when there is nothing ahead (no next stop, unknown id, fewer than
 * two mapped stops ahead). Stops without usable coordinates are skipped —
 * the ETA service already refuses to record arrivals for them, so drawing a
 * leg to a guessed coordinate would be the lie this file exists to prevent.
 */
export function buildPlannedLegsLine(
  stops: readonly StopResponse[],
  nextStopId: string | null | undefined,
): Feature<LineString> | null {
  const ahead = upcomingStopsFrom(stops, nextStopId);
  const coordinates: Array<[number, number]> = [];
  for (const stop of ahead) {
    if (stop.latitude === null || stop.longitude === null) continue;
    if (!isValidCoordinate(stop.latitude, stop.longitude)) continue;
    coordinates.push([stop.longitude, stop.latitude]);
  }
  if (coordinates.length < 2) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

/**
 * Two coordinates closer than this (in degrees — ~0.1 mm) are the same road
 * vertex: the projector's spherical interpolation lands a fraction of a
 * micrometre short of an exact vertex, and such a start must not be drawn as
 * a duplicate of the vertex it landed on.
 */
const ROAD_VERTEX_EPSILON_DEGREES = 1e-9;

/** True when two `[longitude, latitude]` pairs are the same vertex. */
function coincidentCoordinate(a: [number, number], b: [number, number]): boolean {
  return (
    Math.abs(a[0] - b[0]) < ROAD_VERTEX_EPSILON_DEGREES &&
    Math.abs(a[1] - b[1]) < ROAD_VERTEX_EPSILON_DEGREES
  );
}

/**
 * The road route ahead — the routing engine's polyline for this route,
 * trimmed to start at the next stop — or `null`, in which case
 * `buildPlannedLegsLine` stays the fallback.
 *
 * `roadGeometry` is the `GET /routes/:id/geometry` payload (or the offline
 * copy of one — see `offline/route-geometry-core.ts`); it is NOT trusted:
 * anything that is not a LineString with at least two coordinates that pass
 * `isValidCoordinate` draws nothing.
 *
 * The trim reuses the display-only projector `projectOntoRoute`
 * (`../map/route-snap.ts`): the next stop is projected onto the road polyline
 * and everything behind the projected point is dropped, so the line shows the
 * road from the next stop to the end of the route — never the kilometres the
 * bus has already driven. `null` (fallback) whenever the road line cannot
 * honestly serve this trip:
 *
 * - no next stop, an id that is not one of this route's stops, or a next stop
 *   without surveyed coordinates — the same inputs `buildPlannedLegsLine`
 *   requires, so the two lines can never disagree about where "ahead" starts
 *   (and the map never picks a next stop of its own here either);
 * - the next stop sits farther than `SNAP_TO_ROUTE_MAX_OFFSET_M` from the
 *   road line. The engine routes **through** every stop, so a stop well off
 *   the line means the geometry is not this stop list's road (a stale cached
 *   shape after a stop was moved) — and drawing it would claim a road this
 *   route does not take;
 * - fewer than two coordinates remain ahead (the next stop is the last stop:
 *   nothing is ahead on either line — `buildPlannedLegsLine` returns `null`
 *   for the same input).
 */
export function buildRoadRouteLine(
  roadGeometry: RouteGeometryLineString | null | undefined,
  { fromStopId, stops }: { fromStopId: string | null | undefined; stops: readonly StopResponse[] },
): Feature<LineString> | null {
  if (!roadGeometry || roadGeometry.type !== 'LineString') return null;
  if (!Array.isArray(roadGeometry.coordinates)) return null;

  // The road polyline, filtered by the module's own coordinate rule: a NaN or
  // out-of-range pair from a mangled payload is dropped, never trusted.
  const road: Array<[number, number]> = [];
  for (const coordinate of roadGeometry.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
    const [longitude, latitude] = coordinate;
    if (typeof longitude !== 'number' || typeof latitude !== 'number') continue;
    if (!isValidCoordinate(latitude, longitude)) continue;
    road.push([longitude, latitude]);
  }
  if (road.length < 2) return null;

  // The same next-stop rule as the planned legs: known id, surveyed stop.
  const nextStop = fromStopId ? (stops.find((stop) => stop.id === fromStopId) ?? null) : null;
  if (!nextStop || nextStop.latitude === null || nextStop.longitude === null) return null;
  if (!isValidCoordinate(nextStop.latitude, nextStop.longitude)) return null;

  // Where "ahead" starts on the road: the point of the polyline nearest the
  // next stop. `null` here is the honesty guard — the stop is not on this
  // road, so this is not this route's road.
  const projection = projectOntoRoute(
    { latitude: nextStop.latitude, longitude: nextStop.longitude },
    road.map(([longitude, latitude]) => ({ latitude, longitude })),
  );
  if (!projection) return null;
  if (!isValidCoordinate(projection.point.latitude, projection.point.longitude)) return null;

  const start: [number, number] = [projection.point.longitude, projection.point.latitude];
  const tail = road.slice(projection.segmentIndex + 1);
  // The projector's spherical math lands a hair short of an exact vertex, so
  // "start at the vertex" is decided by proximity, not by fraction: a start
  // that coincides with the first kept vertex (to ~0.1 mm) must not be drawn
  // twice, and a projection that landed on a vertex simply starts there.
  const coordinates =
    tail.length === 0 || coincidentCoordinate(start, tail[0]) ? tail : [start, ...tail];
  if (coordinates.length < 2) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

/**
 * The location-history payload of the trip on screen, or `[]` otherwise.
 *
 * The history loader keeps the previous trip's payload while the next request
 * is in flight (`useLoad` never blanks data on a dependency change) — and a
 * trail that keeps playing the previous run's path across a trip switch is
 * exactly the T1 bug in a new costume, so the payload must name the trip it
 * was recorded for, like `etaForTrip` does for ETAs.
 */
export function historyFixesForTrip(
  history: TripLocationHistoryResponse | null | undefined,
  tripId: string | null | undefined,
): TripLocationResponse[] {
  if (!history || !tripId) return [];
  if (history.trip_id !== tripId) return [];
  return history.items;
}

/**
 * The NEXT stop's arrival-zone circle, or `null` when there is nothing to
 * draw (deep-fix R1).
 *
 * The radius is the stop's **effective** radius — `effective_radius_meters`
 * as the SERVER computed it — the same circle the server's arrival engine
 * evaluates, so a driver standing inside the dashed ring is standing inside
 * the zone that records the stop. Only the next stop gets a zone: the map
 * stays clean, and "which circle am I in" has one answer.
 *
 * `null` (never an empty feature) whenever the next stop is unknown, not on
 * the loaded list, or has no surveyed coordinates — the same honesty rule as
 * the lines above: nothing is drawn from a guessed position.
 */
export function buildArrivalZonePolygon(
  stops: readonly StopResponse[],
  nextStopId: string | null | undefined,
): Feature<Polygon> | null {
  if (!nextStopId) return null;
  const nextStop = stops.find((stop) => stop.id === nextStopId) ?? null;
  const zone = arrivalZoneOfStop(nextStop);
  if (!zone) return null;
  if (!isValidCoordinate(zone.center.latitude, zone.center.longitude)) return null;
  return accuracyCirclePolygon(zone.center, zone.radiusMeters);
}

/**
 * The next stop's exact surveyed coordinate as a point feature, or `null`
 * when there is nothing honest to draw.
 *
 * Drawn as a small solid dot inside the dashed ring: the ring says "the zone
 * that records this stop", the dot says "the stop itself". Before this the
 * map drew only a filled disc, and drivers read the whole disc as the stop.
 */
export function buildArrivalZoneCenter(
  stops: readonly StopResponse[],
  nextStopId: string | null | undefined,
): Feature<Point> | null {
  if (!nextStopId) return null;
  const nextStop = stops.find((stop) => stop.id === nextStopId) ?? null;
  const zone = arrivalZoneOfStop(nextStop);
  if (!zone) return null;
  if (!isValidCoordinate(zone.center.latitude, zone.center.longitude)) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [zone.center.longitude, zone.center.latitude] },
  };
}
