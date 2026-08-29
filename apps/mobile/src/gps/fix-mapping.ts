import {
  TripLocationUpdateRejectionReason,
  type TripLocationUpdatePayload,
} from '@school-bus-tracking/shared-types';
import { tripLocationUpdateSchema } from '@school-bus-tracking/validation';

/**
 * Device fix → the exact `trip:location:update` payload the existing backend
 * expects (`GpsLocationFix` + `trip_id`). Everything the server owns —
 * throttling, timestamp validation, geofencing, ETA, persistence,
 * broadcasting — is *not* duplicated here; the payload builder only converts
 * units (device reports m/s, the contract is km/h) and drops fields the device
 * did not report, never inventing values.
 */

export interface ExpoLocationLikeFix {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp?: number | null;
}

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function toTripLocationUpdatePayload(
  tripId: string,
  fix: ExpoLocationLikeFix,
  receivedAt: number = fix.timestamp ?? Date.now(),
): TripLocationUpdatePayload {
  const payload: TripLocationUpdatePayload = {
    trip_id: tripId,
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    recorded_at: new Date(receivedAt).toISOString(),
  };

  const accuracy = finiteOrNull(fix.coords.accuracy);
  if (accuracy !== null && accuracy >= 0) {
    payload.accuracy = Math.round(accuracy);
  }

  // CoreLocation reports speed in m/s; the API contract is km/h.
  const speedMs = finiteOrNull(fix.coords.speed);
  if (speedMs !== null && speedMs >= 0) {
    payload.speed = Math.round(speedMs * 3.6 * 100) / 100;
  }

  const heading = finiteOrNull(fix.coords.heading);
  if (heading !== null && heading >= 0 && heading <= 360) {
    payload.heading = Math.round(heading);
  }

  return payload;
}

/**
 * Client-side sanity gate before anything touches the wire. This is a
 * malformed-data guard only — the server re-validates independently and remains
 * the sole authority.
 */
export function isValidTripLocationUpdatePayload(payload: unknown): boolean {
  return tripLocationUpdateSchema.safeParse(payload).success;
}

export const GPS_REJECTION_MESSAGES: Record<TripLocationUpdateRejectionReason, string> = {
  unauthenticated: 'Your session is no longer valid — sign in again.',
  unauthorized: 'You are not the rostered crew of this trip.',
  trip_not_found: 'This trip is not visible to your account.',
  trip_not_open: 'The trip has not started (or has finished), so tracking is paused.',
  invalid_payload: 'The device position was rejected as malformed.',
  invalid_timestamp: 'The device clock looks wrong — fix it and GPS resumes.',
  future_timestamp: 'The device clock is ahead of the server — correct it and GPS resumes.',
  throttled: 'The server is throttling updates; the next fix will be sent.',
};
