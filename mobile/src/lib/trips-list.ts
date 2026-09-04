import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';

/**
 * Pure list-shaping helpers for the school-admin Trips screen.
 *
 * The screen renders `GET /trips` pages that the server already narrows by
 * status/day/search. These helpers add the client-side guarantees the render
 * itself needs, whatever the API in front of it does:
 *
 *  - **Identity.** The mobile-only "Live" filter merges two parallel
 *    `GET /trips` responses (BOARDING + IN_PROGRESS). A trip that transitions
 *    between the two statuses while both queries are in flight — or any
 *    response set that overlaps — must still render at most once, so every
 *    rendered row keeps a stable, genuinely unique React key (`trip.id`).
 *  - **Scoping.** The visible rows always honour the selected status chip,
 *    narrowed over the page that was actually loaded — the same philosophy as
 *    `filterByActive` for the other admin lists.
 *  - **Search.** Free-text search is sent to the API, and additionally matched
 *    client-side over the loaded rows (route, bus and crew, case-insensitive,
 *    partial and full-name). The server predicate compares a single term
 *    against single columns (`first_name`/`last_name` separately), so a full
 *    name typed as displayed ("Ada Lovelace") would otherwise never match;
 *    the client match also keeps the list usable when the API does not apply
 *    the `search` parameter at all.
 */

/** Mobile-only convenience filter value (not a `TripStatus`). */
export const LIVE_FILTER = 'LIVE';

/** The statuses aggregated by the "Live" filter. */
export const LIVE_STATUSES: readonly TripStatus[] = [TripStatus.BOARDING, TripStatus.IN_PROGRESS];

/** Chip values of the trips status bar: '' (all), LIVE, or a single status. */
export type TripStatusFilter = TripStatus | typeof LIVE_FILTER | '';

/**
 * Stable, order-preserving de-duplication of trips by id. The first occurrence
 * wins, so a merged "Live" list keeps the row from the status page that was
 * requested first.
 */
export function uniqueTripsById(trips: readonly TripResponse[]): TripResponse[] {
  const seen = new Set<string>();
  const unique: TripResponse[] = [];
  for (const trip of trips) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    unique.push(trip);
  }
  return unique;
}

/** True when the trip belongs to the given status chip ('' = all statuses). */
export function tripMatchesStatusFilter(trip: TripResponse, filter: TripStatusFilter): boolean {
  if (filter === '') return true;
  if (filter === LIVE_FILTER) return LIVE_STATUSES.includes(trip.status);
  return trip.status === filter;
}

/** Lower-cased haystack of every searchable text a trip row displays. */
function searchableText(trip: TripResponse): string {
  return [
    trip.route_name,
    trip.route_code,
    trip.bus_number,
    trip.registration_number,
    trip.driver_name,
    trip.conductor_name,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

/**
 * Case-insensitive, partial-match search over route name/code, bus
 * number/registration and driver/conductor names (including full names with
 * the space between first and last, which the server cannot match).
 */
export function tripMatchesSearch(trip: TripResponse, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return searchableText(trip).includes(needle);
}

/**
 * Narrows loaded trips to the rows the screen should render: unique by id,
 * inside the selected status chip and matching the active (trimmed) search.
 */
export function visibleTrips(
  trips: readonly TripResponse[],
  filter: TripStatusFilter,
  search: string,
): TripResponse[] {
  return uniqueTripsById(
    trips.filter(
      (trip) => tripMatchesStatusFilter(trip, filter) && tripMatchesSearch(trip, search),
    ),
  );
}
