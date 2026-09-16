import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCrewPinDraft,
  buildCrewQrPayload,
  lockoutCountdown,
} from './crew-login-flow.ts';

/**
 * The thin React surfaces (PIN pad, QR scanner) sit on top of these
 * helpers; everything they rely on is pinned here so a future "easy fix"
 * cannot silently change the wire format or the user-facing message.
 *
 * `t()` is not exercised here — the dictionary and the error-code map have
 * their own parity/clipping specs (`i18n-parity.spec.ts`,
 * `i18n-literals.spec.ts`). What we cover here is the *pure* glue:
 */

describe('buildCrewPinDraft', () => {
  it('trims school and user ids, digit-strips the pin, and clamps to four digits', () => {
    const result = buildCrewPinDraft({
      schoolId: ' lincoln-high ',
      userId: ' 11111111-1111-1111-1111-111111111111 ',
      pin: '12-34',
    });
    assert.deepEqual(result, {
      schoolId: 'lincoln-high',
      userId: '11111111-1111-1111-1111-111111111111',
      pin: '1234',
    });
  });

  it('returns a typed error for an empty school id', () => {
    const result = buildCrewPinDraft({
      schoolId: '   ',
      userId: '11111111-1111-1111-1111-111111111111',
      pin: '1234',
    });
    assert.deepEqual(result, { error: 'schoolId' });
  });

  it('returns a typed error for an empty user id', () => {
    const result = buildCrewPinDraft({
      schoolId: 'lincoln-high',
      userId: '',
      pin: '1234',
    });
    assert.deepEqual(result, { error: 'userId' });
  });

  it('returns a typed error for a non-numeric pin', () => {
    const result = buildCrewPinDraft({
      schoolId: 'lincoln-high',
      userId: '11111111-1111-1111-1111-111111111111',
      pin: 'abcd',
    });
    assert.deepEqual(result, { error: 'pin' });
  });

  it('returns a typed error for a pin that is the wrong length after stripping', () => {
    const result = buildCrewPinDraft({
      schoolId: 'lincoln-high',
      userId: '11111111-1111-1111-1111-111111111111',
      pin: '12',
    });
    assert.deepEqual(result, { error: 'pin' });
  });
});

describe('buildCrewQrPayload', () => {
  it('builds the request body for a well-formed payload', () => {
    const token = 'a'.repeat(64);
    const result = buildCrewQrPayload(`SBT-CREW-1:${token}`);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.body, { method: 'qr', pairing_token: token });
    }
  });

  it('trims whitespace before parsing', () => {
    const token = 'b'.repeat(64);
    const result = buildCrewQrPayload(`   SBT-CREW-1:${token}   `);
    assert.equal(result.ok, true);
  });

  it('refuses an empty scan', () => {
    assert.deepEqual(buildCrewQrPayload(''), { ok: false, reason: 'empty' });
    assert.deepEqual(buildCrewQrPayload('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(buildCrewQrPayload(null), { ok: false, reason: 'empty' });
    assert.deepEqual(buildCrewQrPayload(undefined), { ok: false, reason: 'empty' });
  });

  it('refuses a non-pairing-code string (URL, Wi-Fi code, barcode)', () => {
    assert.deepEqual(buildCrewQrPayload('https://example.com'), {
      ok: false,
      reason: 'not-a-pairing-code',
    });
    assert.deepEqual(buildCrewQrPayload('WIFI:S:home;T:WPA;P:secret;;'), {
      ok: false,
      reason: 'not-a-pairing-code',
    });
  });

  it('refuses a future pairing-version prefix with its own reason', () => {
    assert.deepEqual(buildCrewQrPayload('SBT-CREW-2:token'), {
      ok: false,
      reason: 'unsupported-version',
    });
  });
});

describe('lockoutCountdown', () => {
  it('expires immediately when the total is null or non-positive', () => {
    assert.deepEqual(lockoutCountdown(null, 0), { expired: true, label: '0:00' });
    assert.deepEqual(lockoutCountdown(0, 0), { expired: true, label: '0:00' });
    assert.deepEqual(lockoutCountdown(-1, 0), { expired: true, label: '0:00' });
    assert.deepEqual(lockoutCountdown(Number.NaN, 0), { expired: true, label: '0:00' });
  });

  it('formats m:ss with a zero-padded seconds field', () => {
    // 65 s total at now=10 → 55 s remaining.
    assert.deepEqual(lockoutCountdown(65, 10), { expired: false, label: '0:55' });
    // 75 s total at now=10 → 65 s remaining → 1:05.
    assert.deepEqual(lockoutCountdown(75, 10), { expired: false, label: '1:05' });
    // 15 * 60 + 7 = 907 s total at now=0 → 15:07.
    assert.deepEqual(lockoutCountdown(907, 0), { expired: false, label: '15:07' });
  });

  it('collapses to expired when the clock catches up', () => {
    assert.deepEqual(lockoutCountdown(5, 10), { expired: true, label: '0:00' });
    assert.deepEqual(lockoutCountdown(0, 5), { expired: true, label: '0:00' });
  });
});
