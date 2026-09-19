/**
 * Dynamic Expo config — a thin layer over the pinned static `app.json`.
 *
 * It wires exactly two build-time facts that must not be committed:
 *
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY → android.config.googleMaps.apiKey
 *   google-services.json (or ANDROID_GOOGLE_SERVICES_FILE)
 *                                   → android.googleServicesFile
 *
 * ### Google Maps
 *
 * The Android Maps SDK requires the key as a manifest meta-data entry, not a
 * JS prop, and the APK always carries it in plaintext (that is simply how
 * Google Maps on Android works — "shipping inside the APK" is expected and
 * documented). Because of that the key must never be committed; it is read
 * here from `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` at prebuild/build time:
 * `.env` / shell env for local runs, or the EAS build profile `env` (or EAS
 * environment variables) for cloud builds. In Google Cloud the key should be
 * restricted to the "Maps SDK for Android" API plus this app's package and
 * signing-certificate SHA-1, so a copied key is useless elsewhere.
 *
 * When the variable is unset (e.g. Expo Go, where Maps runs on its own key),
 * no key is injected and `react-native-maps` keeps its default behaviour.
 *
 * ### Firebase (Android push) — required for a native build, not for Expo Go
 *
 * `mobile/google-services.json` existing in the repo does **nothing** on its
 * own: Expo only copies it into the generated Android project when the config
 * names it through `android.googleServicesFile`. Without that wiring the APK
 * has no `google-services.json`, `Default FirebaseApp` never initialises, and
 * `getDevicePushTokenAsync()` fails at runtime — which looks exactly like a
 * delivery problem but is a build configuration problem. This layer therefore
 * sets the field whenever the file is present (or `ANDROID_GOOGLE_SERVICES_FILE`
 * points somewhere else), and prints a **path-only** warning when it is not.
 *
 * Nothing here reads or logs the file's contents (it holds an app id and an
 * API key that identifies the Firebase project — not a secret credential, but
 * there is no reason to print it). The backend's Firebase *service account* is
 * a real credential and belongs to the API's environment only
 * (`FIREBASE_SERVICE_ACCOUNT_JSON`, see docs/notifications.md) — it is never
 * referenced from the mobile app and must never be bundled into it.
 *
 * `scripts/verify-firebase-config.mjs` (run by `preandroid` / `prebuild`)
 * additionally checks that the Firebase Android package matches
 * `android.package`, because a config downloaded for another package builds
 * fine and then silently fails to deliver.
 *
 * The stateless function receives the fully-merged static config from
 * `app.json` (every pinned value: name, slug, version, icons, permissions,
 * plugins, scheme, EAS project id, owner) and only adds these two facts —
 * nothing else is changed or redeclared.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo evaluates
   app.config.js as CommonJS, so `require` is the only option here. */
const { existsSync } = require('node:fs');
const { isAbsolute, join, relative } = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */

/** Resolves the Firebase config path without ever reading its contents. */
function resolveGoogleServicesFile() {
  const override = process.env.ANDROID_GOOGLE_SERVICES_FILE?.trim();
  if (override) {
    const absolute = isAbsolute(override) ? override : join(__dirname, override);
    if (existsSync(absolute)) {
      // Expo accepts a path relative to the project root.
      return relative(__dirname, absolute) || './google-services.json';
    }
    console.warn(
      `[app.config] ANDROID_GOOGLE_SERVICES_FILE points at a file that does not exist ` +
        `(${override}); Android push will not be configured in this build.`,
    );
    return null;
  }
  const local = join(__dirname, 'google-services.json');
  if (existsSync(local)) {
    return './google-services.json';
  }
  console.warn(
    '[app.config] mobile/google-services.json is missing, so android.googleServicesFile is not set. ' +
      'Expo Go and JS-only work are unaffected, but a native Android build made now cannot obtain an ' +
      'FCM token (push delivery will fail at runtime, not at build time). ' +
      'Download it from Firebase → Project settings → Your apps (package com.schoolbustracking.app). ' +
      'See docs/mobile-tracking-reliability.md.',
  );
  return null;
}

module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const googleServicesFile = resolveGoogleServicesFile();

  const android = { ...config.android };

  if (googleMapsApiKey) {
    android.config = {
      ...android.config,
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    };
  }

  if (googleServicesFile) {
    android.googleServicesFile = googleServicesFile;
  }

  if (!googleMapsApiKey && !googleServicesFile) {
    return config;
  }

  return {
    ...config,
    android,
  };
};
