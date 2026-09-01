import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';
import {
  NO_SUBSCRIPTION_ENTITLEMENT,
  isSubscriptionLapsed,
  pastDueGraceMsFromDays,
  resolveSubscriptionEntitlement,
} from './subscription-access';
import { SUBSCRIPTION_LAPSED_CODE, SubscriptionLapsedException } from './subscription-lapsed.exception';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const YESTERDAY = new Date('2026-08-31T12:00:00.000Z');
const TOMORROW = new Date('2026-09-02T12:00:00.000Z');
const GRACE_7_DAYS = { pastDueGraceMs: 7 * 24 * 60 * 60 * 1000 };

describe('resolveSubscriptionEntitlement — no subscription', () => {
  it('projects the "none" state without access', () => {
    assert.deepEqual(resolveSubscriptionEntitlement(null, NOW), NO_SUBSCRIPTION_ENTITLEMENT);
    assert.deepEqual(resolveSubscriptionEntitlement(undefined, NOW), NO_SUBSCRIPTION_ENTITLEMENT);
    assert.equal(NO_SUBSCRIPTION_ENTITLEMENT.effective_status, SubscriptionStatus.NONE);
    assert.equal(NO_SUBSCRIPTION_ENTITLEMENT.has_paid_access, false);
  });
});

describe('resolveSubscriptionEntitlement — active', () => {
  it('grants access inside the current period', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: TOMORROW },
      NOW,
    );
    assert.equal(entitlement.effective_status, SubscriptionStatus.ACTIVE);
    assert.equal(entitlement.has_paid_access, true);
    assert.equal(entitlement.lapsed, false);
    assert.deepEqual(entitlement.access_expires_at, TOMORROW);
  });

  it('grants access for an open-ended period (current_period_end NULL)', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: null },
      NOW,
    );
    assert.equal(entitlement.has_paid_access, true);
    assert.equal(entitlement.access_expires_at, null);
  });

  it('REVOKES access once the period ended, even though the stored status still says active', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: YESTERDAY },
      NOW,
    );
    assert.equal(entitlement.effective_status, SubscriptionStatus.EXPIRED);
    assert.equal(entitlement.has_paid_access, false);
    assert.equal(entitlement.lapsed, true);
  });
});

describe('resolveSubscriptionEntitlement — trialing', () => {
  it('grants access inside the trial window', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.TRIALING, trial_end: TOMORROW },
      NOW,
    );
    assert.equal(entitlement.effective_status, SubscriptionStatus.TRIALING);
    assert.equal(entitlement.has_paid_access, true);
  });

  it('revokes access once the trial ended', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.TRIALING, trial_end: YESTERDAY },
      NOW,
    );
    assert.equal(entitlement.effective_status, SubscriptionStatus.EXPIRED);
    assert.equal(entitlement.has_paid_access, false);
    assert.equal(entitlement.lapsed, true);
  });

  it('never grants an unlimited trial when trial_end is missing', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.TRIALING, trial_end: null },
      NOW,
    );
    assert.equal(entitlement.has_paid_access, false);
  });

  it('ignores the period window while trialing', () => {
    const entitlement = resolveSubscriptionEntitlement(
      {
        status: SubscriptionStatus.TRIALING,
        trial_end: TOMORROW,
        current_period_end: YESTERDAY,
      },
      NOW,
    );
    assert.equal(entitlement.has_paid_access, true);
  });
});

describe('resolveSubscriptionEntitlement — past_due (explicit, bounded policy)', () => {
  it('keeps access while still inside the paid period', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.PAST_DUE, current_period_end: TOMORROW },
      NOW,
      GRACE_7_DAYS,
    );
    assert.equal(entitlement.effective_status, SubscriptionStatus.PAST_DUE);
    assert.equal(entitlement.has_paid_access, true);
  });

  it('keeps access inside the dunning grace window after the period ended', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.PAST_DUE, current_period_end: YESTERDAY },
      NOW,
      GRACE_7_DAYS,
    );
    assert.equal(entitlement.has_paid_access, true);
    assert.deepEqual(
      entitlement.access_expires_at,
      new Date(YESTERDAY.getTime() + GRACE_7_DAYS.pastDueGraceMs),
    );
  });

  it('is NOT an indefinite free ride: access lapses after the grace window', () => {
    const longAgo = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.PAST_DUE, current_period_end: longAgo },
      NOW,
      GRACE_7_DAYS,
    );
    assert.equal(entitlement.effective_status, SubscriptionStatus.EXPIRED);
    assert.equal(entitlement.has_paid_access, false);
  });

  it('honours a zero-day grace configuration', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.PAST_DUE, current_period_end: YESTERDAY },
      NOW,
      { pastDueGraceMs: 0 },
    );
    assert.equal(entitlement.has_paid_access, false);
  });
});

describe('resolveSubscriptionEntitlement — terminal states', () => {
  it('cancelled and expired never grant access', () => {
    for (const status of [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED]) {
      const entitlement = resolveSubscriptionEntitlement(
        { status, current_period_end: TOMORROW, trial_end: TOMORROW },
        NOW,
      );
      assert.equal(entitlement.has_paid_access, false, status);
      assert.equal(entitlement.effective_status, status);
      assert.equal(entitlement.lapsed, false, status);
    }
  });

  it('an unknown stored status never grants access', () => {
    const entitlement = resolveSubscriptionEntitlement({ status: 'weird' }, NOW);
    assert.equal(entitlement.has_paid_access, false);
  });
});

describe('timezone and boundary handling', () => {
  it('compares absolute instants, so the offset notation does not matter', () => {
    const utc = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: '2026-09-01T18:00:00.000Z' },
      NOW,
    );
    const offset = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: '2026-09-01T23:30:00.000+05:30' },
      NOW,
    );
    assert.equal(utc.has_paid_access, true);
    assert.equal(offset.has_paid_access, true);
    assert.deepEqual(utc.access_expires_at, offset.access_expires_at);
  });

  it('treats the exact expiry instant as expired (end-exclusive)', () => {
    const atBoundary = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: NOW },
      NOW,
    );
    assert.equal(atBoundary.has_paid_access, false);

    const oneMsBefore = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.ACTIVE, current_period_end: new Date(NOW.getTime() + 1) },
      NOW,
    );
    assert.equal(oneMsBefore.has_paid_access, true);
  });

  it('accepts Date and ISO string inputs interchangeably', () => {
    const fromString = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.TRIALING, trial_end: TOMORROW.toISOString() },
      NOW,
    );
    assert.equal(fromString.has_paid_access, true);
  });

  it('does not grant access on an unparseable date', () => {
    const entitlement = resolveSubscriptionEntitlement(
      { status: SubscriptionStatus.TRIALING, trial_end: 'not-a-date' },
      NOW,
    );
    assert.equal(entitlement.has_paid_access, false);
  });
});

describe('isSubscriptionLapsed / pastDueGraceMsFromDays', () => {
  it('flags a stale live row', () => {
    assert.equal(
      isSubscriptionLapsed({ status: SubscriptionStatus.ACTIVE, current_period_end: YESTERDAY }, NOW),
      true,
    );
    assert.equal(
      isSubscriptionLapsed({ status: SubscriptionStatus.ACTIVE, current_period_end: TOMORROW }, NOW),
      false,
    );
    assert.equal(isSubscriptionLapsed(null, NOW), false);
  });

  it('converts configured days to milliseconds with a safe default', () => {
    assert.equal(pastDueGraceMsFromDays(1), 86_400_000);
    assert.equal(pastDueGraceMsFromDays(0), 0);
    assert.equal(pastDueGraceMsFromDays(undefined), 7 * 86_400_000);
    assert.equal(pastDueGraceMsFromDays(-5), 7 * 86_400_000);
  });
});

describe('SubscriptionLapsedException', () => {
  it('is a 409 carrying the effective and stored status', () => {
    const error = new SubscriptionLapsedException(
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.ACTIVE,
    );
    assert.equal(error.getStatus(), 409);
    const body = error.getResponse() as {
      error: string;
      details: { effective_status: string; stored_status: string };
    };
    assert.equal(body.error, SUBSCRIPTION_LAPSED_CODE);
    assert.equal(body.details.effective_status, SubscriptionStatus.EXPIRED);
    assert.equal(body.details.stored_status, SubscriptionStatus.ACTIVE);
  });
});
