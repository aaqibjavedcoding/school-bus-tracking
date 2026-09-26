/**
 * Dynamic Expo config — a thin layer over the pinned static `app.json`.
 *
 * It wires exactly two build-time facts that must not be committed:
 *
 *   the MapLibre React Native config plugin (adds the MapLibre Native SDK to
 *   the generated native projects — required for iOS, customisable on
 *   Android)
 *   google-services.json (or ANDROID_GOOGLE_SERVICES_FILE)
 *                                   → android.googleServicesFile
 *
 * ### Map tiles — no key, no account, no billing (the product rule)
 *
 * The map is `@maplibre/maplibre-react-native` (open source, new-architecture
 * only) over **OpenFreeMap**'s public OpenStreetMap tiles — see
 * `src/features/map/map-style.ts` and `docs/live-tracking-map.md` → "Map
 * provider policy". Nothing in this file injects a map key, because there is
 * no key to inject: OpenFreeMap's public instance needs no registration and
 * the style URL is an optional in-app variable (`EXPO_PUBLIC_MAP_STYLE_URL`,
 * https-only) — self-hosting tiles later changes ONE variable, no app code.
 *
 * The config plugin is added here (rather than in the static `app.json`) so
 * this file stays the single place that knows what the native build needs:
 * it is idempotent per evaluation — Expo evaluates this file several times
 * per command, and the base `plugins` array comes fresh from `app.json` each
 * time, so the guard below is only there to keep a double-add impossible.
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
 * points somewhere else), and prints a **path-only** warning when it is not —
 * for native Android builds only, for the same reason as above.
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
 * ### Why the warnings are gated and printed once
 *
 * Expo evaluates this file more than once per command (and a tooling reload
 * clears the require cache between evaluations), so every warning goes
 * through `warnOnce`: a module-level set **and** an environment marker, so
 * "warn exactly once" survives cache clears inside one process. And a missing
 * google-services.json is only news where a native Android project is actually
 * being generated (`isNativeAndroidBuild`) — printing it for `expo start --go`
 * would tell the driver push is broken when the app has already handled that
 * case itself (the runtime diagnostics say so).
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

/** The map engine's config plugin (adds the MapLibre Native SDK). */
const MAPLIBRE_PLUGIN = '@maplibre/maplibre-react-native';

/**
 * "Warn exactly once per process", surviving require-cache clears.
 *
 * Expo (and reloads of it) evaluate this file several times per command, and
 * a cache clear would reset a module-level flag alone — so the marker also
 * lives in `process.env`, which outlives the cache.
 */
const warnedOnce = new Set();
function warnOnce(key, message) {
  if (warnedOnce.has(key) || process.env[`SBT_APP_CONFIG_WARNED_${key}`]) {
    return;
  }
  warnedOnce.add(key);
  process.env[`SBT_APP_CONFIG_WARNED_${key}`] = '1';
  console.warn(message);
}

/**
 * Is this evaluation generating the **native Android** project?
 *
 * Only there can a missing google-services.json bite:
 *
 * - `expo prebuild` (any target, incl. `--platform android`) and
 *   `expo run:android` generate the project — unless explicitly iOS-targeted
 *   (`--platform ios`, `-p ios`, `--platform=ios`), in which case the Android
 *   project is not touched;
 * - EAS builds set `EAS_BUILD=true` and `EAS_BUILD_PLATFORM` on the build
 *   machine: an Android (or platform-unspecified) EAS build generates the
 *   project, an iOS one does not;
 * - everything else (`expo start --go`, `expo export`, an iOS run, plain JS
 *   tooling) never generates the Android project — a missing file cannot
 *   affect it, and the app's runtime already says the honest thing in the
 *   cases that matter (the runtime diagnostics).
 *
 * The command tokens are matched **exactly** (`process.argv` carries the CLI
 * invocation this file is evaluated under): substring matching would treat
 * `--prebuild-something` as a prebuild.
 */
function isNativeAndroidBuild(argv, env) {
  const tokens = Array.isArray(argv) ? argv : [];
  const buildsAndroidProject = tokens.includes('prebuild') || tokens.includes('run:android');
  if (buildsAndroidProject && !isIosTargeted(tokens)) {
    return true;
  }
  const easActive = env.EAS_BUILD === 'true' || env.EAS_BUILD === '1';
  return easActive && env.EAS_BUILD_PLATFORM !== 'ios';
}

/** An explicit iOS target (`--platform ios`, `-p ios`, `--platform=ios`). */
function isIosTargeted(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === '--platform' || tokens[i] === '-p') {
      if (tokens[i + 1] === 'ios') {
        return true;
      }
    } else if (tokens[i] === '--platform=ios') {
      return true;
    }
  }
  return false;
}

/** Resolves the Firebase config path without ever reading its contents. */
function resolveGoogleServicesFile(warn) {
  const override = process.env.ANDROID_GOOGLE_SERVICES_FILE?.trim();
  if (override) {
    const absolute = isAbsolute(override) ? override : join(__dirname, override);
    if (existsSync(absolute)) {
      // Expo accepts a path relative to the project root.
      return relative(__dirname, absolute) || './google-services.json';
    }
    if (warn) {
      warnOnce(
        'google-services-override-missing',
        `[app.config] ANDROID_GOOGLE_SERVICES_FILE points at a file that does not exist ` +
          `(${override}); Android push will not be configured in this build.`,
      );
    }
    return null;
  }
  const local = join(__dirname, 'google-services.json');
  if (existsSync(local)) {
    return './google-services.json';
  }
  if (warn) {
    warnOnce(
      'google-services-missing',
      '[app.config] mobile/google-services.json is missing, so android.googleServicesFile is not set. ' +
        'Expo Go and JS-only work are unaffected, but a native Android build made now cannot obtain an ' +
        'FCM token (push delivery will fail at runtime, not at build time). ' +
        'Download it from Firebase → Project settings → Your apps (package com.schoolbustracking.app). ' +
        'See docs/mobile-tracking-reliability.md.',
    );
  }
  return null;
}

/**
 * ### Map-app hand-off (PR 3) — manifest visibility, not a dependency
 *
 * Turn-by-turn is a **link**, not an SDK: `src/lib/navigation.ts` builds a
 * `maps/dir/?api=1…&dir_action=navigate` https URL, and on Android the free
 * `google.navigation:q=` intent. Two platform rules make those links openable
 * from a release build:
 *
 * - **Android 11+ package visibility**: `Linking.canOpenURL` / an implicit
 *   intent returns nothing unless the target is declared in `<queries>`, so
 *   the maps package and the navigation scheme are declared here;
 * - **iOS**: `LSApplicationQueriesSchemes` lists the schemes the app may probe.
 *   Only `https`/`maps` are listed — the vendor's app-specific `comgoogle…`
 *   URL scheme is deliberately absent (it is on the banned-pattern list
 *   enforced by `scripts/map-provider-policy.spec.ts`).
 *
 * These entries declare *which app may be opened*; they never contain a URL,
 * a key or an account. Nothing here costs anything.
 */
const MAP_APP_QUERY_SCHEMES_IOS = ['https', 'maps'];

const MAP_APP_QUERIES_ANDROID = [
  { package: 'com.google.android.apps.maps' },
  {
    intent: {
      action: 'android.intent.action.VIEW',
      data: { scheme: 'google.navigation' },
    },
  },
  {
    intent: {
      action: 'android.intent.action.VIEW',
      data: { scheme: 'geo' },
    },
  },
];

/** Adds a value to an array once (config is evaluated many times). */
function withUnique(list, values, isEqual) {
  const out = Array.isArray(list) ? [...list] : [];
  for (const value of values) {
    if (!out.some((existing) => isEqual(existing, value))) {
      out.push(value);
    }
  }
  return out;
}

module.exports = ({ config }) => {
  // This file is evaluated in the CLI's own process, so process.argv is the
  // command being run and the warnings can be aimed at the native Android
  // build (the only consumer of the missing-file warning) instead of at
  // everyone.
  const warn = isNativeAndroidBuild(process.argv, process.env);

  const googleServicesFile = resolveGoogleServicesFile(warn);

  const android = { ...config.android };

  // Android 11+ package visibility for the map-app hand-off (see above).
  android.queries = withUnique(
    android.queries,
    MAP_APP_QUERIES_ANDROID,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  );

  // iOS: the schemes the app is allowed to probe before opening a map link.
  const ios = { ...config.ios };
  ios.infoPlist = {
    ...(ios.infoPlist ?? {}),
    LSApplicationQueriesSchemes: withUnique(
      ios.infoPlist?.LSApplicationQueriesSchemes,
      MAP_APP_QUERY_SCHEMES_IOS,
      (a, b) => a === b,
    ),
  };

  if (googleServicesFile) {
    android.googleServicesFile = googleServicesFile;
  }

  // The MapLibre config plugin: one entry per evaluation (the base plugins
  // array is fresh from app.json each time; the guard is only there to keep a
  // double-add impossible).
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  if (!plugins.includes(MAPLIBRE_PLUGIN)) {
    plugins.push(MAPLIBRE_PLUGIN);
  }

  return {
    ...config,
    android,
    ios,
    plugins,
  };
};
