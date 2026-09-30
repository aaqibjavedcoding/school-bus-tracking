import { registerAs } from '../framework';

/**
 * Task 22 ETA configuration (+ Phase 1 arrival-detection tunables).
 *
 * The ETA is an approximate, GPS-based estimate (Haversine distance over an
 * effective speed) — no external routing service is involved. The tunables
 * only control how the effective speed is derived and bounded:
 *
 *   ETA_FALLBACK_SPEED_KMH   speed assumed when the device reports none/zero
 *                            (default 25 — a conservative urban school-bus
 *                            pace);
 *   ETA_MIN_SPEED_KMH        lower clamp of the effective speed (default 5);
 *   ETA_MAX_SPEED_KMH        upper clamp of the effective speed (default 90),
 *                            so a bogus device reading can never produce an
 *                            absurd ETA.
 *   ETA_STALE_AFTER_MS       age (by fix `recorded_at`) after which the
 *                            latest fix is last-known, not live: distances
 *                            and ETAs are withheld (default 180000 — 3 min,
 *                            matching the arrival freshness gate).
 *
 * Phase 1 stop-arrival / proximity detection (evaluated per accepted latest
 * fix by `StopArrivalsService`; every value is justified in
 * `docs/notification-hardening-handoff.md`):
 *
 *   ARRIVAL_MAX_FIX_AGE_MS            fixes older than this (by original
 *                                     `recorded_at`) never create alerts
 *                                     (default 180000 — live fixes arrive
 *                                     within seconds; 3 min tolerates
 *                                     flaky-network batching while rejecting
 *                                     offline replays hours old);
 *   ARRIVAL_FUTURE_TOLERANCE_MS       fixes dated further ahead of the
 *                                     server clock are ineligible (default
 *                                     60000 — tighter than the 5 min ingest
 *                                     skew window, which stays permissive);
 *   ARRIVAL_MAX_ACCURACY_METERS       fixes with a worse horizontal accuracy
 *                                     are ineligible (default 100 — a fix
 *                                     less precise than the 100 m default
 *                                     geofence cannot localise inside it).
 *                                     A fix must additionally be at least as
 *                                     precise as the stop's EFFECTIVE radius
 *                                     (see ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS)
 *                                     before it counts toward that stop —
 *                                     accuracy ≤ min(ARRIVAL_MAX_ACCURACY_METERS,
 *                                     effectiveRadius), no `/2` divisor.
 *                                     Deep-fix R1: the old `radius / 2` rule
 *                                     demanded 5–15 m accuracy from a 10–30 m
 *                                     stop, which phones in urban/indoor
 *                                     conditions routinely fail (10–30 m) —
 *                                     the bus was inside the circle and still
 *                                     never "arrived". The per-stop gate now
 *                                     only rejects fixes too coarse to be
 *                                     inside the circle at all; the
 *                                     anti-cascade load is carried by the
 *                                     departure / dwell / cooldown gates, not
 *                                     by a tiny radius;
 *   ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS runtime floor on every stop's
 *                                     effective geofence radius (default 50).
 *                                     Evaluation uses effectiveRadius =
 *                                     max(stop.geofence_radius_meters, this
 *                                     floor) everywhere a stop's radius
 *                                     participates: inside-evidence, the
 *                                     per-stop accuracy gate, the departure
 *                                     margin and candidate selection. The
 *                                     stored radius stays the admin's intent
 *                                     (and new/edited stops must be ≥ 30 m);
 *                                     the floor is the runtime safety net for
 *                                     legacy/small stops so every arrival
 *                                     zone is a real circle, not a point;
 *   ARRIVAL_ALLOW_MISSING_ACCURACY    whether fixes without an accuracy
 *                                     reading stay eligible (default false —
 *                                     a fix whose accuracy is unknown cannot
 *                                     be trusted to localise inside even a
 *                                     50 m circle; the tradeoff is that a
 *                                     device which omits the field
 *                                     contributes no arrival evidence, which
 *                                     the progress diagnostics surface as
 *                                     `missing-accuracy`. The anti-cascade
 *                                     defences are the departure/dwell/
 *                                     cooldown gates, so a deployment that
 *                                     trusts its fleet may set this true);
 *   ARRIVAL_REQUIRED_CONSECUTIVE_FIXES in-a-row fixes inside a geofence
 *                                     before recording (default 2 — one fix
 *                                     is vulnerable to urban GPS jitter;
 *                                     two cost ~2.5–5 s at the default
 *                                     throttle);
 *   ARRIVAL_SKIP_EXTRA_FIXES          additional consecutive fixes required
 *                                     for a stop ahead of the next unarrived
 *                                     stop (default 1 — out-of-order claims
 *                                     need stronger evidence);
 *   ARRIVAL_MAX_SKIP_AHEAD            tier boundary: stops further than this
 *                                     beyond the progress frontier need
 *                                     re-sync evidence (default 2);
 *   ARRIVAL_EXIT_HYSTERESIS_METERS    fringe band past the geofence edge
 *                                     that preserves (not resets) partial
 *                                     consecutive-fix evidence (default 20 —
 *                                     edge jitter must not wipe it). It is
 *                                     also the departure-gate margin: the bus
 *                                     must be seen this far past a stop's edge
 *                                     before the next stop may record;
 *   ARRIVAL_MIN_DWELL_MS              minimum span between first and
 *                                     confirming inside-fix (default 10000 —
 *                                     10 s of sustained presence, so a fix
 *                                     that only clips a geofence in passing
 *                                     never records);
 *   ARRIVAL_MIN_INTERSTOP_MS          minimum span between one arrival's
 *                                     `arrived_at` and the fix that records
 *                                     the next stop (default 30000 — a second
 *                                     stop cannot record within 30 s of the
 *                                     previous one, which is what a stationary
 *                                     bus inside overlapping geofences would
 *                                     otherwise do);
 *   ARRIVAL_MIN_INTERSTOP_DISTANCE_METERS minimum distance between the fix
 *                                     that recorded the previous stop and the
 *                                     fix recording the next (default 0 =
 *                                     DISABLED, deep-fix R2). The gate is
 *                                     route-blind: on a route whose stops sit
 *                                     20–40 m apart (legal at the legacy 10 m
 *                                     minimum radius, so such data exists)
 *                                     it blocked stop N+1 for the whole time
 *                                     the bus stood there, and the stop fell
 *                                     behind the frontier silently — the
 *                                     "stop 2 was never announced" field
 *                                     defect. The anti-cascade load is
 *                                     carried by the departure gate (now
 *                                     geometry-aware), the 30 s cooldown,
 *                                     the 10 s dwell and the consecutive-fix
 *                                     count. Kept env-tunable for deployments
 *                                     that want an absolute movement floor.
 *   ARRIVAL_MAX_PLAUSIBLE_SPEED_KMH   implied speed above which a fix is an
 *                                     implausible jump (default 150 — well
 *                                     above legal bus speeds, well below
 *                                     teleport artefacts);
 *   ARRIVAL_MIN_JUMP_DISTANCE_METERS  jumps shorter than this never trigger
 *                                     (default 500 — small GPS wander at
 *                                     coinciding timestamps must not
 *                                     suppress arrivals).
 */
/** Detection floor: 25 m balances reliable phone accuracy (usually 5–30 m) with
 * arrival detection. Do not lower this to 5 m: the accuracy gate would reject
 * almost every fix and a parked bus could never open its manifest. */
export const ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS = 25;

export default registerAs('eta', () => {
  return {
    fallbackSpeedKmh: numberFromEnv('ETA_FALLBACK_SPEED_KMH', 25, 1),
    minSpeedKmh: numberFromEnv('ETA_MIN_SPEED_KMH', 5, 1),
    maxSpeedKmh: numberFromEnv('ETA_MAX_SPEED_KMH', 90, 20),
    staleAfterMs: intFromEnv('ETA_STALE_AFTER_MS', 180_000, 1000),
    arrival: {
      maxFixAgeMs: intFromEnv('ARRIVAL_MAX_FIX_AGE_MS', 180_000, 1000),
      futureToleranceMs: intFromEnv('ARRIVAL_FUTURE_TOLERANCE_MS', 60_000, 0),
      maxAccuracyMeters: numberFromEnv('ARRIVAL_MAX_ACCURACY_METERS', 100, 1),
      allowMissingAccuracy: booleanFromEnv('ARRIVAL_ALLOW_MISSING_ACCURACY', false),
      minEffectiveRadiusMeters: numberFromEnv('ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS', ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS, 1),
      requiredConsecutiveFixes: intFromEnv('ARRIVAL_REQUIRED_CONSECUTIVE_FIXES', 2, 1),
      skipExtraFixes: intFromEnv('ARRIVAL_SKIP_EXTRA_FIXES', 1, 0),
      maxSkipAhead: intFromEnv('ARRIVAL_MAX_SKIP_AHEAD', 2, 1),
      exitHysteresisMeters: numberFromEnv('ARRIVAL_EXIT_HYSTERESIS_METERS', 20, 0),
      minDwellMs: intFromEnv('ARRIVAL_MIN_DWELL_MS', 10_000, 0),
      minInterStopMs: intFromEnv('ARRIVAL_MIN_INTERSTOP_MS', 30_000, 0),
      minInterStopDistanceMeters: numberFromEnv('ARRIVAL_MIN_INTERSTOP_DISTANCE_METERS', 0, 0),
      maxPlausibleSpeedKmh: numberFromEnv('ARRIVAL_MAX_PLAUSIBLE_SPEED_KMH', 150, 1),
      minJumpDistanceMeters: numberFromEnv('ARRIVAL_MIN_JUMP_DISTANCE_METERS', 500, 0),
    },
  };
});

/**
 * Parses a positive finite environment value, falling back to `fallback`
 * when unset, blank or non-numeric; the result is clamped to at least `min`
 * so a typo degrades to the safe default instead of disabling the bound.
 */
function numberFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return Math.max(min, fallback);
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
}

/**
 * Parses an integer environment value, falling back to `fallback` when
 * unset, blank or non-numeric; clamped to at least `min`.
 */
function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return Math.max(min, fallback);
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
}

/**
 * Parses a boolean environment value (`true`/`1`/`yes` vs
 * `false`/`0`/`no`, case-insensitive), falling back to `fallback` when
 * unset, blank or unrecognised.
 */
function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
}
