/**
 * Honest battery / background-restriction guidance (pure — no native imports).
 *
 * What this module does **not** do, and why: it never reports a *detected*
 * restriction state. Expo SDK 57 exposes no supported API to read Android's
 * "battery optimisation" / "restricted" app-standby bucket, OEM power savers
 * (MIUI, One UI, ColorOS…) or iOS Low Power Mode from JS. Inventing a status
 * would tell a driver their phone is fine when it is about to kill the
 * foreground service, which is worse than saying "we cannot read this".
 *
 * So the contract is explicit:
 *
 * - `detection` is always `'unsupported'` and `detected` is always `null`;
 * - the guidance text tells the crew member which OS setting to check, in
 *   their language, and why it matters for a bus run;
 * - `settingsAction` names the *supported* way to get there: on Android an
 *   explicit intent to the battery-optimisation list (`Linking.sendIntent`),
 *   falling back to the app's own settings page; on iOS the app settings page
 *   (Apple exposes no deep link into Low Power Mode, and nothing here claims
 *   otherwise);
 * - nothing bypasses a restriction the user or the OS set, and no copy promises
 *   uninterrupted GPS.
 */

/** How the OS restriction state was obtained. Only one value is honest today. */
export type RestrictionDetection = 'unsupported';

/** Where the settings button can take the user, per platform. */
export type BatterySettingsAction = 'battery-optimisation-intent' | 'app-settings' | 'none';

export interface BatteryGuidance {
  platform: 'android' | 'ios' | 'other';
  detection: RestrictionDetection;
  /** Always `null`: no supported API reports the real state (see module docs). */
  detected: boolean | null;
  /** Translation keys the UI renders (title / body / action label). */
  copy: {
    title: 'gps.battery.android.title' | 'gps.battery.ios.title' | 'gps.battery.other.title';
    body: 'gps.battery.android.body' | 'gps.battery.ios.body' | 'gps.battery.other.body';
    action: 'gps.battery.openBatterySettings' | 'gps.battery.openAppSettings';
  };
  settingsAction: BatterySettingsAction;
  /**
   * Android intent that opens the system battery-optimisation list. Opening the
   * list is navigation, not a bypass: the user still decides, and the OS still
   * enforces whatever they choose.
   */
  androidIntentAction: string | null;
  /** True when a background/foreground-service restriction can stop GPS. */
  canRestrictBackgroundLocation: boolean;
}

/** Android system settings action listing per-app battery optimisation. */
export const ANDROID_BATTERY_OPTIMISATION_SETTINGS =
  'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS';

/**
 * The guidance for one platform.
 *
 * Deterministic and side-effect free so the copy, the available action and the
 * (absent) detection can all be unit-tested without a device.
 */
export function batteryGuidanceFor(platform: string | null | undefined): BatteryGuidance {
  if (platform === 'android') {
    return {
      platform: 'android',
      detection: 'unsupported',
      detected: null,
      copy: {
        title: 'gps.battery.android.title',
        body: 'gps.battery.android.body',
        action: 'gps.battery.openBatterySettings',
      },
      settingsAction: 'battery-optimisation-intent',
      androidIntentAction: ANDROID_BATTERY_OPTIMISATION_SETTINGS,
      canRestrictBackgroundLocation: true,
    };
  }
  if (platform === 'ios') {
    return {
      platform: 'ios',
      detection: 'unsupported',
      detected: null,
      copy: {
        title: 'gps.battery.ios.title',
        body: 'gps.battery.ios.body',
        action: 'gps.battery.openAppSettings',
      },
      // Apple exposes no deep link to Low Power Mode / Background App Refresh
      // for another app's page; the app's own settings page is the honest route.
      settingsAction: 'app-settings',
      androidIntentAction: null,
      canRestrictBackgroundLocation: true,
    };
  }
  return {
    platform: 'other',
    detection: 'unsupported',
    detected: null,
    copy: {
      title: 'gps.battery.other.title',
      body: 'gps.battery.other.body',
      action: 'gps.battery.openAppSettings',
    },
    settingsAction: 'none',
    androidIntentAction: null,
    canRestrictBackgroundLocation: false,
  };
}

/**
 * The one sentence that must always accompany this guidance: what the app can
 * and cannot promise. Kept as a key so it is translated like everything else.
 */
export const BATTERY_HONESTY_COPY_KEY = 'gps.battery.honesty' as const;

/**
 * Whether the crew member should be told to check battery settings at all.
 *
 * Only worth their attention while background tracking is expected to run: a
 * foreground-only session dies with the screen either way, and nagging about
 * settings that cannot help is noise.
 */
export function shouldShowBatteryGuidance(input: {
  platform: string | null | undefined;
  backgroundActive: boolean;
  backgroundConsent: boolean;
}): boolean {
  const guidance = batteryGuidanceFor(input.platform);
  return guidance.canRestrictBackgroundLocation && (input.backgroundActive || input.backgroundConsent);
}
