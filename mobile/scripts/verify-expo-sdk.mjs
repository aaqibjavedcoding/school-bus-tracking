#!/usr/bin/env node
/**
 * Guards the SDK-54 baseline this project is intentionally locked to.
 *
 * Expo Go is a moving target — its store build tracks whatever the *latest*
 * SDK is, so it drifts out from under a stable app on its own schedule (see
 * `docs/mobile-expo-sdk.md`). The permanent fix is a development build
 * (`expo-dev-client`), which this project already uses; this script is the
 * second line of defense, catching the other way the mismatch comes back:
 * someone (or some tool) bumping the `expo` package itself.
 *
 * It fails loudly — before Metro starts, before a build runs, before a test
 * suite passes — if:
 *   - the installed `expo` package is not on the pinned SDK line, or
 *   - `mobile/package.json` stops requesting that SDK line, or
 *   - `expo-dev-client` (the store-update-proof dev workflow) is missing.
 *
 * Update PINNED_SDK_MAJOR only as a deliberate, reviewed decision to move the
 * whole app to a new Expo SDK — never as a side effect of `npm install` or an
 * automated dependency bump.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');

/** The one line to change when the team deliberately decides to upgrade. */
const PINNED_SDK_MAJOR = 54;

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
      'docs/mobile-expo-sdk.md for why, and for the supported development workflow ' +
      '(a development build via expo-dev-client — not the Expo Go app store build, ' +
      'which always tracks the newest SDK and will not match this project).\n',
  );
  process.exitCode = 1;
}

const pkg = readJson(join(mobileRoot, 'package.json'));

const declaredExpoRange = pkg.dependencies?.expo;
const declaredMajor = majorFromRange(declaredExpoRange);
if (declaredMajor !== PINNED_SDK_MAJOR) {
  fail(
    `mobile/package.json requests "expo": "${declaredExpoRange}", which is SDK ` +
      `${declaredMajor ?? 'unknown'}, not the pinned SDK ${PINNED_SDK_MAJOR}.`,
  );
}

let installedExpoVersion = null;
try {
  installedExpoVersion = readJson(join(mobileRoot, '..', 'node_modules', 'expo', 'package.json')).version;
} catch {
  try {
    installedExpoVersion = readJson(join(mobileRoot, 'node_modules', 'expo', 'package.json')).version;
  } catch {
    // expo not installed yet (e.g. this script ran before `npm install`
    // finished writing node_modules) — nothing to verify yet.
  }
}

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

if (!pkg.dependencies?.['expo-dev-client']) {
  fail(
    'expo-dev-client is missing from mobile/package.json dependencies. It is the ' +
      'supported development workflow for this SDK-54-locked project (Expo Go\'s app ' +
      'store build no longer matches SDK 54 and cannot be relied on).',
  );
}

if (!process.exitCode) {
  console.log(`✔ Expo SDK guard: locked to SDK ${PINNED_SDK_MAJOR} (expo@${installedExpoVersion ?? declaredExpoRange}).`);
}
