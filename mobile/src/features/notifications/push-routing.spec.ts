import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import {
  isPushForUser,
  PUSH_EVENT_TYPES,
  readPushData,
  resolvePushRoute,
  shouldPresentForeground,
} from './push-routing.ts';

/**
 * Notification tap → screen, per role, and the "is this push for the account
 * signed in on this device" guard that keeps a handed-over phone from
 * showing or opening another user's alerts.
 */

const SCHOOL = 'school-1';
const parent = { id: 'p1', school_id: SCHOOL, role: UserRole.PARENT };
const driver = { id: 'd1', school_id: SCHOOL, role: UserRole.DRIVER };
const conductor = { id: 'c1', school_id: SCHOOL, role: UserRole.CONDUCTOR };
const admin = { id: 'a1', school_id: SCHOOL, role: UserRole.SCHOOL_ADMIN };

describe('readPushData', () => {
  it('reads the flat FCM data payload and ignores non-strings', () => {
    const data = readPushData({ type: 'STUDENT_BOARDED', trip_id: 't1', student_id: 42 });
    assert.equal(data.type, 'STUDENT_BOARDED');
    assert.equal(data.trip_id, 't1');
    assert.equal(data.student_id, undefined);
  });

  it('accepts the nested `body` shape and empty input', () => {
    assert.equal(readPushData({ body: { type: 'EMERGENCY_SOS' } }).type, 'EMERGENCY_SOS');
    assert.deepEqual(Object.values(readPushData(null)).filter(Boolean), []);
  });
});

describe('isPushForUser', () => {
  it('accepts a push addressed to the signed-in user', () => {
    assert.equal(isPushForUser({ user_id: 'p1', school_id: SCHOOL }, parent), true);
  });

  it('rejects a push for another user or tenant, or when signed out', () => {
    assert.equal(isPushForUser({ user_id: 'p2', school_id: SCHOOL }, parent), false);
    assert.equal(isPushForUser({ user_id: 'p1', school_id: 'other' }, parent), false);
    assert.equal(isPushForUser({ user_id: 'p1' }, null), false);
    assert.equal(shouldPresentForeground({ user_id: 'p2' }, parent), false);
  });
});

describe('resolvePushRoute', () => {
  it('parent: child events open live tracking of that child', () => {
    for (const type of [
      PUSH_EVENT_TYPES.studentBoarded,
      PUSH_EVENT_TYPES.studentDropped,
      PUSH_EVENT_TYPES.stopArrived,
      PUSH_EVENT_TYPES.tripInProgress,
    ]) {
      assert.equal(
        resolvePushRoute({ type, user_id: 'p1', student_id: 's1' }, parent),
        '/tracking?child=s1',
      );
    }
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.tripBoarding }, parent), '/tracking');
  });

  it('parent: completed / cancelled land in the notification inbox', () => {
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.tripCompleted }, parent), '/notifications');
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.tripCancelled }, parent), '/notifications');
  });

  it('crew: SOS updates open the emergency tab, everything else today’s trip', () => {
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.emergencyStatus }, driver), '/sos');
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.crewTripCancelled }, driver), '/trip');
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.crewTripCancelled }, conductor), '/trip');
  });

  it('school admin: SOS opens emergencies, trip events open the trip', () => {
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.emergencySos }, admin), '/emergencies');
    assert.equal(
      resolvePushRoute({ type: PUSH_EVENT_TYPES.tripCancelled, trip_id: 't1' }, admin),
      '/trips/t1',
    );
    assert.equal(resolvePushRoute({ type: 'UNKNOWN' }, admin), '/dashboard');
  });

  it('never routes a push meant for someone else', () => {
    assert.equal(
      resolvePushRoute({ type: PUSH_EVENT_TYPES.emergencySos, user_id: 'a9' }, admin),
      null,
    );
    assert.equal(resolvePushRoute({ type: PUSH_EVENT_TYPES.emergencySos }, null), null);
  });
});
