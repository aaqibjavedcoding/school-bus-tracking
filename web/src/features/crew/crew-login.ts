import qrcode from 'qrcode-generator';

import { CREW_PIN_LENGTH, crewPinSchema } from '@school-bus-tracking/validation';

import type { BadgeTone } from '../../components/ui';

/**
 * Pure helpers behind the staff page's "Mobile login" panel (Mobile-UX Phase 4).
 *
 * Everything here is a plain function with no React, no `Date.now()` and no
 * network, so `crew-login.spec.ts` can pin the behaviour — including the QR
 * matrix, which is the one part of this feature that would otherwise be
 * impossible to notice breaking until a driver stands in a depot and cannot
 * scan anything.
 *
 * ### Imports are packages only, and that is a constraint worth knowing
 *
 * `crew-login.spec.ts` runs under `node --experimental-strip-types`, which loads
 * this file as ESM. ESM does not resolve an extensionless relative specifier, and
 * `tsconfig.json` uses `moduleResolution: "bundler"` without
 * `allowImportingTsExtensions`, so the `./x.ts` form the specs themselves use is
 * not available to source files. A relative runtime import here would therefore
 * satisfy the bundler and break the test — so date formatting is left to the
 * component, which reuses `lib/format` as usual. Only `import type` (erased at
 * runtime) may cross into `../../`.
 */

// ── QR rendering ─────────────────────────────────────────────────────────────

/**
 * Error-correction level for the pairing QR.
 *
 * `M` (~15% recovery) is the middle of the range and the right trade here: the
 * code is displayed on a clean, backlit admin screen rather than printed on a
 * label that gets scratched, so the extra density of `Q`/`H` buys little, while
 * `L` leaves no margin for glare or a cracked phone lens. At `M` the 75-byte
 * payload renders as a 37×37 matrix, which is comfortably scannable at the size
 * the modal shows it.
 */
export const QR_ERROR_CORRECTION = 'M';

/**
 * Blank modules around the symbol. Four is the quiet zone the QR spec requires;
 * omitting it is the single most common reason an otherwise correct code will
 * not scan, because the decoder cannot find the symbol's edge.
 */
export const QR_QUIET_ZONE = 4;

/**
 * Encode a pairing payload as a square matrix of dark/light modules.
 *
 * The payload is the server-precomputed `pairing_token` string
 * (`SBT-CREW-1:<token>`), never something assembled here: the format belongs to
 * the shared contract so the admin console and the mobile scanner cannot
 * disagree about it.
 *
 * Encoding uses the default Byte mode. Alphanumeric mode would in principle be
 * smaller for this character set, but `qrcode-generator` rejects the payload in
 * that mode (it throws), and it would also silently break the moment the prefix
 * gained a lowercase character — so the smaller symbol is not available and the
 * attempt should not be repeated.
 */
export function qrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(payload);
  qr.make();

  const size = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const cells: boolean[] = [];
    for (let column = 0; column < size; column += 1) {
      cells.push(qr.isDark(row, column));
    }
    rows.push(cells);
  }
  return rows;
}

/** One SVG sub-path per dark module, in unit coordinates. */
export function matrixToSvgPath(matrix: boolean[][], quietZone = QR_QUIET_ZONE): string {
  const parts: string[] = [];
  matrix.forEach((row, rowIndex) => {
    row.forEach((dark, columnIndex) => {
      if (!dark) return;
      const x = columnIndex + quietZone;
      const y = rowIndex + quietZone;
      parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join('');
}

export interface QrSvg {
  /** The path to render inside a `<path d={…}>`. */
  path: string;
  /** Side length of the `viewBox`, quiet zone included on both edges. */
  size: number;
}

/**
 * Encode a payload straight to SVG geometry.
 *
 * Rendered as vector paths rather than the library's `createSvgTag()` string
 * because that string would have to go through `dangerouslySetInnerHTML`. The
 * payload is server-issued and not user-typed, so this is not a live injection
 * risk today — it is a refusal to make the admin console's only
 * HTML-injection sink depend on that staying true.
 */
export function qrToSvg(payload: string, quietZone = QR_QUIET_ZONE): QrSvg {
  const matrix = qrMatrix(payload);
  return {
    path: matrixToSvgPath(matrix, quietZone),
    size: matrix.length + quietZone * 2,
  };
}

// ── PIN status ───────────────────────────────────────────────────────────────

export interface PinBadge {
  tone: BadgeTone;
  label: string;
  /**
   * Secondary line for the row, or `null` when the component should compose one
   * itself — which it does for the set case, with `formatDateTime` from
   * `lib/format`, so there is exactly one date format in the UI.
   */
  caption: string | null;
}

/**
 * How the staff list reports a crew member's mobile-login state.
 *
 * Three states, not two. `pin_set` is optional on `StaffResponse`, so `undefined`
 * means *this API did not tell me* — which is not the same as "no PIN", and
 * rendering it as "No PIN" would send an administrator to re-issue a credential
 * the driver already has. The neutral badge is the honest answer during a
 * mixed-version deploy, and it disappears on its own once the API populates the
 * field.
 *
 * The values are non-secret by construction: the digest never leaves the server
 * and the plaintext is unrecoverable, so this says only whether a PIN exists and
 * when it was last written.
 */
export function pinBadge(person: {
  pin_set?: boolean | null;
  pin_updated_at?: string | null;
}): PinBadge {
  if (person.pin_set === true) {
    return { tone: 'success', label: 'PIN set', caption: null };
  }
  if (person.pin_set === false) {
    return {
      tone: 'warning',
      label: 'No PIN',
      // States the consequence rather than the field: without a PIN the only way
      // in is a QR an administrator mints one at a time.
      caption: 'Can only sign in by QR',
    };
  }
  return { tone: 'neutral', label: 'PIN unknown', caption: null };
}

// ── Pairing code lifetime ────────────────────────────────────────────────────

export interface PairingCountdown {
  expired: boolean;
  remainingMs: number;
  /** `m:ss`, clamped at zero. */
  label: string;
}

/**
 * Time left on a minted pairing code.
 *
 * `nowMs` is a parameter, not `Date.now()`, so the countdown is testable and so
 * the caller can drive it from one ticking source instead of every row reading
 * the clock independently.
 *
 * Expiry matters more than it looks: the modal must *stop showing the code* when
 * it lapses. A QR that stays on screen after the server will refuse it invites an
 * administrator to hold a phone up to a dead code and conclude the login flow is
 * broken.
 */
export function pairingCountdown(
  expiresAt: string | null | undefined,
  nowMs: number,
): PairingCountdown {
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  if (!Number.isFinite(expiresMs)) {
    // An unparsable or absent expiry is treated as expired: showing a code whose
    // lifetime cannot be verified is worse than asking for a fresh one.
    return { expired: true, remainingMs: 0, label: '0:00' };
  }

  const remainingMs = Math.max(0, expiresMs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    expired: remainingMs <= 0,
    remainingMs,
    label: `${minutes}:${String(seconds).padStart(2, '0')}`,
  };
}

// ── PIN entry ────────────────────────────────────────────────────────────────

/**
 * Reduce whatever an administrator typed or pasted to at most four digits.
 *
 * Stripping rather than rejecting makes the common cases — a PIN pasted from a
 * note with spaces, a dash-separated `48-21`, a keypad that emits `-` for
 * backspace — just work. It never *adds* a character, so it cannot turn an
 * invalid entry into a valid one.
 */
export function normalizePinInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CREW_PIN_LENGTH);
}

/**
 * The message to show for a PIN draft, or `null` when it is acceptable.
 *
 * Runs the *shared* `crewPinSchema`, so the rule shown in the browser is the
 * rule the server enforces — the same reason the staff form validates against
 * `staffCreateSchema` rather than a local regex.
 */
export function validatePinDraft(pin: string): string | null {
  const parsed = crewPinSchema.safeParse(pin);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'PIN is not valid');
}
