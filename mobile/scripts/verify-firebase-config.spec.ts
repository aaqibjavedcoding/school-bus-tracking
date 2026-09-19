import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Android Firebase native-build wiring.
 *
 * `mobile/google-services.json` sitting in the repository does nothing by
 * itself: Expo only copies it into the generated Android project when the config
 * names it through `android.googleServicesFile`. These assertions pin both
 * halves of the wiring plus the package identity, and they run the real checker
 * script so a regression fails here rather than as "no push arrived" on a
 * device.
 *
 * Nothing in this suite prints the file's contents — only existence, counts and
 * package names.
 */

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string): string => readFileSync(join(mobileRoot, relative), 'utf8');

interface Report {
  status: string;
  fatal: boolean;
  problems: string[];
  facts: {
    googleServicesPresent: boolean;
    googleServicesParses: boolean;
    declaredAndroidApps: number;
    appPackage: string | null;
    firebasePackages: string[];
    packageMatches: boolean | null;
    expoConfigWiresGoogleServicesFile: boolean;
  };
}

function runChecker(): { report: Report; exitCode: number } {
  try {
    const out = execFileSync(
      process.execPath,
      [join(mobileRoot, 'scripts', 'verify-firebase-config.mjs'), '--json'],
      { cwd: mobileRoot, encoding: 'utf8' },
    );
    return { report: JSON.parse(out) as Report, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    return {
      report: JSON.parse(failure.stdout ?? '{}') as Report,
      exitCode: failure.status ?? 1,
    };
  }
}

describe('android.googleServicesFile wiring', () => {
  it('the dynamic Expo config names the Firebase file', () => {
    const source = read('app.config.js');
    assert.match(
      source,
      /googleServicesFile/,
      'app.config.js must set android.googleServicesFile — otherwise prebuild never copies the file',
    );
    assert.match(source, /google-services\.json/, 'and it must point at google-services.json');
    assert.match(
      source,
      /existsSync/,
      'the wiring must tolerate a missing file (Expo Go / JS-only work) instead of throwing',
    );
  });

  it('keeps the Google Maps key wiring intact (no new paid dependency)', () => {
    const source = read('app.config.js');
    assert.match(source, /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY/);
    assert.match(source, /googleMaps/);
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    assert.ok(pkg.dependencies['react-native-maps'], 'maps stay on the existing library');
    assert.ok(
      !Object.keys(pkg.dependencies).some((name) => /firebase|fcm/i.test(name)),
      'the mobile app must not bundle a Firebase client SDK or the backend service account',
    );
  });

  it('never bundles a backend service-account credential into the app', () => {
    // The API's Firebase service account (`FIREBASE_SERVICE_ACCOUNT_JSON`) is a
    // server credential. The mobile config may *mention* it in a comment (it
    // does, to say where it belongs) but must never read it or ship it.
    const config = read('app.config.js');
    assert.ok(
      !/process\.env\.FIREBASE_SERVICE_ACCOUNT_JSON/.test(config),
      'the Expo config must not read the backend service account',
    );
    assert.ok(!/private_key|client_email/.test(config));
    const source = read('src/features/notifications/push-notifications.native.ts');
    assert.ok(!/service_account|private_key|client_email/i.test(source));
  });

  it('does not log the Firebase file contents', () => {
    const script = read('scripts/verify-firebase-config.mjs');
    assert.ok(
      !/console\.(log|warn|error)\([^)]*readFileSync/.test(script),
      'the checker must print facts, not the file',
    );
  });
});

describe('verify-firebase-config.mjs', () => {
  it('reports the real repository state as configured (or explains why not)', () => {
    const { report, exitCode } = runChecker();
    const appJson = JSON.parse(read('app.json')) as { expo: { android: { package: string } } };
    assert.equal(report.facts.appPackage, appJson.expo.android.package);
    assert.equal(report.facts.expoConfigWiresGoogleServicesFile, true);

    if (report.facts.googleServicesPresent) {
      assert.equal(report.facts.googleServicesParses, true);
      assert.equal(report.facts.packageMatches, true, 'Firebase package must match android.package');
      assert.ok(report.facts.firebasePackages.includes(appJson.expo.android.package));
      assert.equal(report.status, 'configured');
      assert.equal(exitCode, 0);
    } else {
      // A checkout without the (developer-supplied) file is not a build error,
      // but it must be reported as a configuration gap, not a delivery failure.
      assert.equal(report.status, 'missing-google-services');
      assert.equal(report.fatal, false);
      assert.equal(exitCode, 0);
      assert.match(report.problems.join(' '), /native Android build/i);
    }
  });

  it('flags a package mismatch as fatal in a temporary checkout', () => {
    // Runs the checker against a copy of the project whose google-services.json
    // declares a different package — the exact misconfiguration that builds
    // fine and then never receives a push.
    const tempRoot = mkdtempSync(join(tmpdir(), 'sbt-firebase-'));
    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true });
      copyFileSync(
        join(mobileRoot, 'scripts', 'verify-firebase-config.mjs'),
        join(tempRoot, 'scripts', 'verify-firebase-config.mjs'),
      );
      copyFileSync(join(mobileRoot, 'app.json'), join(tempRoot, 'app.json'));
      copyFileSync(join(mobileRoot, 'app.config.js'), join(tempRoot, 'app.config.js'));
      const appJson = JSON.parse(read('app.json')) as { expo: { android: { package: string } } };
      writeFileSync(
        join(tempRoot, 'google-services.json'),
        JSON.stringify({
          project_id: 'other-project',
          client: [
            {
              client_info: {
                android_client_info: { package_name: 'com.someone.elses.app' },
              },
            },
          ],
        }),
      );

      let stdout = '';
      let exitCode = 0;
      try {
        stdout = execFileSync(
          process.execPath,
          [join(tempRoot, 'scripts', 'verify-firebase-config.mjs'), '--json'],
          { cwd: tempRoot, encoding: 'utf8' },
        );
      } catch (error) {
        const failure = error as { stdout?: string; status?: number };
        stdout = failure.stdout ?? '';
        exitCode = failure.status ?? 1;
      }
      const report = JSON.parse(stdout) as Report;
      assert.equal(report.status, 'package-mismatch');
      assert.equal(report.fatal, true);
      assert.equal(exitCode, 1);
      assert.equal(report.facts.packageMatches, false);
      assert.ok(
        !stdout.includes('api_key'),
        'the report must not echo Firebase file contents',
      );
      assert.ok(appJson.expo.android.package.length > 0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('reports a missing file as a non-fatal configuration gap', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'sbt-firebase-empty-'));
    try {
      mkdirSync(join(tempRoot, 'scripts'), { recursive: true });
      copyFileSync(
        join(mobileRoot, 'scripts', 'verify-firebase-config.mjs'),
        join(tempRoot, 'scripts', 'verify-firebase-config.mjs'),
      );
      copyFileSync(join(mobileRoot, 'app.json'), join(tempRoot, 'app.json'));
      copyFileSync(join(mobileRoot, 'app.config.js'), join(tempRoot, 'app.config.js'));

      const stdout = execFileSync(
        process.execPath,
        [join(tempRoot, 'scripts', 'verify-firebase-config.mjs'), '--json'],
        { cwd: tempRoot, encoding: 'utf8' },
      );
      const report = JSON.parse(stdout) as Report;
      assert.equal(report.status, 'missing-google-services');
      assert.equal(report.fatal, false);
      assert.equal(report.facts.googleServicesPresent, false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('native manifest prerequisites for the foreground service', () => {
  it('declares the location foreground-service permissions app.json needs', () => {
    const appJson = JSON.parse(read('app.json')) as {
      expo: { android: { permissions: string[] }; plugins: unknown[] };
    };
    const permissions = appJson.expo.android.permissions;
    for (const required of [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ]) {
      assert.ok(permissions.includes(required), `${required} must stay declared`);
    }
    const plugins = JSON.stringify(appJson.expo.plugins);
    assert.match(plugins, /expo-location/, 'the location config plugin must stay wired');
    assert.match(plugins, /isAndroidBackgroundLocationEnabled/, 'background location stays enabled');
    assert.match(plugins, /expo-notifications/, 'the notifications plugin supplies POST_NOTIFICATIONS');
  });

  it('pins the Expo SDK line the native configuration was written against', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    assert.match(pkg.dependencies.expo, /^~?57\./, 'docs and config target Expo SDK 57');
    assert.match(pkg.dependencies['expo-location'], /^~?57\./);
    assert.match(pkg.dependencies['expo-notifications'], /^~?57\./);
  });
});
