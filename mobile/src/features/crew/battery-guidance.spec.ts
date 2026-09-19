import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_BATTERY_OPTIMISATION_SETTINGS,
  BATTERY_HONESTY_COPY_KEY,
  batteryGuidanceFor,
  shouldShowBatteryGuidance,
} from './battery-guidance.ts';
import { en } from '../../lib/i18n.en.ts';

/**
 * Battery / background-restriction guidance must stay honest: the app has no
 * supported API to *detect* a restriction, so it must never claim one — and it
 * must never promise uninterrupted GPS or suggest bypassing the OS.
 */

describe('batteryGuidanceFor', () => {
  it('never invents a detected restriction state', () => {
    for (const platform of ['android', 'ios', 'web', null, undefined]) {
      const guidance = batteryGuidanceFor(platform);
      assert.equal(guidance.detection, 'unsupported', String(platform));
      assert.equal(guidance.detected, null, String(platform));
    }
  });

  it('offers the supported settings route per platform', () => {
    const android = batteryGuidanceFor('android');
    assert.equal(android.settingsAction, 'battery-optimisation-intent');
    assert.equal(android.androidIntentAction, ANDROID_BATTERY_OPTIMISATION_SETTINGS);
    assert.match(android.androidIntentAction ?? '', /^android\.settings\./);

    const ios = batteryGuidanceFor('ios');
    assert.equal(ios.settingsAction, 'app-settings', 'Apple exposes no Low Power Mode deep link');
    assert.equal(ios.androidIntentAction, null);

    assert.equal(batteryGuidanceFor('web').settingsAction, 'none');
    assert.equal(batteryGuidanceFor('web').canRestrictBackgroundLocation, false);
  });

  it('only points at battery settings while background tracking is expected', () => {
    assert.equal(
      shouldShowBatteryGuidance({
        platform: 'android',
        backgroundActive: false,
        backgroundConsent: false,
      }),
      false,
      'foreground-only sharing dies with the screen either way — no noise',
    );
    assert.equal(
      shouldShowBatteryGuidance({
        platform: 'android',
        backgroundActive: true,
        backgroundConsent: true,
      }),
      true,
    );
    assert.equal(
      shouldShowBatteryGuidance({
        platform: 'ios',
        backgroundActive: false,
        backgroundConsent: true,
      }),
      true,
    );
  });

  it('renders copy that exists in the dictionary and admits the limitation', () => {
    const android = batteryGuidanceFor('android');
    for (const key of [android.copy.title, android.copy.body, android.copy.action]) {
      assert.ok(en[key], `missing translation for ${key}`);
    }
    assert.ok(en[BATTERY_HONESTY_COPY_KEY]);
    assert.match(en[BATTERY_HONESTY_COPY_KEY], /cannot read/i);
    assert.ok(
      !/uninterrupted|guarantee|always on/i.test(en[BATTERY_HONESTY_COPY_KEY]),
      'no promise of uninterrupted GPS',
    );
  });
});
