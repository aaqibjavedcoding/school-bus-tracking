import { registerAs } from '../framework';

/**
 * Task 22 ETA configuration.
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
 */
export default registerAs('eta', () => {
  return {
    fallbackSpeedKmh: numberFromEnv('ETA_FALLBACK_SPEED_KMH', 25, 1),
    minSpeedKmh: numberFromEnv('ETA_MIN_SPEED_KMH', 5, 1),
    maxSpeedKmh: numberFromEnv('ETA_MAX_SPEED_KMH', 90, 20),
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
