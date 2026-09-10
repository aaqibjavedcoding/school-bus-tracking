#!/usr/bin/env node
/**
 * Guards the Expo SDK baseline this project is intentionally locked to.
 *
 * The mobile app, Expo Go and every `expo-*` / `react-native*` package have to
 * agree on one SDK major: Expo Go's app-store build only opens a project whose
 * `sdkVersion` matches its own, so a single package drifting to another SDK
 * line turns into "QR scans, Expo Go flashes and goes back" with no other
 * error. This script fails loudly — before Metro starts, before a build runs,
 * before a test suite passes — if:
 *   - the installed `expo` package is not on the pinned SDK line,
 *   - `mobile/package.json` stops requesting that SDK line,
 *   - any Expo / React Native dependency is not the version published for that
 *     SDK (checked offline against `expo/bundledNativeModules.json`, the same
 *     source of truth `npx expo install --check` uses), or
 *   - `expo-dev-client` (the dev-build workflow) is missing.
 *
 * Update PINNED_SDK_MAJOR only as a deliberate, reviewed decision to move the
 * whole app to a new Expo SDK — never as a side effect of `npm install` or an
 * automated dependency bump.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const monorepoRoot = join(mobileRoot, '..');

/** The one line to change when the team deliberately decides to upgrade. */
const PINNED_SDK_MAJOR = 57;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function majorFromRange(range) {
  const match = /(\d+)/.exec(range ?? '');
  return match ? Number(match[1]) : null;
}

function fail(message) {
  console.error('\n✖ Expo SDK guard failed\n');
  console.error(message);
  console.error(
    `\nThis project is deliberately locked to Expo SDK ${PINNED_SDK_MAJOR}. See ` +
      'docs/mobile-expo-sdk.md for the supported versions and workflow.\n',
  );
  process.exitCode = 1;
}

/**
 * Installed version of `packageName`, looked up the way Node/Metro would:
 * the mobile workspace first (npm nests React there), then the monorepo root.
 */
function installedVersion(packageName) {
  for (const root of [mobileRoot, monorepoRoot]) {
    try {
      return readJson(join(root, 'node_modules', packageName, 'package.json')).version;
    } catch {
      // not installed at this level — try the next one
    }
  }
  return null;
}

/** Parses `1.2.3` / `~1.2.3` / `^1.2.3` / `>=1.2.3` into its parts. */
function parseVersionSpec(spec) {
  const match = /^([~^>=<]*)\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(spec ?? '').trim());
  if (!match) return null;
  return {
    operator: match[1] || '=',
    major: Number(match[2]),
    minor: Number(match[3]),
    patch: Number(match[4]),
  };
}

/**
 * Whether `installed` is acceptable for the range Expo publishes for this SDK.
 *
 * This is the subset of semver ranges `bundledNativeModules.json` actually
 * uses, evaluated without pulling in a semver dependency:
 *   - exact (`1.27.2`)            → exact match
 *   - `~57.0.15`                  → same major + minor, patch >= published
 *   - `^15.0.2`                   → same major (same minor while major is 0)
 *   - `>=13.2.0`                  → at least that version
 */
function satisfies(installed, range) {
  const expected = parseVersionSpec(range);
  const actual = parseVersionSpec(installed);
  if (!expected || !actual) return false;

  const atLeast = [expected.major, expected.minor, expected.patch];
  const have = [actual.major, actual.minor, actual.patch];
  for (let i = 0; i < 3; i += 1) {
    if (have[i] > atLeast[i]) break;
    if (have[i] < atLeast[i]) return false;
  }

  switch (expected.operator) {
    case '=':
      return installed === range;
    case '~':
      return actual.major === expected.major && actual.minor === expected.minor;
    case '^':
      return expected.major === 0
        ? actual.major === 0 && actual.minor === expected.minor
        : actual.major === expected.major;
    case '>=':
      return true; // already checked by the "at least" loop above
    default:
      return true;
  }
}

const pkg = readJson(join(mobileRoot, 'package.json'));

// ---------------------------------------------------------------------------
// 1. `expo` itself is on the pinned SDK line — both requested and installed.
// ---------------------------------------------------------------------------
const declaredExpoRange = pkg.dependencies?.expo;
const declaredMajor = majorFromRange(declaredExpoRange);
if (declaredMajor !== PINNED_SDK_MAJOR) {
  fail(
    `mobile/package.json requests "expo": "${declaredExpoRange}", which is SDK ` +
      `${declaredMajor ?? 'unknown'}, not the pinned SDK ${PINNED_SDK_MAJOR}.`,
  );
}

const installedExpoVersion = installedVersion('expo');
if (installedExpoVersion) {
  const installedMajor = majorFromRange(installedExpoVersion);
  if (installedMajor !== PINNED_SDK_MAJOR) {
    fail(
      `The installed "expo" package is version ${installedExpoVersion} (SDK ` +
        `${installedMajor}), not the pinned SDK ${PINNED_SDK_MAJOR}. Run ` +
        `"npm install" from the repo root to restore the locked lockfile versions, ` +
        'or if this was a deliberate SDK upgrade, update PINNED_SDK_MAJOR in ' +
        '"mobile/scripts/verify-expo-sdk.mjs" together with docs/mobile-expo-sdk.md.',
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Every Expo / React Native dependency matches what this SDK ships.
//
//    Offline equivalent of `npx expo install --check`: Expo publishes the
//    exact versions each SDK is built against in
//    `expo/bundledNativeModules.json`, and that file ships inside the installed
//    `expo` package — no network needed.
// ---------------------------------------------------------------------------
if (installedExpoVersion) {
  let bundled = null;
  for (const root of [mobileRoot, monorepoRoot]) {
    const path = join(root, 'node_modules', 'expo', 'bundledNativeModules.json');
    if (existsSync(path)) {
      bundled = readJson(path);
      break;
    }
  }

  if (bundled) {
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const mismatches = [];
    for (const [name, range] of Object.entries(declared)) {
      const expected = bundled[name];
      if (!expected) continue; // not an Expo-managed package

      // The declared range is checked as well as the installed version: a
      // package.json that asks for another SDK's version is what a fresh
      // `npm install` turns into a broken tree, so it must fail here.
      if (!satisfies(range, expected)) {
        mismatches.push(`${name}@${range} → SDK ${PINNED_SDK_MAJOR} ships ${expected}`);
        continue;
      }

      const installed = installedVersion(name);
      if (installed === null) {
        mismatches.push(`${name}@${range} → not installed`);
      } else if (!satisfies(installed, expected)) {
        mismatches.push(`${name}@${range} → installed ${installed}, SDK ${PINNED_SDK_MAJOR} ships ${expected}`);
      }
    }
    if (mismatches.length > 0) {
      fail(
        'These mobile dependencies do not match the versions Expo publishes for SDK ' +
          `${PINNED_SDK_MAJOR}:\n  - ${mismatches.join('\n  - ')}\n\n` +
          'Run "npx expo install --fix" from mobile/ (or set the versions from ' +
          'docs/mobile-expo-sdk.md) and reinstall from the repo root.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. `@react-native/virtualized-lists` is published in lockstep with React
//    Native. It is not listed in bundledNativeModules.json, so it is pinned
//    here to whatever React Native this SDK runs on — a mismatch ships two
//    copies of the list internals into one bundle.
// ---------------------------------------------------------------------------
const installedReactNative = installedVersion('react-native');
const declaredVirtualizedLists = pkg.devDependencies?.['@react-native/virtualized-lists'];
if (installedReactNative && declaredVirtualizedLists && declaredVirtualizedLists !== installedReactNative) {
  fail(
    `"@react-native/virtualized-lists": "${declaredVirtualizedLists}" does not match the ` +
      `installed react-native ${installedReactNative}. Both must be the version ` +
      `Expo SDK ${PINNED_SDK_MAJOR} ships.`,
  );
}

// ---------------------------------------------------------------------------
// 4. The dev-build workflow is still available.
// ---------------------------------------------------------------------------
if (!pkg.dependencies?.['expo-dev-client']) {
  fail(
    'expo-dev-client is missing from mobile/package.json dependencies. It is the ' +
      'supported workflow for testing native modules and remote push ' +
      'notifications in a development build.',
  );
}

if (!process.exitCode) {
  console.log(
    `✔ Expo SDK guard: locked to SDK ${PINNED_SDK_MAJOR} ` +
      `(expo@${installedExpoVersion ?? declaredExpoRange}), dependencies aligned.`,
  );
}
