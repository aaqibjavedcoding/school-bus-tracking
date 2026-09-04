import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  SubscriptionStatus,
  type AdminSchoolSubscriptionResponse,
} from '@school-bus-tracking/shared-types';
import { adminSchoolSubscriptionCreateSchema } from '@school-bus-tracking/validation';
import { fieldErrorsFromZod } from '../../../lib/errors.ts';
import {
  billingPeriodSuffix,
  datetimeLocalToIso,
  EMPTY_ASSIGN_FORM,
  isLiveSubscriptionStatus,
  subscriptionStatusTone,
  subscriptionUiMode,
  toAssignSubscriptionRequest,
} from './helpers.ts';

/**
 * Behaviour of the Super Admin subscription console helpers (Task 42, step 2).
 *
 * Covers the full state matrix the section renders (none / trialing / active /
 * past due / cancelled / expired), the action wiring for each state
 * (assign / manage / resubscribe), and the request-building path of the
 * Assign/Resubscribe form — including the rule that `none` (the absence of a
 * record) may never be sent, and that the *shared* validation schema is what
 * produces the fast client-side feedback.
 */

function subscription(
  overrides: Partial<AdminSchoolSubscriptionResponse>,
): Pick<AdminSchoolSubscriptionResponse, 'status' | 'id'> {
  return { id: 'sub-1', status: SubscriptionStatus.ACTIVE, ...overrides };
}

describe('subscriptionUiMode — which actions the section offers', () => {
  it('offers Assign for a school without any subscription record', () => {
    assert.equal(
      subscriptionUiMode(subscription({ id: null, status: SubscriptionStatus.NONE })),
      'assign',
    );
  });

  it('offers Change/Cancel for every live subscription state', () => {
    assert.equal(subscriptionUiMode(subscription({ status: SubscriptionStatus.ACTIVE })), 'manage');
    assert.equal(
      subscriptionUiMode(subscription({ status: SubscriptionStatus.TRIALING })),
      'manage',
    );
    assert.equal(
      subscriptionUiMode(subscription({ status: SubscriptionStatus.PAST_DUE })),
      'manage',
    );
  });

  it('offers Resubscribe for a cancelled or expired historical subscription', () => {
    assert.equal(
      subscriptionUiMode(subscription({ status: SubscriptionStatus.CANCELLED })),
      'resubscribe',
    );
    assert.equal(
      subscriptionUiMode(subscription({ status: SubscriptionStatus.EXPIRED })),
      'resubscribe',
    );
  });
});

describe('status presentation', () => {
  it('distinguishes every lifecycle state with a tone', () => {
    assert.equal(subscriptionStatusTone(SubscriptionStatus.ACTIVE), 'success');
    assert.equal(subscriptionStatusTone(SubscriptionStatus.TRIALING), 'info');
    assert.equal(subscriptionStatusTone(SubscriptionStatus.PAST_DUE), 'warning');
    assert.equal(subscriptionStatusTone(SubscriptionStatus.CANCELLED), 'danger');
    assert.equal(subscriptionStatusTone(SubscriptionStatus.EXPIRED), 'neutral');
    assert.equal(subscriptionStatusTone(SubscriptionStatus.NONE), 'neutral');
  });

  it('marks exactly the trialing/active/past_due states as live', () => {
    assert.equal(isLiveSubscriptionStatus(SubscriptionStatus.TRIALING), true);
    assert.equal(isLiveSubscriptionStatus(SubscriptionStatus.ACTIVE), true);
    assert.equal(isLiveSubscriptionStatus(SubscriptionStatus.PAST_DUE), true);
    assert.equal(isLiveSubscriptionStatus(SubscriptionStatus.CANCELLED), false);
    assert.equal(isLiveSubscriptionStatus(SubscriptionStatus.EXPIRED), false);
    assert.equal(isLiveSubscriptionStatus(SubscriptionStatus.NONE), false);
  });

  it('reuses the plan billing wording of the Plans console', () => {
    assert.equal(billingPeriodSuffix('monthly'), '/ month');
    assert.equal(billingPeriodSuffix('yearly'), '/ year');
    assert.equal(billingPeriodSuffix(null), '');
  });
});

const PLAN_ID = '22222222-2222-4222-8222-222222222222';

describe('toAssignSubscriptionRequest — form → API body', () => {
  it('omits empty optional fields entirely (backend applies its defaults)', () => {
    const body = toAssignSubscriptionRequest({ ...EMPTY_ASSIGN_FORM, plan_id: PLAN_ID });
    assert.deepEqual(body, { plan_id: PLAN_ID, status: SubscriptionStatus.ACTIVE });
  });

  it('converts datetime-local values to ISO-8601', () => {
    const body = toAssignSubscriptionRequest({
      ...EMPTY_ASSIGN_FORM,
      plan_id: PLAN_ID,
      status: SubscriptionStatus.TRIALING,
      trial_end: '2026-09-15T10:30',
    });
    assert.equal(body.status, SubscriptionStatus.TRIALING);
    assert.equal(body.trial_end, new Date('2026-09-15T10:30').toISOString());
    assert.equal('trial_start' in body, false);
  });

  it('never sends `none` or any non-assignable status', () => {
    for (const status of [SubscriptionStatus.NONE, SubscriptionStatus.CANCELLED, 'bogus', '']) {
      const body = toAssignSubscriptionRequest({
        ...EMPTY_ASSIGN_FORM,
        plan_id: PLAN_ID,
        status: status as string,
      });
      assert.equal('status' in body, false, `status "${status}" must be dropped`);
    }
  });

  it('ignores invalid datetime input instead of sending garbage', () => {
    assert.equal(datetimeLocalToIso('not-a-date'), null);
    assert.equal(datetimeLocalToIso('   '), null);
  });
});

describe('assign-form validation uses the shared schema (fast feedback only)', () => {
  it('accepts a plain active assignment', () => {
    const body = toAssignSubscriptionRequest({ ...EMPTY_ASSIGN_FORM, plan_id: PLAN_ID });
    assert.equal(adminSchoolSubscriptionCreateSchema.safeParse(body).success, true);
  });

  it('rejects a trialing subscription without a trial end, keyed to the field', () => {
    const body = toAssignSubscriptionRequest({
      ...EMPTY_ASSIGN_FORM,
      plan_id: PLAN_ID,
      status: SubscriptionStatus.TRIALING,
    });
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse(body);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      assert.ok(errors.trial_end, 'trial_end must carry the message');
    }
  });

  it('rejects a trial window that ends before it starts', () => {
    const body = toAssignSubscriptionRequest({
      ...EMPTY_ASSIGN_FORM,
      plan_id: PLAN_ID,
      status: SubscriptionStatus.TRIALING,
      trial_start: '2026-09-20T00:00',
      trial_end: '2026-09-10T00:00',
    });
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse(body);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      assert.ok(errors.trial_end, 'trial_end ordering must be reported on the field');
    }
  });

  it('rejects a period that ends before it starts', () => {
    const body = toAssignSubscriptionRequest({
      ...EMPTY_ASSIGN_FORM,
      plan_id: PLAN_ID,
      current_period_start: '2026-10-01T00:00',
      current_period_end: '2026-09-01T00:00',
    });
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse(body);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      assert.ok(errors.current_period_end, 'period ordering must be reported on the field');
    }
  });

  it('rejects a missing/invalid plan id', () => {
    const body = toAssignSubscriptionRequest({ ...EMPTY_ASSIGN_FORM, plan_id: 'not-a-uuid' });
    const parsed = adminSchoolSubscriptionCreateSchema.safeParse(body);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      assert.ok(errors.plan_id, 'plan_id must carry the message');
    }
  });
});
