import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENTATION_DEDUP_CAPACITY,
  PRESENTATION_DEDUP_TTL_MS,
  claimNotificationPresentation,
  getPresentationAccount,
  presentationSeenCount,
  resetPresentationDedup,
  setPresentationAccount,
  wasNotificationPresented,
} from './presentation-dedup.ts';

/**
 * Foreground socket + push de-duplication.
 *
 * One logical notification can arrive over the `/notifications` socket and over
 * FCM/APNs. Whichever rail arrives first presents it; the second must not show a
 * second banner or play a second sound — while a genuinely different
 * notification must always be presented, and the store must never grow without
 * bound or leak across accounts.
 */

const PARENT = { userId: 'parent-1', schoolId: 'school-1' };

afterEach(() => {
  setPresentationAccount(null);
  resetPresentationDedup();
});

describe('claimNotificationPresentation', () => {
  it('presents the first arrival and suppresses the duplicate', () => {
    setPresentationAccount(PARENT);
    assert.equal(claimNotificationPresentation('n-1', { channel: 'socket' }), true);
    assert.equal(claimNotificationPresentation('n-1', { channel: 'push' }), false);
  });

  it('is symmetric: push first also suppresses the socket banner', () => {
    setPresentationAccount(PARENT);
    assert.equal(claimNotificationPresentation('n-2', { channel: 'push' }), true);
    assert.equal(claimNotificationPresentation('n-2', { channel: 'socket' }), false);
  });

  it('never suppresses a distinct notification', () => {
    setPresentationAccount(PARENT);
    for (const id of ['n-1', 'n-2', 'n-3']) {
      assert.equal(claimNotificationPresentation(id), true, id);
    }
    assert.equal(presentationSeenCount(), 3);
  });

  it('presents a payload that carries no stable id (no dedup possible)', () => {
    setPresentationAccount(PARENT);
    assert.equal(claimNotificationPresentation(undefined), true);
    assert.equal(claimNotificationPresentation(null), true);
    assert.equal(claimNotificationPresentation(''), true);
    assert.equal(presentationSeenCount(), 0, 'an unidentified event is not remembered');
  });

  it('reports what was already presented without claiming it', () => {
    setPresentationAccount(PARENT);
    assert.equal(wasNotificationPresented('n-9'), false);
    claimNotificationPresentation('n-9');
    assert.equal(wasNotificationPresented('n-9'), true);
    assert.equal(presentationSeenCount(), 1);
  });

  it('expires an id after the TTL so a much later repeat is presented', () => {
    setPresentationAccount(PARENT);
    const t0 = Date.parse('2026-09-19T08:00:00.000Z');
    assert.equal(claimNotificationPresentation('n-1', { now: t0 }), true);
    assert.equal(
      claimNotificationPresentation('n-1', { now: t0 + PRESENTATION_DEDUP_TTL_MS - 1 }),
      false,
    );
    assert.equal(
      claimNotificationPresentation('n-1', { now: t0 + PRESENTATION_DEDUP_TTL_MS + 1 }),
      true,
      'after the window the same id may be presented again',
    );
  });

  it('bounds memory: the store never exceeds its capacity', () => {
    setPresentationAccount(PARENT);
    for (let index = 0; index < PRESENTATION_DEDUP_CAPACITY + 50; index += 1) {
      claimNotificationPresentation(`n-${index}`);
    }
    assert.ok(
      presentationSeenCount() <= PRESENTATION_DEDUP_CAPACITY,
      `expected at most ${PRESENTATION_DEDUP_CAPACITY} ids, saw ${presentationSeenCount()}`,
    );
    // The newest id is still suppressed; the oldest was evicted and re-presents.
    assert.equal(
      claimNotificationPresentation(`n-${PRESENTATION_DEDUP_CAPACITY + 49}`),
      false,
    );
    assert.equal(claimNotificationPresentation('n-0'), true);
  });
});

describe('account scoping', () => {
  it('clears remembered ids when the account changes', () => {
    setPresentationAccount(PARENT);
    claimNotificationPresentation('n-1');
    assert.equal(presentationSeenCount(), 1);

    setPresentationAccount({ userId: 'parent-2', schoolId: 'school-1' });
    assert.equal(presentationSeenCount(), 0, 'a new account starts with no suppression');
    assert.equal(claimNotificationPresentation('n-1'), true, 'the same id is presented again');
  });

  it('clears on logout and records no account', () => {
    setPresentationAccount(PARENT);
    claimNotificationPresentation('n-1');
    setPresentationAccount(null);
    assert.equal(getPresentationAccount(), null);
    assert.equal(presentationSeenCount(), 0);
  });

  it('keeps its store when the same account is re-bound (a remount)', () => {
    setPresentationAccount(PARENT);
    claimNotificationPresentation('n-1');
    setPresentationAccount({ ...PARENT });
    assert.equal(presentationSeenCount(), 1);
    assert.equal(claimNotificationPresentation('n-1'), false);
  });

  it('scopes ids by tenant as well as user', () => {
    setPresentationAccount(PARENT);
    claimNotificationPresentation('shared-id');
    setPresentationAccount({ userId: 'parent-1', schoolId: 'school-2' });
    assert.equal(
      claimNotificationPresentation('shared-id'),
      true,
      'the same id in another tenant is a different notification',
    );
  });
});
