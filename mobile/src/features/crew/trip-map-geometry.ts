import type { Feature, LineString } from 'geojson';
import type {
  StopResponse,
  TripLocationHistoryResponse,
  TripLocationResponse,
} from '@school-bus-tracking/shared-types';
import { isValidCoordinate } from '../../lib/navigation.ts';

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
 *   a road route** — the platform has no routing engine (road-following
 *   geometry is a separate, backlog effort) — so the map's caption must say
 *   "planned order", and this module's shape keeps the two lines impossible
 *   to confuse: different sources, different colours, different layers.
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
