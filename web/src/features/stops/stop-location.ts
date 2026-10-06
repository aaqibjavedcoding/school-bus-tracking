/**
 * Pure coordinate/geolocation logic behind the stop location picker.
 *
 * Kept free of React and MapLibre so it runs under `node --test`
 * (`scripts/run-specs.mjs web-client`) without a DOM or a map engine.
 *
 * Map provider policy: this feature uses the repository's existing free stack
 * (maplibre-gl + the self-hosted OpenFreeMap style). No key, no billing, no
 * geocoding/search of any kind — the address field stays manual.
 */

/** Longitude/latitude pair in MapLibre order (`[lng, lat]`). */
export type LngLat = [number, number];

/** The two form inputs the picker reads and writes, as raw strings. */
export type StopCoordinates = { latitude: string; longitude: string };

/**
 * Display-only fallback centre: Nagpur, Maharashtra.
 *
 * Used **only** to give an empty map somewhere to look. It is never written
 * into the form and therefore never reaches the create/update payload.
 */
export const FALLBACK_CENTER: LngLat = [79.0882, 21.1458];

/** Zoom used when the form already has a coordinate. */
export const SELECTED_ZOOM = 16;
/** Zoom used for the display-only fallback view. */
export const FALLBACK_ZOOM = 11;

/** Decimal places kept when a map interaction writes a coordinate (~0.1 m). */
export const COORDINATE_PRECISION = 6;

/** Formats a coordinate for the form inputs. */
export function formatCoordinate(value: number): string {
  return value.toFixed(COORDINATE_PRECISION);
}

/** True when both numbers are finite and inside the WGS84 ranges. */
export function isValidLatLng(latitude: number, longitude: number): boolean {
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
 * Parses the two raw inputs into a map position.
 *
 * Returns `null` for anything that must not move the marker: empty, partial
 * (one side filled), whitespace, `NaN`, `-`, `1e999`, or out-of-range values.
 */
export function parseCoordinates(value: StopCoordinates): LngLat | null {
  const rawLat = value.latitude.trim();
  const rawLng = value.longitude.trim();
  if (rawLat === '' || rawLng === '') return null;
  const latitude = Number(rawLat);
  const longitude = Number(rawLng);
  if (!isValidLatLng(latitude, longitude)) return null;
  return [longitude, latitude];
}

/** The camera the map should open with, and whether a marker belongs on it. */
export type InitialView = { center: LngLat; zoom: number; hasSelection: boolean };

/**
 * Resolves the opening camera.
 *
 * Edit mode (valid stored pair) centres on the stop; create mode falls back to
 * `FALLBACK_CENTER` with `hasSelection: false` so no marker is drawn and no
 * coordinate is written to the form.
 */
export function resolveInitialView(value: StopCoordinates): InitialView {
  const selected = parseCoordinates(value);
  if (selected) return { center: selected, zoom: SELECTED_ZOOM, hasSelection: true };
  return { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM, hasSelection: false };
}

/** Converts a map position back into the form's string pair. */
export function coordinatesFromLngLat(longitude: number, latitude: number): StopCoordinates {
  return { latitude: formatCoordinate(latitude), longitude: formatCoordinate(longitude) };
}

/** True when the two pairs differ beyond the stored precision. */
export function coordinatesDiffer(a: LngLat, b: LngLat): boolean {
  const epsilon = 1e-7;
  return Math.abs(a[0] - b[0]) > epsilon || Math.abs(a[1] - b[1]) > epsilon;
}

/** Message shown when the browser has no Geolocation API at all. */
export const GEOLOCATION_UNSUPPORTED_MESSAGE =
  'This browser cannot share a location. Enter the latitude and longitude manually.';

/**
 * A user-facing sentence for a `GeolocationPositionError`.
 *
 * Never includes coordinates or the raw error (nothing about a position is
 * logged or sent anywhere).
 */
export function geolocationErrorMessage(error: { code?: number } | null | undefined): string {
  switch (error?.code) {
    case 1:
      return 'Location permission was denied. Allow it in your browser, or enter the coordinates manually.';
    case 2:
      return 'Your location is unavailable right now. Try again, or enter the coordinates manually.';
    case 3:
      return 'Finding your location took too long. Try again, or enter the coordinates manually.';
    default:
      return 'Could not get your location. Try again, or enter the coordinates manually.';
  }
}

/** Options for the single, explicit `getCurrentPosition` call. */
export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
};
