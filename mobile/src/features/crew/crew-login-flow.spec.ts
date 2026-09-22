import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCrewPinDraft,
  isCrewLoginNetworkFailure,
  lockoutCountdown,
} from './crew-login-flow.ts';

/**
 * The thin React surfaces (PIN pad) sit on top of these
 * helpers; everything they rely on is pinned here so a future "easy fix"
 * cannot silently change the wire format or the user-facing message.
 *
 * `t()` is not exercised here — the dictionary and the error-code map have
 * their own parity/clipping specs (`i18n-parity.spec.ts`,
 * `i18n-literals.spec.ts`). What we cover here is the *pure* glue, including
 * the exact shape of the PIN request body: a crew login is
 * `{ method: 'pin', school_id, pin }`, and the server resolves which crew
 * member the PIN belongs to.
 */

describe('buildCrewPinDraft', () => {
  it('trims the school code, digit-strips the pin, and clamps to four digits', () => {
    const result = buildCrewPinDraft({ schoolId: ' lincoln-high ', pin: '12-34' });
    assert.deepEqual(result, { schoolId: 'lincoln-high', pin: '1234' });
  });

  it('builds exactly the two-field body the server accepts — no user id', () => {
    // The wire contract, pinned here so a re-added `userId` fails the suite
    // rather than shipping a field the DTO no longer declares.
    const result = buildCrewPinDraft({ schoolId: 'lincoln-high', pin: '4821' });
    assert.deepEqual(result, { schoolId: 'lincoln-high', pin: '4821' });
    assert.deepEqual(Object.keys(result).sort(), ['pin', 'schoolId']);
  });

  it('returns a typed error for an empty school code', () => {
    assert.deepEqual(buildCrewPinDraft({ schoolId: '   ', pin: '1234' }), {
      error: 'schoolId',
    });
  });

  it('returns a typed error for a non-numeric pin', () => {
    assert.deepEqual(buildCrewPinDraft({ schoolId: 'lincoln-high', pin: 'abcd' }), {
      error: 'pin',
    });
  });

  it('returns a typed error for a pin that is the wrong length after stripping', () => {
    assert.deepEqual(buildCrewPinDraft({ schoolId: 'lincoln-high', pin: '12' }), {
      error: 'pin',
    });
  });
});

describe('isCrewLoginNetworkFailure', () => {
  it('flags the offline / no-data shapes the login screen must map to its own copy', () => {
    // The api-client re-throws every transport rejection as status 0.
    assert.equal(isCrewLoginNetworkFailure({ status: 0, message: 'fetch failed' }), true);
    // Android's raw DNS diagnostic must be recognised from the message alone
    // — this is the string the crew PIN path used to surface verbatim.
    assert.equal(
      isCrewLoginNetworkFailure(
        new Error(
          'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.school.example"',
        ),
      ),
      true,
    );
    assert.equal(isCrewLoginNetworkFailure(new Error('Network request failed')), true);
    assert.equal(isCrewLoginNetworkFailure(new Error('connection refused')), true);
  });

  it('leaves real rejections (wrong PIN, lockout) to the normal error path', () => {
    assert.equal(
      isCrewLoginNetworkFailure({
        status: 401,
        code: 'CREW_PIN_INVALID',
        message: 'That PIN did not work. Please try again.',
      }),
      false,
    );
    assert.equal(
      isCrewLoginNetworkFailure({
        status: 429,
        code: 'CREW_PIN_LOCKED',
        message: 'Too many attempts',
        details: { lockedForSeconds: 300 },
      }),
      false,
    );
    assert.equal(isCrewLoginNetworkFailure(new Error('CREW_PIN_LOCKED')), false);
    assert.equal(isCrewLoginNetworkFailure(null), false);
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
