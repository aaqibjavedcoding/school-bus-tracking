import { registerAs } from '@nestjs/config';

/**
 * Live GPS tracking configuration (Phase 5).
 *
 * Every tunable is environment-backed so an operator can relax or tighten
 * the tracking pipeline without a code change. The defaults are deliberately
 * conservative: roughly one accepted fix every 2.5 seconds per crew device,
 * a device clock allowed at most five minutes ahead of the server and at most
 * a day behind (network delay), and a CORS origin that mirrors the HTTP API.
 *
 *   GPS_UPDATE_MIN_INTERVAL_MS   minimum gap between accepted fixes (default 2500)
 *   GPS_MAX_FUTURE_SKEW_MS       device clock may run ahead by at most (default 300000)
 *   GPS_MAX_PAST_SKEW_MS         device clock may lag by at most (default 86400000)
 *   LIVE_TRACKING_CORS_ORIGIN    socket CORS origin (defaults to CORS_ORIGIN)
 *
 * The namespace itself is the shared constant `LIVE_TRACKING_NAMESPACE` from
 * `@school-bus-tracking/shared-types` — clients import it, so it is not
 * environment-configurable.
 */
export default registerAs('liveTracking', () => {
  const corsOrigin = process.env.LIVE_TRACKING_CORS_ORIGIN || process.env.CORS_ORIGIN || '*';

  return {
    gpsMinIntervalMs: intFromEnv('GPS_UPDATE_MIN_INTERVAL_MS', 2500, 250),
    maxFutureSkewMs: intFromEnv('GPS_MAX_FUTURE_SKEW_MS', 300_000, 0),
    maxPastSkewMs: intFromEnv('GPS_MAX_PAST_SKEW_MS', 86_400_000, 0),
    corsOrigin,
  };
});

/**
 * Parses a positive integer environment value, falling back to `fallback`
 * when unset, blank or non-numeric. The result is clamped to `min` so a
 * typo (`GPS_UPDATE_MIN_INTERVAL_MS=abc`) degrades to the safe default
 * instead of disabling throttling.
 */
function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return Math.max(min, fallback);
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
}
