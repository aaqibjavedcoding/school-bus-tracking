import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole, type AuthenticatedUser } from '@school-bus-tracking/shared-types';
import { setupPushNotifications, unregisterPushDevice } from './push-notifications.ts';

/**
 * The base (non-native) push-notifications module is the fallback Metro serves
 * on non-native bundling and the one the plain-Node test runner loads. It must
 * stay free of any static `expo-notifications` import — importing
 * `expo-notifications` in Node (or, on device, evaluating it in Expo Go)
 * throws at module-evaluation time — so this suite doubles as a guard that the
 * fallback path can always be imported and always resolves to a safe no-op.
 */
const user: AuthenticatedUser = {
  id: 'u-1',
  school_id: 's-1',
  role: UserRole.PARENT,
  first_name: 'Ada',
  last_name: 'Parent',
  email: 'ada@school.edu',
};

describe('push-notifications (non-native fallback)', () => {
  it('resolves setup to a safe no-op for any authenticated user', async () => {
    await assert.doesNotReject(() => setupPushNotifications(user));
    await assert.doesNotReject(() => setupPushNotifications({ ...user, school_id: null }));
  });

  it('resolves unregister to a safe no-op', async () => {
    await assert.doesNotReject(() => unregisterPushDevice());
  });
});
