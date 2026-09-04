import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildDeviceTokenRequest,
  devicePushTokenValue,
  IOS_AUTHORIZATION_STATUS,
  isNotificationPermissionGranted,
  isPushSupported,
  mapDevicePlatform,
  PUSH_CHANNEL_ID,
  shouldRequestNotificationPermission,
} from './push-registration.ts';

/**
 * Pure push-registration facts: which platforms are supported, when the
 * permission prompt still needs to appear (Android 13+ POST_NOTIFICATIONS,
 * iOS granular statuses), and the exact request body the API contract
 * demands. The native layer only executes these decisions.
 */
describe('mapDevicePlatform / isPushSupported', () => {
  it('maps android and ios to the API platform values', () => {
    assert.equal(mapDevicePlatform('android'), 'android');
    assert.equal(mapDevicePlatform('ios'), 'ios');
  });

  it('rejects web and unknown platforms', () => {
    assert.equal(mapDevicePlatform('web'), null);
    assert.equal(mapDevicePlatform(undefined), null);
    assert.equal(isPushSupported('web'), false);
    assert.equal(isPushSupported(null), false);
  });

  it('supports exactly the platforms the backend can deliver to', () => {
    assert.equal(isPushSupported('android'), true);
    assert.equal(isPushSupported('ios'), true);
  });
});

describe('notification permission decisions', () => {
  it('treats a granted Android permission as granted', () => {
    assert.equal(isNotificationPermissionGranted({ granted: true, status: 'granted' }), true);
    assert.equal(shouldRequestNotificationPermission({ granted: true }), false);
  });

  it('treats iOS PROVISIONAL / EPHEMERAL as granted (numeric enum + string shape)', () => {
    assert.equal(
      isNotificationPermissionGranted({
        granted: false,
        ios: { status: IOS_AUTHORIZATION_STATUS.PROVISIONAL },
      }),
      true,
    );
    assert.equal(
      isNotificationPermissionGranted({
        granted: false,
        ios: { status: IOS_AUTHORIZATION_STATUS.EPHEMERAL },
      }),
      true,
    );
    assert.equal(
      isNotificationPermissionGranted({ granted: false, ios: { status: 'PROVISIONAL' } }),
      true,
    );
    assert.equal(
      shouldRequestNotificationPermission({
        granted: false,
        ios: { status: IOS_AUTHORIZATION_STATUS.PROVISIONAL },
      }),
      false,
    );
  });

  it('asks again only while undetermined', () => {
    assert.equal(
      shouldRequestNotificationPermission({ granted: false, status: 'undetermined' }),
      true,
    );
    assert.equal(
      shouldRequestNotificationPermission({
        granted: false,
        ios: { status: IOS_AUTHORIZATION_STATUS.NOT_DETERMINED },
      }),
      true,
    );
    assert.equal(shouldRequestNotificationPermission({ granted: false }), true);
  });

  it('never asks again after a denial', () => {
    assert.equal(shouldRequestNotificationPermission({ granted: false, status: 'denied' }), false);
    assert.equal(isNotificationPermissionGranted({ granted: false, status: 'denied' }), false);
  });
});

describe('device token request shape', () => {
  it('sends only the native token and the mapped platform', () => {
    const request = buildDeviceTokenRequest('  fcm-token-123  ', 'android');
    assert.deepEqual(request, { token: 'fcm-token-123', platform: 'android' });
  });

  it('extracts the token string from the device push token object', () => {
    assert.equal(devicePushTokenValue({ data: 'fcm-token' }), 'fcm-token');
    assert.equal(devicePushTokenValue({ data: '' }), null);
    assert.equal(devicePushTokenValue({ data: 42 }), null);
    assert.equal(devicePushTokenValue(null), null);
  });
});

describe('push channel contract', () => {
  it('pins the channel the API sends to', () => {
    assert.equal(PUSH_CHANNEL_ID, 'notifications');
  });
});
