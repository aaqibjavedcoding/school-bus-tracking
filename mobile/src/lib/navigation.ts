/**
 * Turn-by-turn hand-off to the device's own map application (Task 44).
 *
 * The self-hosted stack has no routing service and adding one (a paid
 * directions API) is explicitly out of scope, so navigation is a **hand-off**:
 * the app builds a standard maps URL and lets the platform's own map app do
 * the routing. That is a device feature, not a third-party service — no key,
 * no account, no cost, nothing leaves the phone beyond the destination the
 * driver already has.
 *
 * The helpers are pure so they are testable without React Native.
 */

/** A destination the driver may want to drive to. */
export interface NavigationTarget {
  name: string;
  latitude: number;
  longitude: number;
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

/**
 * The maps URL for one destination.
 *
 * `https://maps.google.com/maps?daddr=…` is the portable form: Android opens
 * it in the device's own maps app, iOS in Apple Maps (or an installed
 * alternative). It is a hand-off to a device feature — no app-specific scheme
 * detection and no API key involved.
 */
export function buildNavigationUrl(target: NavigationTarget): string | null {
  if (!isValidCoordinate(target.latitude, target.longitude)) {
    return null;
  }
  const destination = `${target.latitude},${target.longitude}`;
  const query = new URLSearchParams({ daddr: destination });
  return `https://maps.google.com/maps?${query.toString()}`;
}

/** "19.0760, 72.8777" — six decimals is ~10 cm, plenty for a bus stop. */
export function formatCoordinate(latitude: number, longitude: number): string {
  if (!isValidCoordinate(latitude, longitude)) {
    return '—';
  }
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/* ------------------------------------------------------------------ *
 * Turn-by-turn hand-off (PR 3)
 *
 * Until now the card opened a *preview* link (`maps?daddr=`), which shows the
 * route but does not start guidance. The driver then had to press "Start"
 * inside the map app at the kerb. These helpers build the documented
 * URL-API deep link instead (`/maps/dir/?api=1…&dir_action=navigate`), which
 * lands straight in turn-by-turn.
 *
 * Still a hand-off, still free: it is a URL, not an SDK. No key, no account,
 * no metered request — the routing happens inside the map application the
 * phone already ships with.
 * ------------------------------------------------------------------ */

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
 * One directions link that starts guidance.
 *
 * No `origin` is sent on purpose: the map app then uses the phone's current
 * location, which is always fresher than anything this app could pass.
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
 * The whole remaining route as a series of links.
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
 * The single-stop link that starts guidance on this platform.
 *
 * Android has a documented, free navigation intent (`google.navigation:q=…`)
 * that skips the preview screen entirely. iOS has no such scheme we are
 * allowed to use — the app-specific scheme is deliberately **not** used
 * anywhere (it is on the banned-pattern list) — so iOS gets the https link,
 * which opens the installed map app or the web.
 */
export function buildTurnByTurnUrl(
  target: NavigationTarget,
  platform: 'ios' | 'android' | string,
): string | null {
  if (!isValidCoordinate(target.latitude, target.longitude)) {
    return null;
  }
  if (platform === 'android') {
    return `google.navigation:q=${formatLatLng(target.latitude, target.longitude)}`;
  }
  return buildDirectionsUrl({ destination: target, travelmode: 'driving' });
}
