import type {
  StopResponse,
  TripArrivalDiagnostics,
  TripArrivalGateReason,
} from '@school-bus-tracking/shared-types';
import { haversineMeters } from '../../lib/geo.ts';

/**
 * The next stop's **arrival zone**, as the driver's map and card see it
 * (deep-fix R1) — pure, React-free, native-free.
 *
 * ### Why this module exists
 *
 * A field run showed the bus parking at a stop and the arrival only
 * registering when a fix landed almost exactly on the stop's coordinates: the
 * zone behaved like a point. The server now floors every stop's effective
 * radius (`max(stored radius, ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS)`) and draws
 * its circles from that. The driver has to SEE the same circle to trust it —
 * a zone you cannot see is a gate you cannot reason about — so the map draws
 * it and the next-stop card says whether the bus is inside it.
 *
 * ### One source of truth — the SERVER's number, not a mirror
 *
 * There used to be an `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS = 50` constant in
 * this file mirroring the server default. It is gone. The API now returns
 * `effective_radius_meters` on every stop / trip-progress payload — exactly
 * the `max(stored, floor)` the arrival engine measures against — and this
 * module draws that. Changing `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS` in the
 * deployment's env now changes what the driver's map draws, with nothing to
 * keep in sync by hand.
 *
 * {@link OFFLINE_FALLBACK_MIN_RADIUS_METERS} exists ONLY so a cached stop
 * fetched before the field existed still renders a circle instead of a point
 * while offline. It is a rendering fallback, never a detection rule.
 *
 * ### Display never feeds back
 *
 * `arrivalZoneStatus` is pure geometry (haversine from the latest fix the
 * server accepted — the very fix the arrival engine evaluates) and its result
 * is rendered, nothing more. It must never block, queue or rewrite anything.
 */

/**
 * OFFLINE RENDERING FALLBACK ONLY (metres).
 *
 * Used when a stop payload carries no `effective_radius_meters` — i.e. a row
 * cached by an older app/server pair. It is deliberately *not* the detection
 * floor and must never be treated as one: detection lives on the server.
 */
export const OFFLINE_FALLBACK_MIN_RADIUS_METERS = 25;

/** The structural stop surface the zone math needs. */
export interface ArrivalZoneStop {
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
  /** The server's effective radius. Absent only on pre-field cached rows. */
  effective_radius_meters?: number | null;
}

/** The structural fix surface the zone math needs. */
export interface ArrivalZoneFix {
  latitude: number;
  longitude: number;
}

/**
 * The stop's effective arrival radius in metres, as the SERVER computed it.
 *
 * Reads `effective_radius_meters` when present — that is the authority. Only
 * when it is absent (old cached row, offline) does it degrade to
 * `max(stored, OFFLINE_FALLBACK_MIN_RADIUS_METERS)` so the map still draws a
 * circle rather than a point. Never `NaN` on a screen.
 */
export function effectiveArrivalRadiusMeters(stop: ArrivalZoneStop | null | undefined): number {
  const fromServer = stop?.effective_radius_meters;
  if (typeof fromServer === 'number' && Number.isFinite(fromServer) && fromServer > 0) {
    return fromServer;
  }
  const stored =
    typeof stop?.geofence_radius_meters === 'number' &&
    Number.isFinite(stop.geofence_radius_meters)
      ? Math.max(0, stop.geofence_radius_meters)
      : 0;
  return Math.max(stored, OFFLINE_FALLBACK_MIN_RADIUS_METERS);
}

/** A drawable zone: a centre and the effective radius around it. */
export interface ArrivalZone {
  center: { latitude: number; longitude: number };
  radiusMeters: number;
}

/**
 * The next stop's drawable arrival zone, or `null` when the stop has no
 * surveyed coordinates (nothing honest to draw — same rule the server's
 * `isRecordableStop` applies).
 */
export function arrivalZoneOfStop(stop: ArrivalZoneStop | null | undefined): ArrivalZone | null {
  if (!stop || stop.latitude === null || stop.longitude === null) return null;
  return {
    center: { latitude: stop.latitude, longitude: stop.longitude },
    radiusMeters: effectiveArrivalRadiusMeters(stop),
  };
}

/** Where the bus stands relative to the stop's effective circle. */
export type ArrivalZoneStatus = 'inside' | 'outside' | 'unknown';

/**
 * Is the bus inside the stop's arrival zone?
 *
 * `'unknown'` (no fix yet, or no surveyed stop) is a real answer, not a
 * fallback: the card renders nothing for it, because "outside" would be a
 * guess a driver could act on. Distances are straight-line haversine metres —
 * the same measurement the server's inside-evidence uses.
 */
export function arrivalZoneStatus(
  fix: ArrivalZoneFix | null | undefined,
  stop: ArrivalZoneStop | null | undefined,
): ArrivalZoneStatus {
  const zone = arrivalZoneOfStop(stop);
  if (!fix || !zone) return 'unknown';
  const distance = haversineMeters(
    { latitude: fix.latitude, longitude: fix.longitude },
    zone.center,
  );
  return distance <= zone.radiusMeters ? 'inside' : 'outside';
}

/** Why the arrival is being held although the bus is inside the zone. */
export type ArrivalHoldReason =
  | { kind: 'gate'; reason: TripArrivalGateReason }
  | { kind: 'evidence'; count: number; required: number };

/**
 * The one-line answer to "I'm at the stop — why hasn't it recorded?".
 *
 * Reads the same `arrival_diagnostics` the server already exposes on
 * `GET /trips/:id/progress` (never a second source of truth):
 *
 * - a **gate** wins first (`last_gate_block`, or the stop's own
 *   `blocked_reason`): with full evidence a gate is the only thing left
 *   holding the stop, and it is the reason a driver can actually act on or
 *   wait out (departure, inter-stop cooldown);
 * - otherwise **evidence** is the reason: the stop needs
 *   `required_fixes` consecutive inside fixes and has `count` so far —
 *   "Confirming 1/2" is the progress line;
 * - `null` — nothing is holding the stop (it records on the next fix), or
 *   the stop is not in the pending list (unknown stop, or already recorded).
 *
 * Pure presentation: callers render the result and never feed it back.
 */
export function arrivalHoldReason(
  diagnostics: TripArrivalDiagnostics | null | undefined,
  stopId: string | null | undefined,
): ArrivalHoldReason | null {
  if (!diagnostics || !stopId) return null;

  const gate = diagnostics.last_gate_block ?? null;
  if (gate !== null) {
    return { kind: 'gate', reason: gate };
  }
  const pending = (diagnostics.pending_stops ?? []).find(
    (entry) => entry.stop_id === stopId,
  );
  if (!pending) return null;
  const blocked = pending.blocked_reason ?? null;
  if (blocked !== null) {
    return { kind: 'gate', reason: blocked };
  }
  const count = pending.inside_count ?? 0;
  const required = pending.required_fixes ?? 0;
  if (required > 0 && count < required) {
    return { kind: 'evidence', count, required };
  }
  return null;
}

/** The stop's own row from an ordered list, by id — the card's stop lookup. */
export function stopById(stops: StopResponse[] | null | undefined, stopId: string | null | undefined): StopResponse | null {
  if (!stops || !stopId) return null;
  return stops.find((stop) => stop.id === stopId) ?? null;
}

/**
 * Straight-line metres from the bus to the stop — the same haversine the
 * arrival engine uses — or `null` when either side is unknown. The next-stop
 * card renders this so the driver always has a number, not just a colour.
 */
export function distanceToStopMeters(
  fix: ArrivalZoneFix | null | undefined,
  stop: ArrivalZoneStop | null | undefined,
): number | null {
  if (!fix || !stop || stop.latitude === null || stop.longitude === null) return null;
  const meters = haversineMeters(
    { latitude: fix.latitude, longitude: fix.longitude },
    { latitude: stop.latitude, longitude: stop.longitude },
  );
  return Number.isFinite(meters) ? meters : null;
}
