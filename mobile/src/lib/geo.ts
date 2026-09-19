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
 * A device heading, or `null` for "this device has no course".
 *
 * ### What `expo-location` actually reports (read from the 57.0.16 source, not
 * from the docs)
 *
 * | platform | where the value comes from                                        | "no course" arrives as           |
 * | -------- | ----------------------------------------------------------------- | -------------------------------- |
 * | iOS      | `ios/LocationUtils.swift:30` → `"heading": location.course`        | `-1` (`CLLocation.course` is negative when the course is invalid) |
 * | Android  | `android/.../records/LocationResults.kt:154` → `location.bearing.toDouble()` | `0.0` (`Location.getBearing()` returns `0.0` when `hasBearing()` is false) |
 * | Web      | `src/ExpoLocation.web.ts:29` passes `coords.heading` through        | `null` (per the W3C spec)        |
 *
 * So on the two native platforms "unavailable" is **not** a distinct sentinel
 * the JS layer can rely on: iOS reports a **negative** number, and Android
 * reports `0.0`, which is byte-identical to a genuine due-north course.
 *
 * ### The bug this replaces
 *
 * The previous implementation normalised **every finite number** into
 * `[0, 360)` with `((h % 360) + 360) % 360`, which turned iOS's `-1` into
 * **`359`** — a confident claim of due north for a bus standing still, uploaded
 * to `trip:location:update`. The presentation layer's speed gate hid it (a
 * heading is only trusted above 3 km/h), but the *payload* was still wrong, and
 * any consumer that does not apply the same gate would read a fabricated
 * direction. Fixing it here is the only place that fixes it for every consumer.
 *
 * So: non-finite and negative values are **omitted** rather than repaired, and
 * `0` — a real due-north course — is preserved. Values above 360 are still
 * wrapped (`450 → 90`), which is normalisation of a real direction, not
 * invention of one.
 *
 * **Known limitation (Android).** Because expo-location exports neither
 * `Location.hasBearing()` nor `Location.hasSpeed()`, a bearing-less fix arrives
 * as `0` and cannot be distinguished here from a true north course; suppressing
 * every `0` would delete real headings. The payload therefore keeps it, and the
 * existing speed gate in `features/map/bus-motion.ts` — which refuses a device
 * heading below 3 km/h — is what keeps it out of the marker. Stated in
 * `docs/live-tracking-map.md` rather than papered over.
 */
export function normalizeDeviceHeading(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // expo-location's "unavailable" sentinel, and any other negative value: not a
  // compass direction in the WGS-84 0..360 convention this contract uses.
  if (value < 0) return null;
  return value % 360;
}

/**
 * Maps a device fix to the `trip:location:update` payload.
 *
 * Unit conversions: expo-location reports speed in **m/s** and heading in
 * degrees; the API contract wants **km/h**. Optional readings that the device
 * could not provide are omitted instead of being zero-filled — the server
 * treats missing as unknown. That covers expo-location's negative sentinels for
 * both fields (`speed < 0`, `heading < 0`; see
 * {@link normalizeDeviceHeading}) as well as `null`/non-finite values.
 *
 * `idempotencyKey` (one UUID per fix) lets the server recognise a redelivered
 * fix and replay the original ack instead of inserting a duplicate row.
 */
export function buildLocationPayload(
  tripId: string,
  fix: DeviceLocationFix,
  idempotencyKey?: string,
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
  const heading = normalizeDeviceHeading(fix.coords.heading);
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
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
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
