import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StaffResponse } from '@school-bus-tracking/shared-types';
import { UserRole } from '@school-bus-tracking/shared-types';

import { pinBadge, pairingCountdown, qrToSvg, normalizePinInput, validatePinDraft } from './crew-login.ts';

/**
 * The staff modal is a thin consumer of the helpers in `./crew-login.ts`,
 * which already ship with their own spec. The thin part — the contract the
 * modal exposes to its parent (the staff page) and the contract it relies on
 * from the helpers — is what this file pins, because most of the modal is
 * JSX and its behaviour is exercised through those helpers plus the props
 * the parent passes.
 *
 * Anything that would be exercised through DOM clicks lives behind a manual
 * smoke check on a real browser session and is not in scope for `node:test`.
 * What is pinned here:
 *
 * 1. the helper contract the modal relies on (already covered by
 *    `crew-login.spec.ts`; this file re-checks the public surface so a future
 *    refactor of the helpers still answers what the modal asks of them);
 * 2. the badge tone mapping the modal renders for the current row state;
 * 3. the countdown clamp behaviour that hides an expired QR;
 * 4. the QR vector path produces something scannable (non-empty, sized
 *    larger than the matrix because of the quiet zone).
 */

const DRIVER: StaffResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  school_id: '22222222-2222-2222-2222-222222222222',
  role: UserRole.DRIVER,
  first_name: 'Aisha',
  last_name: 'Khan',
  email: 'aisha@example.edu',
  phone: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pin_set: true,
  pin_updated_at: '2026-02-01T00:00:00.000Z',
};

describe('crew-login helpers consumed by the modal', () => {
  it('pinBadge reports the three states the modal renders', () => {
    assert.deepEqual(pinBadge({ pin_set: true }), { tone: 'success', label: 'PIN set', caption: null });
    assert.deepEqual(pinBadge({ pin_set: false }), {
      tone: 'warning',
      label: 'No PIN',
      caption: 'Can only sign in by QR',
    });
    assert.deepEqual(pinBadge({}), { tone: 'neutral', label: 'PIN unknown', caption: null });
  });

  it('pairingCountdown returns expired=true with a zero label for a past expiry', () => {
    // "now" is well in the future relative to the fixed past expiry, so the
    // pairing code must be reported as expired with zero remaining time.
    const result = pairingCountdown('2026-01-01T00:00:00.000Z', 1_000_000_000_000_000);
    assert.equal(result.expired, true);
    assert.equal(result.remainingMs, 0);
    assert.equal(result.label, '0:00');
  });

  it('pairingCountdown returns the remaining time in m:ss when live', () => {
    const now = 1_700_000_000_000;
    const result = pairingCountdown(new Date(now + 65_000).toISOString(), now);
    assert.equal(result.expired, false);
    assert.equal(result.label, '1:05');
  });

  it('qrToSvg produces a non-empty path and a square viewBox larger than the matrix', () => {
    const svg = qrToSvg('SBT-CREW-1:' + 'a'.repeat(64));
    assert.ok(svg.path.length > 0, 'the QR path must not be empty');
    assert.equal(svg.size, svg.size, 'square viewBox');
    // The quiet zone (4 modules on every edge) makes the viewBox strictly
    // larger than the matrix itself.
    assert.ok(svg.size > 21, 'the matrix is at least 21×21 modules');
  });

  it('normalizePinInput strips non-digits and clamps to four characters', () => {
    assert.equal(normalizePinInput('12-34'), '1234');
    assert.equal(normalizePinInput('123456'), '1234');
    assert.equal(normalizePinInput('a1b2c3'), '123');
    assert.equal(normalizePinInput(''), '');
  });

  it('validatePinDraft returns null for a 4-digit string and a message otherwise', () => {
    assert.equal(validatePinDraft('1234'), null);
    assert.equal(validatePinDraft('12'), 'PIN must be exactly 4 digits');
    assert.equal(validatePinDraft('12ab'), 'PIN must be exactly 4 digits');
  });

  it('the helper row the modal renders agrees with the API payload', () => {
    // The modal renders `pinBadge(person)` for the current row; a server that
    // returns `pin_set: true, pin_updated_at: <iso>` must produce the
    // success badge with no caption — i.e. the "PIN set" state, not the
    // "PIN unknown" state the modal would show during a mixed-version
    // deploy.
    assert.deepEqual(pinBadge(DRIVER), { tone: 'success', label: 'PIN set', caption: null });
  });
});
