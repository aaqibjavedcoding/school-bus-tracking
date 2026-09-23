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
 *                                     geofence cannot localise inside it);
 *   ARRIVAL_ALLOW_MISSING_ACCURACY    whether fixes without an accuracy
 *                                     reading stay eligible (default true —
 *                                     the field is optional and some
 *                                     devices omit it);
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
 *                                     edge jitter must not wipe it);
 *   ARRIVAL_MIN_DWELL_MS              minimum span between first and
 *                                     confirming inside-fix (default 0 —
 *                                     disabled; the count rule already
 *                                     implies dwell at the GPS throttle);
 *   ARRIVAL_MAX_PLAUSIBLE_SPEED_KMH   implied speed above which a fix is an
 *                                     implausible jump (default 150 — well
 *                                     above legal bus speeds, well below
 *                                     teleport artefacts);
 *   ARRIVAL_MIN_JUMP_DISTANCE_METERS  jumps shorter than this never trigger
 *                                     (default 500 — small GPS wander at
 *                                     coinciding timestamps must not
 *                                     suppress arrivals).
 */
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
      allowMissingAccuracy: booleanFromEnv('ARRIVAL_ALLOW_MISSING_ACCURACY', true),
      requiredConsecutiveFixes: intFromEnv('ARRIVAL_REQUIRED_CONSECUTIVE_FIXES', 1, 1),
      skipExtraFixes: intFromEnv('ARRIVAL_SKIP_EXTRA_FIXES', 1, 0),
      maxSkipAhead: intFromEnv('ARRIVAL_MAX_SKIP_AHEAD', 2, 1),
      exitHysteresisMeters: numberFromEnv('ARRIVAL_EXIT_HYSTERESIS_METERS', 20, 0),
      minDwellMs: intFromEnv('ARRIVAL_MIN_DWELL_MS', 0, 0),
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
