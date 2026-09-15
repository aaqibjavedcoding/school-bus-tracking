import { registerAs } from '../framework';
import { CREW_PIN_DEFAULT_POLICY } from '../modules/auth/crew-pin-attempts';

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Crew mobile-login configuration (Mobile-UX Phase 4): the 4-digit PIN
 * brute-force policy and the lifetime of a QR pairing code.
 *
 * ```text
 * CREW_PIN_MAX_ATTEMPTS     failed PINs per window before lockout  (default 5)
 * CREW_PIN_WINDOW_MS        window the failures are counted in     (default 900000 = 15 min)
 * CREW_PIN_LOCKOUT_MS       how long the account then refuses PINs (default 900000 = 15 min)
 * CREW_PAIRING_TTL_MS       lifetime of one QR pairing code        (default 300000 = 5 min)
 * ```
 *
 * ### Why these numbers
 *
 * A 4-digit PIN covers only `10 ** 4 = 10_000` values, so the policy — not the
 * secret's length — is what makes the PIN path survivable. With the defaults,
 * one account yields `5` guesses per 15-minute cycle, i.e. **480 guesses per
 * day**, so exhausting the whole space against a single driver takes
 * `10000 / 480 ≈ 20.8 days` of continuous, perfectly-timed guessing, every
 * attempt of which is written to the audit log. That arithmetic is computed by
 * `estimatePinExhaustionDays()` and pinned by `crew-pin-attempts.spec.ts`, so
 * the figure quoted in `docs/security.md` cannot drift away from the shipped
 * defaults unnoticed.
 *
 * Loosening `CREW_PIN_MAX_ATTEMPTS` or `CREW_PIN_LOCKOUT_MS` loosens that bound
 * proportionally; the spec fails if the defaults themselves change, which is the
 * prompt to re-derive the documentation rather than to edit the assertion.
 *
 * ### Single-instance caveat (deliberate, documented, not hidden)
 *
 * The attempt counters live in process memory (`CrewPinAttemptStore`), exactly
 * like `MemoryRateLimitStore`. README §18 states the supported topology is a
 * **single** Node process; behind N instances an attacker's guesses are spread
 * across processes and the effective allowance becomes `N × CREW_PIN_MAX_ATTEMPTS`
 * per window, and a restart clears every counter mid-window. Raising the numbers
 * here does **not** fix that — a distributed counter (the same deferred Redis
 * work the rate limiter names) does. See `docs/security.md` → "Crew PIN brute
 * force" for the full statement and the mitigations that do hold.
 *
 * The QR half of the flow does not share the limitation: pairing codes live in
 * PostgreSQL (`crew_pairing_tokens`), so they survive a restart and are correct
 * under more than one instance.
 */
export default registerAs('crewAuth', () => ({
  pin: {
    maxAttempts: positiveInt(
      process.env.CREW_PIN_MAX_ATTEMPTS,
      CREW_PIN_DEFAULT_POLICY.maxAttempts,
    ),
    windowMs: positiveInt(process.env.CREW_PIN_WINDOW_MS, CREW_PIN_DEFAULT_POLICY.windowMs),
    lockoutMs: positiveInt(process.env.CREW_PIN_LOCKOUT_MS, CREW_PIN_DEFAULT_POLICY.lockoutMs),
  },
  /**
   * Lifetime of a QR pairing code.
   *
   * Five minutes is the honest window for the real interaction: an
   * administrator opens the crew member's row, clicks "Login QR", turns the
   * screen around or reads it out over a call, and the driver scans it. Longer
   * only widens the period in which a photographed or screenshotted code is
   * redeemable; shorter makes the handover flaky on a slow depot connection.
   */
  pairingTtlMs: positiveInt(process.env.CREW_PAIRING_TTL_MS, 5 * 60_000),
}));
