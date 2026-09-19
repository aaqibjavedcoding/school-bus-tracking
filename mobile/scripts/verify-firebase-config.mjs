#!/usr/bin/env node
/**
 * Build-time Firebase (Android push) configuration check.
 *
 * A native Android build silently loses push when either half of the wiring is
 * wrong, and the failure only shows up later as "no notification arrived":
 *
 * 1. `mobile/google-services.json` must exist **and** be named by the Expo
 *    config (`android.googleServicesFile`), otherwise prebuild never copies it
 *    into the generated Gradle project and `Default FirebaseApp` never
 *    initialises;
 * 2. the Android package inside that file must equal `android.package` in
 *    `app.json`, otherwise FCM registers a token for a different application id
 *    and the API's sends never match this app.
 *
 * The script prints **facts, never contents**: existence, a parse ok/failed
 * flag, how many client apps the file declares, and the package names being
 * compared. The Firebase API key and project numbers are not echoed, and the
 * backend's service-account credential is not read at all (it belongs to the
 * API's environment only — see docs/notifications.md).
 *
 * Exit codes:
 *   0 — configured, or missing in a way that only affects native push
 *       (Expo Go / JS work is unaffected); a warning is printed;
 *   1 — misconfigured: package mismatch, unreadable file, or an Expo config
 *       that stops wiring `android.googleServicesFile`.
 *
 * `--json` prints the machine-readable summary (used by
 * `scripts/verify-firebase-config.spec.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');

const asJson = process.argv.includes('--json');

/** Reads a JSON file, reporting failure without leaking the content. */
function readJsonSafe(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, value: null };
  }
}

/** Android package names declared by a google-services.json client list. */
function firebasePackages(config) {
  const clients = Array.isArray(config?.client) ? config.client : [];
  return clients
    .map((client) => client?.client_info?.android_client_info?.package_name)
    .filter((name) => typeof name === 'string' && name.length > 0);
}

function run() {
  const appJsonPath = join(mobileRoot, 'app.json');
  const servicesPath = join(mobileRoot, 'google-services.json');
  const appConfigPath = join(mobileRoot, 'app.config.js');

  const appJson = readJsonSafe(appJsonPath);
  const appPackage = appJson.ok ? (appJson.value?.expo?.android?.package ?? null) : null;

  const servicesExist = existsSync(servicesPath);
  const services = servicesExist ? readJsonSafe(servicesPath) : { ok: false, value: null };
  const packages = services.ok ? firebasePackages(services.value) : [];
  const packageMatches =
    servicesExist && services.ok && appPackage
      ? packages.includes(appPackage)
      : null;

  const appConfigSource = existsSync(appConfigPath) ? readFileSync(appConfigPath, 'utf8') : '';
  const configWiresGoogleServices = /android\.googleServicesFile|googleServicesFile/.test(
    appConfigSource,
  );
  const appJsonWiresIt = Boolean(appJson.ok && appJson.value?.expo?.android?.googleServicesFile);

  let status = 'configured';
  const problems = [];

  if (!appJson.ok) {
    status = 'unreadable-app-config';
    problems.push('mobile/app.json could not be parsed.');
  } else if (!servicesExist) {
    status = 'missing-google-services';
    problems.push(
      'mobile/google-services.json is missing. Expo Go and JS-only work are unaffected, but a native ' +
        'Android build made now cannot obtain an FCM token — that is a build configuration gap, not a ' +
        'delivery failure.',
    );
  } else if (!services.ok) {
    status = 'unreadable-google-services';
    problems.push('mobile/google-services.json exists but is not valid JSON.');
  } else if (!configWiresGoogleServices && !appJsonWiresIt) {
    status = 'not-wired';
    problems.push(
      'Neither app.json nor app.config.js sets android.googleServicesFile, so prebuild does not copy ' +
        'google-services.json into the Android project and Firebase never initialises.',
    );
  } else if (packageMatches === false) {
    status = 'package-mismatch';
    problems.push(
      `google-services.json declares ${packages.join(', ')} but this app builds as ${appPackage}. ` +
        'FCM tokens would belong to a different application id.',
    );
  } else if (packageMatches === null) {
    status = 'package-unknown';
    problems.push(
      'Could not determine the Android package on one side of the comparison (app.json or ' +
        'google-services.json); refusing to report a match.',
    );
  }

  const fatal =
    status === 'unreadable-app-config' ||
    status === 'unreadable-google-services' ||
    status === 'not-wired' ||
    status === 'package-mismatch' ||
    status === 'package-unknown';

  return {
    status,
    fatal,
    problems,
    facts: {
      googleServicesPresent: servicesExist,
      googleServicesParses: services.ok,
      declaredAndroidApps: packages.length,
      appPackage,
      firebasePackages: packages,
      packageMatches,
      expoConfigWiresGoogleServicesFile: configWiresGoogleServices || appJsonWiresIt,
    },
  };
}

const report = run();

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (report.fatal) {
  console.error('\n✖ Firebase Android configuration check failed\n');
  for (const problem of report.problems) {
    console.error(`  • ${problem}`);
  }
  console.error(
    `\n  status: ${report.status} · app package: ${report.facts.appPackage ?? 'unknown'} · ` +
      `declared Firebase apps: ${report.facts.declaredAndroidApps}\n` +
      '  See docs/mobile-tracking-reliability.md → "Android Firebase native-build wiring".\n',
  );
} else if (report.problems.length > 0) {
  console.warn('\n⚠ Firebase Android configuration is incomplete (not fatal)\n');
  for (const problem of report.problems) {
    console.warn(`  • ${problem}`);
  }
  console.warn('');
} else {
  console.log(
    `✓ Firebase Android configuration OK (package ${report.facts.appPackage}, ` +
      `${report.facts.declaredAndroidApps} declared app, wired through ` +
      `${report.facts.expoConfigWiresGoogleServicesFile ? 'the Expo config' : 'app.json'}).`,
  );
}

if (report.fatal) {
  process.exitCode = 1;
}
