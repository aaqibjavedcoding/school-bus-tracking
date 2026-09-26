/**
 * Google Maps navigation hand-off for the web crew console (`/crew`).
 *
 * Mirrors `mobile/src/lib/navigation.ts` + `mobile/src/features/crew/navigation-stop.ts`:
 * the self-hosted stack has no routing service, and adding one (a paid
 * directions API or map SDK) is explicitly out of scope. Navigation is a
 * **hand-off**: the page builds the documented Google Maps URL-API deep link
 * (`/maps/dir/?api=1…&dir_action=navigate`) and opens it in a new tab — on a
 * crew phone that lands in the map app's turn-by-turn, on a desktop it opens
 * the maps website. No key, no account, no metered request, nothing beyond
 * the destination the driver already has ever leaves the browser.
 *
 * Everything in this file is pure (no React, no DOM) so it is testable with
 * the Node runner — see `navigation.spec.ts`, registered in `test:web`.
 */

/** A destination the driver may want to drive to. */
export interface NavigationTarget {
  name: string;
  latitude: number;
  longitude: number;
}

/** The route-stop slice this module needs — structural, never the full DTO. */
export interface NavigableStopLike {
  id: string;
  name: string;
  sequence_number: number;
  latitude: number | null;
  longitude: number | null;
}

/** Google's own cap for `waypoints=` on the URL API. */
export const MAX_WAYPOINTS_PER_URL = 9;

/** Practical URL ceiling; longer links get truncated by some launchers. */
export const MAX_URL_LENGTH = 2048;

/** The only travel mode a school bus ever uses. */
export type TravelMode = 'driving';

export interface DirectionsRequest {
  /** The stop to drive to **now** (the next stop). */
  destination: NavigationTarget;
  /** The stops after it, in route order. Invalid ones are skipped. */
  waypoints?: readonly NavigationTarget[];
  travelmode?: TravelMode;
}

/** Guards against `NaN` / out-of-range coordinates reaching a URL. */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** `19.076,72.8777` — six decimals (~10 cm), trailing zeros dropped. */
export function formatLatLng(latitude: number, longitude: number): string {
  return `${Number(latitude.toFixed(6))},${Number(longitude.toFixed(6))}`;
}

/** Drops targets whose coordinates could send the bus somewhere wrong. */
export function filterNavigableTargets(
  targets: readonly NavigationTarget[] | undefined,
): NavigationTarget[] {
  return (targets ?? []).filter((target) => isValidCoordinate(target.latitude, target.longitude));
}

/**
 * A stop is only a navigation target once it carries real, in-range
 * coordinates — the "never navigate to a guessed coordinate" rule lives here.
 */
export function navigationTargetOf(stop: NavigableStopLike): NavigationTarget | null {
  if (stop.latitude === null || stop.longitude === null) {
    return null;
  }
  if (!isValidCoordinate(stop.latitude, stop.longitude)) {
    return null;
  }
  return { name: stop.name, latitude: stop.latitude, longitude: stop.longitude };
}

export function isNavigableStop(stop: NavigableStopLike): boolean {
  return navigationTargetOf(stop) !== null;
}

/**
 * One directions link that starts turn-by-turn guidance — byte-identical to
 * the link the mobile app builds (`buildDirectionsUrl` in
 * `mobile/src/lib/navigation.ts`), so a driver switching between phone and
 * web lands in exactly the same place.
 *
 * No `origin` is sent on purpose: the map app then uses the device's current
 * location, which is always fresher than anything this page could pass.
 * Returns `null` when the destination has no usable coordinates — the caller
 * shows no button rather than a button to nowhere.
 */
export function buildDirectionsUrl(request: DirectionsRequest): string | null {
  const { destination } = request;
  if (!isValidCoordinate(destination.latitude, destination.longitude)) {
    return null;
  }
  const waypoints = filterNavigableTargets(request.waypoints).slice(0, MAX_WAYPOINTS_PER_URL);
  const parts = [
    'api=1',
    `destination=${formatLatLng(destination.latitude, destination.longitude)}`,
  ];
  if (waypoints.length > 0) {
    const encoded = waypoints
      .map((point) => formatLatLng(point.latitude, point.longitude))
      .join('|');
    parts.push(`waypoints=${encoded}`);
  }
  parts.push(`travelmode=${request.travelmode ?? 'driving'}`);
  parts.push('dir_action=navigate');
  return `https://www.google.com/maps/dir/?${parts.join('&')}`;
}

/**
 * The whole remaining route as a series of links (long-route fallback).
 *
 * A long route does not fit one link: the URL API takes at most
 * {@link MAX_WAYPOINTS_PER_URL} waypoints, and some launchers truncate past
 * {@link MAX_URL_LENGTH} characters. So the stops are cut into consecutive
 * chunks — chunk *n+1* starts where chunk *n* ended, so no stop is lost and
 * the order is preserved. Returns `[]` when nothing is navigable.
 */
export function buildDirectionsUrlChunks(request: DirectionsRequest): string[] {
  const ordered = filterNavigableTargets([request.destination, ...(request.waypoints ?? [])]);
  if (ordered.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let index = 0;
  while (index < ordered.length) {
    let size = Math.min(MAX_WAYPOINTS_PER_URL + 1, ordered.length - index);
    let url: string | null = null;
    while (size >= 1) {
      const slice = ordered.slice(index, index + size);
      const candidate = buildDirectionsUrl({
        destination: slice[0],
        waypoints: slice.slice(1),
        travelmode: request.travelmode,
      });
      if (candidate && candidate.length <= MAX_URL_LENGTH) {
        url = candidate;
        break;
      }
      size -= 1;
    }
    if (!url) {
      // A single stop cannot exceed the ceiling; this is unreachable defence.
      break;
    }
    chunks.push(url);
    index += size;
  }
  return chunks;
}

/**
 * The link for "Navigate" on the crew page: the next stop as destination and
 * the stops after it (route order, un-arrived, navigable) as waypoints —
 * turn-by-turn for the leg the driver is on, with the rest of the run already
 * loaded in the map app.
 */
export function buildCrewRouteUrl(
  nextStop: NavigableStopLike,
  upcomingStops: readonly NavigableStopLike[],
): string | null {
  const destination = navigationTargetOf(nextStop);
  if (!destination) {
    return null;
  }
  const waypoints = upcomingStops
    .filter((stop) => stop.id !== nextStop.id)
    .slice()
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((stop) => navigationTargetOf(stop))
    .filter((target): target is NavigationTarget => target !== null);
  return buildDirectionsUrl({ destination, waypoints, travelmode: 'driving' });
}
