import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PASSWORD_RESET_DEFAULT_TTL_MS,
  PASSWORD_RESET_RETENTION_MS,
  PASSWORD_RESET_TTL_BOUNDS_MS,
  inspectPasswordResetToken,
  isPasswordResetTokenPurgeable,
  isPasswordResetTokenUsable,
  markPasswordResetTokenUsed,
  passwordResetExpiryAt,
  passwordResetTtlMinutes,
  resolvePasswordResetTtlMs,
  selectSupersededTokenIds,
  type PasswordResetTokenRecord,
} from './password-reset-tokens';

/**
 * The reset-link policy, pinned by number and by timeline.
 *
 * Three properties carry the whole security argument of the self-service
 * reset flow, and each gets its own section below:
 *
 * 1. **a link expires** — inside a 30–60 minute band no deployment can widen;
 * 2. **a link is single-use** — the second redemption is refused as
 *    `already_used`, not silently re-honoured;
 * 3. **issuing a link kills the previous one** — so an account never has two
 *    working reset links in two different inboxes.
 *
 * The module takes `now` as an argument, so the timeline below is literal
 * arithmetic with no fake timers and no sleeps.
 */

const MINUTE = 60_000;
const T0 = Date.parse('2026-03-01T09:00:00.000Z');

/** A live token minted at `T0` with the default lifetime. */
function liveToken(overrides: Partial<PasswordResetTokenRecord> = {}): PasswordResetTokenRecord {
  return {
    id: 'token-1',
    user_id: 'user-1',
    expires_at: new Date(T0 + PASSWORD_RESET_DEFAULT_TTL_MS),
    used_at: null,
    ...overrides,
  };
}

describe('password reset TTL policy', () => {
  it('ships a 45-minute default inside a 30–60 minute band', () => {
    assert.equal(PASSWORD_RESET_TTL_BOUNDS_MS.min, 30 * MINUTE);
    assert.equal(PASSWORD_RESET_TTL_BOUNDS_MS.max, 60 * MINUTE);
    assert.equal(PASSWORD_RESET_DEFAULT_TTL_MS, 45 * MINUTE);
    // The email promises "30-60 minutes"; the default must be inside what it promises.
    assert.ok(PASSWORD_RESET_DEFAULT_TTL_MS >= PASSWORD_RESET_TTL_BOUNDS_MS.min);
    assert.ok(PASSWORD_RESET_DEFAULT_TTL_MS <= PASSWORD_RESET_TTL_BOUNDS_MS.max);
  });

  it('clamps rather than rejects, so a bad env var never breaks reset', () => {
    // A deployment cannot turn a reset link into a standing key...
    assert.equal(resolvePasswordResetTtlMs(7 * 24 * 60 * MINUTE), PASSWORD_RESET_TTL_BOUNDS_MS.max);
    // ...nor into something too short for a real mail round trip.
    assert.equal(resolvePasswordResetTtlMs(30_000), PASSWORD_RESET_TTL_BOUNDS_MS.min);
    // In-band values are honoured exactly.
    assert.equal(resolvePasswordResetTtlMs(40 * MINUTE), 40 * MINUTE);
  });

  it('falls back to the default for anything unusable', () => {
    for (const raw of [null, undefined, '', '   ', 'soon', '0', '-1', Number.NaN]) {
      assert.equal(
        resolvePasswordResetTtlMs(raw as never),
        PASSWORD_RESET_DEFAULT_TTL_MS,
        `expected default for ${JSON.stringify(raw)}`,
      );
    }
  });

  it('accepts the raw string form a config layer hands over', () => {
    assert.equal(resolvePasswordResetTtlMs('2400000'), 40 * MINUTE);
    assert.equal(resolvePasswordResetTtlMs(' 2400000 '), 40 * MINUTE);
  });

  it('derives the minutes the email prints from the TTL it enforces', () => {
    // The sentence in the email is never typed by hand: this is the guard
    // that "expires in N minutes" cannot drift from the server's clock.
    assert.equal(passwordResetTtlMinutes(PASSWORD_RESET_DEFAULT_TTL_MS), 45);
    assert.equal(passwordResetTtlMinutes(30 * MINUTE), 30);
    assert.equal(passwordResetTtlMinutes(60 * MINUTE), 60);
    assert.equal(passwordResetTtlMinutes(89_000), 1, 'rounds, and never prints "0 minutes"');
  });

  it('computes expiry as an absolute instant from the mint time', () => {
    assert.equal(
      passwordResetExpiryAt(T0, PASSWORD_RESET_DEFAULT_TTL_MS).toISOString(),
      new Date(T0 + 45 * MINUTE).toISOString(),
    );
  });
});

describe('password reset token expiry', () => {
  it('honours a link right up to its expiry instant and refuses it at it', () => {
    const token = liveToken();
    assert.equal(isPasswordResetTokenUsable(token, T0), true);
    assert.equal(isPasswordResetTokenUsable(token, T0 + 44 * MINUTE), true);
    // Exactly at expiry the link is dead — `<=`, not `<`.
    assert.equal(isPasswordResetTokenUsable(token, T0 + 45 * MINUTE), false);
    assert.deepEqual(inspectPasswordResetToken(token, T0 + 45 * MINUTE), {
      usable: false,
      reason: 'expired',
    });
  });

  it('refuses an unknown token', () => {
    assert.deepEqual(inspectPasswordResetToken(null, T0), { usable: false, reason: 'not_found' });
    assert.deepEqual(inspectPasswordResetToken(undefined, T0), {
      usable: false,
      reason: 'not_found',
    });
  });

  it('treats an unreadable expiry as expired, never as usable', () => {
    // A corrupted timestamp must not widen a credential's life.
    const broken = liveToken({ expires_at: 'not-a-date' });
    assert.deepEqual(inspectPasswordResetToken(broken, T0), { usable: false, reason: 'expired' });
  });

  it('reads expiry from a Date, an ISO string or epoch millis alike', () => {
    const at = T0 + 10 * MINUTE;
    for (const expires_at of [new Date(at), new Date(at).toISOString(), at]) {
      assert.equal(isPasswordResetTokenUsable(liveToken({ expires_at }), T0), true);
      assert.equal(isPasswordResetTokenUsable(liveToken({ expires_at }), at + 1), false);
    }
  });
});

describe('password reset token single use', () => {
  it('spends a token exactly once', () => {
    const token = liveToken();
    assert.equal(isPasswordResetTokenUsable(token, T0 + MINUTE), true);

    const spent = { ...token, ...markPasswordResetTokenUsed(T0 + MINUTE) };
    assert.deepEqual(inspectPasswordResetToken(spent, T0 + 2 * MINUTE), {
      usable: false,
      reason: 'already_used',
    });
  });

  it('records the redemption instant', () => {
    const { used_at } = markPasswordResetTokenUsed(T0);
    assert.ok(used_at instanceof Date);
    assert.equal(used_at.getTime(), T0);
  });

  it('reports "already used" before "expired" for a spent link that also aged out', () => {
    // To the person clicking, this is a link they already used; to an
    // investigator it is a replay attempt. Reporting `expired` would hide
    // the more interesting fact.
    const replayed = liveToken({ used_at: new Date(T0 + MINUTE) });
    assert.deepEqual(inspectPasswordResetToken(replayed, T0 + 10 * 60 * MINUTE), {
      usable: false,
      reason: 'already_used',
    });
  });

  it('walks a full redemption timeline', () => {
    // mint -> click (ok) -> click again (refused) -> click much later (still refused)
    const minted = liveToken();
    assert.equal(inspectPasswordResetToken(minted, T0 + 5 * MINUTE).reason, 'ok');

    const afterUse = { ...minted, ...markPasswordResetTokenUsed(T0 + 5 * MINUTE) };
    assert.equal(inspectPasswordResetToken(afterUse, T0 + 6 * MINUTE).reason, 'already_used');
    assert.equal(inspectPasswordResetToken(afterUse, T0 + 600 * MINUTE).reason, 'already_used');
  });
});

describe('password reset reissue invalidates older links', () => {
  it('kills every other unused row of the user', () => {
    const rows: PasswordResetTokenRecord[] = [
      liveToken({ id: 'old-1' }),
      liveToken({ id: 'old-2' }),
      liveToken({ id: 'new' }),
    ];
    assert.deepEqual(selectSupersededTokenIds(rows, { exceptId: 'new' }), ['old-1', 'old-2']);
  });

  it('includes already-expired unused rows, so `used_at IS NULL` means "the current link"', () => {
    const rows: PasswordResetTokenRecord[] = [
      liveToken({ id: 'stale', expires_at: new Date(T0 - MINUTE) }),
      liveToken({ id: 'new' }),
    ];
    assert.deepEqual(selectSupersededTokenIds(rows, { exceptId: 'new' }), ['stale']);
  });

  it('never re-kills an already-spent row', () => {
    const rows: PasswordResetTokenRecord[] = [
      liveToken({ id: 'spent', used_at: new Date(T0 - MINUTE) }),
      liveToken({ id: 'live' }),
    ];
    // Only `live` is unused; `spent` keeps its original `used_at`, so its
    // redemption instant survives for the audit trail.
    assert.deepEqual(selectSupersededTokenIds(rows), ['live']);
  });

  it('is safe to run before the insert too (no `exceptId`)', () => {
    const rows: PasswordResetTokenRecord[] = [liveToken({ id: 'a' }), liveToken({ id: 'b' })];
    assert.deepEqual(selectSupersededTokenIds(rows), ['a', 'b']);
    assert.deepEqual(selectSupersededTokenIds(rows, { exceptId: null }), ['a', 'b']);
  });

  it('leaves exactly one live link after a reissue', () => {
    const first = liveToken({ id: 'first' });
    const second = liveToken({ id: 'second', expires_at: new Date(T0 + 50 * MINUTE) });
    const superseded = new Set(selectSupersededTokenIds([first, second], { exceptId: 'second' }));

    const after = [first, second].map((row) =>
      superseded.has(row.id as string) ? { ...row, ...markPasswordResetTokenUsed(T0) } : row,
    );
    const live = after.filter((row) => isPasswordResetTokenUsable(row, T0 + MINUTE));
    assert.equal(live.length, 1);
    assert.equal(live[0].id, 'second');
  });

  it('skips rows without an id rather than emitting `undefined`', () => {
    const rows: PasswordResetTokenRecord[] = [{ expires_at: new Date(T0 + MINUTE), used_at: null }];
    assert.deepEqual(selectSupersededTokenIds(rows), []);
  });
});

describe('password reset row retention', () => {
  it('keeps dead rows for 24 hours so a stale click still gets an honest answer', () => {
    assert.equal(PASSWORD_RESET_RETENTION_MS, 24 * 60 * MINUTE);
    const spent = liveToken({ used_at: new Date(T0) });
    assert.equal(isPasswordResetTokenPurgeable(spent, T0 + 23 * 60 * MINUTE), false);
    assert.equal(isPasswordResetTokenPurgeable(spent, T0 + 24 * 60 * MINUTE), true);
  });

  it('never purges a live link', () => {
    assert.equal(isPasswordResetTokenPurgeable(liveToken(), T0 + 10 * MINUTE), false);
  });

  it('measures an expired-but-unused row from its expiry', () => {
    const row = liveToken();
    const expiredAt = T0 + PASSWORD_RESET_DEFAULT_TTL_MS;
    assert.equal(isPasswordResetTokenPurgeable(row, expiredAt + PASSWORD_RESET_RETENTION_MS - 1), false);
    assert.equal(isPasswordResetTokenPurgeable(row, expiredAt + PASSWORD_RESET_RETENTION_MS), true);
  });

  it('measures a spent row from whichever came first', () => {
    // Used early, would have expired later: the row has been dead since the
    // redemption, so retention counts from there.
    const spent = liveToken({ used_at: new Date(T0 + MINUTE) });
    assert.equal(
      isPasswordResetTokenPurgeable(spent, T0 + MINUTE + PASSWORD_RESET_RETENTION_MS),
      true,
    );
  });

  it('refuses to delete a row whose timestamps cannot be read', () => {
    const broken: PasswordResetTokenRecord = { expires_at: 'nonsense', used_at: null };
    assert.equal(isPasswordResetTokenPurgeable(broken, T0 + 10 * 365 * 24 * 60 * MINUTE), false);
  });

  it('honours an explicit retention override', () => {
    const spent = liveToken({ used_at: new Date(T0) });
    assert.equal(isPasswordResetTokenPurgeable(spent, T0 + 2 * MINUTE, MINUTE), true);
  });
});
