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
 * `https://maps.google.com/maps?daddr=…` is the portable form: Android
 * resolves it to Google Maps, iOS to Apple Maps (or Google Maps when
 * installed). It needs no app-specific scheme detection and no API key.
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
