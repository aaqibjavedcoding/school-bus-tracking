import type { TripLocationUpdatePayload } from '@school-bus-tracking/shared-types';
import { tripLocationUpdateSchema } from '@school-bus-tracking/validation';

/**
 * GPS helpers for the crew app.
 *
 * The device never invents coordinates: every payload originates from an
 * expo-location `LocationObject` and is mapped field-by-field into the exact
 * `trip:location:update` contract the API validates with Zod (WGS-84 degrees,
 * accuracy in metres, speed in km/h, heading in degrees, device timestamp).
 * `buildLocationPayload` also runs the *same* shared schema client-side so a
 * malformed fix is dropped before it ever reaches the socket.
 */

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Straight-line (Haversine) distance in metres between two WGS-84 points. */
export function haversineMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const latFrom = toRadians(from.latitude);
  const latTo = toRadians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latFrom) * Math.cos(latTo) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Compass bearing (degrees, 0..360) from one point to another. */
export function bearingDegrees(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const latFrom = toRadians(from.latitude);
  const latTo = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(latTo);
  const x =
    Math.cos(latFrom) * Math.sin(latTo) - Math.sin(latFrom) * Math.cos(latTo) * Math.cos(dLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/** A minimal expo-location fix — the subset of `LocationObject` we consume. */
export interface DeviceLocationFix {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp: number | string;
}

/**
 * Maps a device fix to the `trip:location:update` payload.
 *
 * Unit conversions: expo-location reports speed in **m/s** and heading in
 * degrees; the API contract wants **km/h**. Optional readings that the device
 * could not provide (`null`/negative speed, non-finite heading) are omitted
 * instead of being zero-filled — the server treats missing as unknown.
 */
export function buildLocationPayload(
  tripId: string,
  fix: DeviceLocationFix,
): TripLocationUpdatePayload | null {
  const recordedDate = new Date(fix.timestamp);
  const time = recordedDate.getTime();
  // An invalid/unparseable device clock must never reach the socket — and
  // `toISOString()` would throw on it, so guard before converting.
  if (!Number.isFinite(time)) {
    return null;
  }
  const recordedAt = new Date(time).toISOString();

  const speedMs =
    typeof fix.coords.speed === 'number' && fix.coords.speed >= 0 ? fix.coords.speed : null;
  const heading =
    typeof fix.coords.heading === 'number' && Number.isFinite(fix.coords.heading)
      ? ((fix.coords.heading % 360) + 360) % 360
      : null;
  const accuracy =
    typeof fix.coords.accuracy === 'number' && fix.coords.accuracy >= 0
      ? fix.coords.accuracy
      : null;

  const payload: TripLocationUpdatePayload = {
    trip_id: tripId,
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    recorded_at: recordedAt,
    ...(accuracy !== null ? { accuracy } : {}),
    ...(speedMs !== null ? { speed: speedMs * 3.6 } : {}),
    ...(heading !== null ? { heading } : {}),
  };

  return tripLocationUpdateSchema.safeParse(payload).success ? payload : null;
}

/** Age of a fix in milliseconds; `null` for an unparseable timestamp. */
export function fixAgeMs(recordedAt: string, now = Date.now()): number | null {
  const time = new Date(recordedAt).getTime();
  if (Number.isNaN(time)) return null;
  return now - time;
}

/**
 * Signal-quality tier of the GPS stream, from the age of the newest fix and
 * the device-reported accuracy. Used only for the crew status chips — never
 * for data itself.
 */
export function gpsSignalTier(
  ageMs: number | null,
  accuracyMeters: number | null,
): 'good' | 'weak' | 'stale' {
  if (ageMs === null) return 'stale';
  if (ageMs > 30_000) return 'stale';
  if (accuracyMeters !== null && accuracyMeters > 50) return 'weak';
  if (ageMs > 15_000) return 'weak';
  return 'good';
}
