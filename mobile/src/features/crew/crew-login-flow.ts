/**
 * Crew mobile-login (Mobile-UX Phase 4b) — pure helpers, no React, no native.
 *
 * Everything in this file is a plain function that takes its inputs as
 * arguments and returns its outputs as data, so `crew-login-flow.spec.ts`
 * can pin the rules under plain `node --test`. The thin React surface
 * (PIN pad, QR scanner, login-screen wiring) lives in components; the
 * contracts they rely on live here.
 *
 * Three responsibilities, no more:
 *
 * 1. **PIN draft → payload**. Reduce whatever the driver typed or pasted to
 *    exactly `CREW_PIN_LENGTH` digits, using the same rule the admin's
 *    browser uses (`normalizePinInput` in `packages/validation`). Never
 *    invent characters — a partial paste is still a valid draft.
 * 2. **QR payload → request body**. Take a scanned or pasted `SBT-CREW-1:…`
 *    string, validate the prefix (`parseCrewPairingPayload`), and build the
 *    `{ method: 'qr', pairing_token }` request. Reject anything that does
 *    not parse — a camera that fires on every frame is allowed to ignore
 *    misdirected codes, never to send them to the API.
 * 3. **Error envelope → presentation**. The single source of truth for
 *    "what does the login screen show?" lives in
 *    `localizeCrewLoginError` (`i18n.ts`); this file re-exports it and adds
 *    the lockout-second extraction it owns, so the PIN pad has one import
 *    for everything it needs.
 */

import {
  CREW_PIN_LENGTH,
  crewPinSchema,
  parseCrewPairingPayload,
} from '@school-bus-tracking/validation';
import {
  localizeCrewLoginError as localizeCrewLoginErrorCore,
  type CrewLoginErrorPresentation,
} from '../../lib/i18n.ts';

/** What the pure part of the PIN pad hands to the network call. */
export interface CrewPinDraft {
  schoolId: string;
  userId: string;
  pin: string;
}

/**
 * Reduce arbitrary input (typed / pasted / autofilled) to the exact shape
 * the server expects.
 *
 * - `schoolId` is trimmed; an empty string becomes `null` so the DTO can
 *   surface "school code required" rather than send a blank UUID.
 * - `userId` is trimmed verbatim — the DTO rejects anything that is not a
 *   UUID, so the pad does not second-guess casing.
 * - `pin` is digit-stripped and clamped to `CREW_PIN_LENGTH`. The same
 *   helper is reused on the admin side.
 */
export function buildCrewPinDraft(input: {
  schoolId: string;
  userId: string;
  pin: string;
}): CrewPinDraft | { error: string } {
  const schoolId = input.schoolId.trim();
  if (schoolId.length === 0) {
    return { error: 'schoolId' };
  }
  const userId = input.userId.trim();
  if (userId.length === 0) {
    return { error: 'userId' };
  }
  const digits = input.pin.replace(/\D/g, '').slice(0, CREW_PIN_LENGTH);
  const parsed = crewPinSchema.safeParse(digits);
  if (!parsed.success) {
    return { error: 'pin' };
  }
  return { schoolId, userId, pin: parsed.data };
}

/**
 * Map a scanned or pasted QR payload to a `qr` request body.
 *
 * The payload is the *raw* string the camera saw, or the string the user
 * pasted. The scanner side calls this for every frame; rejected payloads
 * (not a pairing code, wrong version, empty) are normal and **do not** raise
 * — the caller treats them as "no QR visible yet". A successful parse
 * hands back the request body; the caller POSTs it to `/auth/crew-login`.
 *
 * The reason the URL/format check is here and not in the DTO is that an
 * arbitrary scan can be anything — a Wi-Fi QR, a parcel label, a URL — and
 * the API has no business hashing and database-looking-up input that is
 * obviously not a pairing code. The DTO bounds the length as a second line
 * of defence; this function refuses obvious non-matches before that.
 */
export function buildCrewQrPayload(
  payload: string | null | undefined,
):
  | { ok: true; body: { method: 'qr'; pairing_token: string } }
  | { ok: false; reason: 'empty' | 'not-a-pairing-code' | 'unsupported-version' } {
  const parsed = parseCrewPairingPayload(payload);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  return {
    ok: true,
    body: { method: 'qr', pairing_token: parsed.token },
  };
}

/**
 * What `localizeCrewLoginError` returns, re-exported here so the PIN pad
 * has one import. The function itself lives in `i18n.ts` so the
 * `KNOWN_ERROR_CODES` table and the dictionary share one file.
 */
export type { CrewLoginErrorPresentation };
export const localizeCrewLoginError = localizeCrewLoginErrorCore;

/**
 * `mm:ss` clamp for the lockout countdown — the same shape `pairingCountdown`
 * uses for pairing codes, so the two timers look identical in the UI.
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
