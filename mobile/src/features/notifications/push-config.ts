/**
 * Native push **configuration** diagnostics (pure — no native imports).
 *
 * "No notification arrived" has at least four completely different causes, and
 * they need different fixes:
 *
 * | state | what it means | fix |
 * | --- | --- | --- |
 * | `expo-go-skip` | Expo Go has no remote-push implementation (removed in SDK 53) — the app skips registration on purpose and must not crash | build a dev client (`npx expo run:android`) |
 * | `missing-native-config` | the installed APK has no Firebase app wired (`android.googleServicesFile` was not set when the native project was generated), so `Default FirebaseApp` never initialises | wire `app.config.js` and **rebuild the native app** |
 * | `package-mismatch` | `google-services.json` describes a different Android package than the build's `android.package` — FCM tokens would belong to another app | re-download the config for `com.schoolbustracking.app` |
 * | `permission-denied` / `token-unavailable` / `delivery-failed` | configuration is fine, this attempt failed at runtime | retry / check the server delivery row |
 *
 * Distinguishing configuration from delivery matters because a runtime failure
 * is retryable and a missing native config is not: no amount of retrying an
 * Expo Go session or a stale APK produces an FCM token.
 *
 * Nothing here reads or prints the contents of `google-services.json`; the
 * build-time checker (`scripts/verify-firebase-config.mjs`) reports only
 * booleans, counts and the package name.
 */

export type PushConfigurationState =
  | 'ready'
  | 'expo-go-skip'
  | 'platform-unsupported'
  | 'missing-native-config'
  | 'package-mismatch'
  | 'permission-denied'
  | 'token-unavailable'
  | 'delivery-failed';

export interface PushConfigurationInput {
  platform: string | null | undefined;
  isExpoGo: boolean;
  /**
   * Whether the installed native app was built with a Firebase config file.
   * `null` means "unknown at runtime" (the value is only knowable from the
   * build-time config), which is never reported as misconfigured.
   */
  googleServicesConfigured: boolean | null;
  /** Firebase Android package vs `android.package`; `null` when unknown. */
  packageMatches: boolean | null;
  permissionGranted?: boolean | null;
  tokenObtained?: boolean | null;
}

export interface PushConfigurationReport {
  state: PushConfigurationState;
  /** True when retrying in the same runtime could succeed. */
  retryable: boolean;
  /** True when a native rebuild is required before push can work. */
  needsNativeRebuild: boolean;
  /** Stable, non-secret one-line explanation for logs and the Help screen. */
  detail: string;
}

/**
 * Classifies the current push configuration.
 *
 * Order matters: an unsupported runtime is reported before configuration, so
 * Expo Go never shows "your Firebase config is missing" — the true statement
 * there is that remote push does not exist in Expo Go at all.
 */
export function describePushConfiguration(input: PushConfigurationInput): PushConfigurationReport {
  if (input.platform !== 'android' && input.platform !== 'ios') {
    return {
      state: 'platform-unsupported',
      retryable: false,
      needsNativeRebuild: false,
      detail: `Remote push is not supported on platform "${input.platform ?? 'unknown'}".`,
    };
  }

  if (input.isExpoGo) {
    return {
      state: 'expo-go-skip',
      retryable: false,
      needsNativeRebuild: true,
      detail:
        'Expo Go has no remote-push implementation (removed in Expo SDK 53); registration is skipped on purpose. ' +
        'Build a development client (npx expo run:android) to receive FCM messages.',
    };
  }

  if (input.packageMatches === false) {
    return {
      state: 'package-mismatch',
      retryable: false,
      needsNativeRebuild: true,
      detail:
        'google-services.json is registered for a different Android package than this build; FCM tokens would not match the app.',
    };
  }

  if (input.googleServicesConfigured === false && input.platform === 'android') {
    return {
      state: 'missing-native-config',
      retryable: false,
      needsNativeRebuild: true,
      detail:
        'This Android build has no google-services.json wired (android.googleServicesFile); the Firebase app never initialises, so no FCM token can be obtained.',
    };
  }

  if (input.permissionGranted === false) {
    return {
      state: 'permission-denied',
      retryable: true,
      needsNativeRebuild: false,
      detail: 'Notification permission is not granted on this device.',
    };
  }

  if (input.tokenObtained === false) {
    return {
      state: 'token-unavailable',
      retryable: true,
      needsNativeRebuild: false,
      detail:
        'No device push token could be obtained (Google Play services missing, or the Firebase app failed to initialise at runtime).',
    };
  }

  return {
    state: 'ready',
    retryable: true,
    needsNativeRebuild: false,
    detail: 'Push configuration is present; delivery depends on the server and the provider.',
  };
}

/**
 * Classifies a runtime failure into configuration vs delivery.
 *
 * The message text is matched because that is all the native module gives us;
 * the match is deliberately conservative — anything unrecognised stays a
 * retryable `delivery-failed` rather than being blamed on configuration.
 */
export function classifyPushFailure(error: unknown): PushConfigurationState {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();

  if (lower.includes('default firebaseapp is not initialized')) {
    return 'missing-native-config';
  }
  if (lower.includes('google api availability') || lower.includes('google play services')) {
    return 'token-unavailable';
  }
  if (lower.includes('unavailabilityerror') || lower.includes('is not available')) {
    return 'token-unavailable';
  }
  if (lower.includes('permission') && lower.includes('denied')) {
    return 'permission-denied';
  }
  return 'delivery-failed';
}

/**
 * Compares the Firebase Android package with the app's own package.
 *
 * Returns `null` when either side is unknown (never a silent `true`), so a
 * missing value cannot be reported as a match.
 */
export function googleServicesPackageMatches(
  firebasePackage: string | null | undefined,
  appPackage: string | null | undefined,
): boolean | null {
  if (!firebasePackage || !appPackage) {
    return null;
  }
  return firebasePackage === appPackage;
}
