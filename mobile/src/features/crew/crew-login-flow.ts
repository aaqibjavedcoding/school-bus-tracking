/**
 * Crew mobile-login (Mobile-UX Phase 4b) — pure helpers, no React, no native.
 *
 * Everything in this file is a plain function that takes its inputs as
 * arguments and returns its outputs as data, so `crew-login-flow.spec.ts`
 * can pin the rules under plain `node --test`. The thin React surface
 * (PIN pad, login-screen wiring) lives in components; the
 * contracts they rely on live here.
 *
 * Two responsibilities, no more:
 *
 * 1. **PIN draft → payload**. Reduce whatever the driver typed or pasted to
 *    exactly `CREW_PIN_LENGTH` digits, using the same rule the admin's
 *    browser uses (`normalizePinInput` in `packages/validation`). Never
 *    invent characters — a partial paste is still a valid draft.
 * 2. **Error envelope → presentation**. The single source of truth for
 *    "what does the login screen show?" lives in
 *    `localizeCrewLoginError` (`i18n.ts`); this file re-exports it and adds
 *    the lockout-second extraction it owns, so the PIN pad has one import
 *    for everything it needs.
 */

import { CREW_PIN_LENGTH, crewPinSchema } from '@school-bus-tracking/validation';
import { isNetworkFailureError } from '../../lib/error-messages.ts';
import {
  localizeCrewLoginError as localizeCrewLoginErrorCore,
  type CrewLoginErrorPresentation,
} from '../../lib/i18n.ts';

/**
 * True when a thrown crew-login failure is a **network / DNS error** — the
 * request never reached the server, so there is no server message or error
 * code to localise.
 *
 * The caller must show the app's own offline sentence for this case and never
 * forward the raw error: with data switched off the transport reports a Java
 * diagnostic (`fetch failed: java.net.UnknownHostException: Unable to resolve
 * host …`) that must not reach the screen. A real server rejection (wrong
 * PIN, lockout) always carries a non-zero status and a code, so it never
 * matches here.
 */
export function isCrewLoginNetworkFailure(error: unknown): boolean {
  return isNetworkFailureError(error);
}

/** What the pure part of the PIN pad hands to the network call. */
export interface CrewPinDraft {
  schoolId: string;
  pin: string;
}

/**
 * Reduce arbitrary input (typed / pasted / autofilled) to the exact shape
 * the server expects.
 *
 * - `schoolId` is trimmed; an empty string becomes `{ error: 'schoolId' }` so
 *   the screen can say "enter your school code" rather than send a blank code
 *   and burn one of the school's five attempts per window on it.
 * - `pin` is digit-stripped and clamped to `CREW_PIN_LENGTH`. The same
 *   helper is reused on the admin side.
 *
 * There is deliberately **no** `userId`: a crew PIN login is
 * `{ method: 'pin', school_id, pin }` and the server resolves which crew
 * member that PIN belongs to (see `crewLoginByPinSchema` and
 * `CrewAuthService.loginWithPin`).
 */
export function buildCrewPinDraft(input: {
  schoolId: string;
  pin: string;
}): CrewPinDraft | { error: string } {
  const schoolId = input.schoolId.trim();
  if (schoolId.length === 0) {
    return { error: 'schoolId' };
  }
  const digits = input.pin.replace(/\D/g, '').slice(0, CREW_PIN_LENGTH);
  const parsed = crewPinSchema.safeParse(digits);
  if (!parsed.success) {
    return { error: 'pin' };
  }
  return { schoolId, pin: parsed.data };
}

/**
 * What `localizeCrewLoginError` returns, re-exported here so the PIN pad
 * has one import. The function itself lives in `i18n.ts` so the
 * `KNOWN_ERROR_CODES` table and the dictionary share one file.
 */
export type { CrewLoginErrorPresentation };
export const localizeCrewLoginError = localizeCrewLoginErrorCore;

/**
 * `mm:ss` clamp for the lockout countdown.
 *
 * `seconds` is clamped at zero. A non-finite or negative input collapses
 * to `0:00 / expired` so the UI never renders a negative timer.
 */
export function lockoutCountdown(
  totalSeconds: number | null,
  nowSeconds: number,
): { expired: boolean; label: string } {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return { expired: true, label: '0:00' };
  }
  const remaining = Math.max(0, Math.floor(totalSeconds - nowSeconds));
  if (remaining <= 0) return { expired: true, label: '0:00' };
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return { expired: false, label: `${minutes}:${String(seconds).padStart(2, '0')}` };
}
