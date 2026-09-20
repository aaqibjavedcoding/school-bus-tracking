import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build-time warnings for the two facts `app.config.js` injects (the Android
 * Maps key and `google-services.json`).
 *
 * The rule under test: a missing fact is only news where a **native Android
 * project is actually being generated** (`expo prebuild` / `expo run:android`
 * without an iOS target, or an Android EAS build). `expo start --go`,
 * `expo export` and iOS runs must stay silent — in the Expo Go case the app
 * already says the honest thing at runtime (the "needs a development build"
 * map panel, `src/features/map/map-surface-mode.ts`), so a build-time warning
 * would only scare.
 *
 * Expo evaluates the config file more than once per command (and tooling
 * reloads clear the require cache between evaluations), so the driver below
 * re-requires `app.config.js` nine times with a cache clear in between and
 * the assertions require *exactly one* warning per missing fact — the proof
 * that `warnOnce` survives the cache clears via its environment marker.
 */

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const MAPS_MARK = 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set';
const FIREBASE_MARK = 'mobile/google-services.json is missing';

/** Evaluates app.config.js N times (cache-cleared) in a fresh process. */
const DRIVER = `
const path = require('node:path');
const configPath = path.join(__dirname, 'app.config.js');
const baseConfig = {
  name: 'School Bus Tracking',
  slug: 'school-bus-tracking',
  android: { package: 'com.schoolbustracking.app' },
};
let result;
for (let i = 0; i < 9; i += 1) {
  delete require.cache[require.resolve(configPath)];
  result = require(configPath)({ config: JSON.parse(JSON.stringify(baseConfig)) });
}
process.stdout.write('CONFIG_JSON:' + JSON.stringify(result.android ?? null) + '\\n');
`;

interface EvalResult {
  stdout: string;
  stderr: string;
  android: Record<string, unknown> | null;
}

function count(haystack: string, needle: string): number {
  let total = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      return total;
    }
    total += 1;
    from = at + needle.length;
  }
}

function evaluate(
  argv: string[],
  envOverrides: Record<string, string> = {},
  extraFiles: Record<string, string> = {},
): EvalResult {
  const tempRoot = mkdtempSync(join(tmpdir(), 'sbt-appconfig-'));
  try {
    copyFileSync(join(mobileRoot, 'app.config.js'), join(tempRoot, 'app.config.js'));
    writeFileSync(join(tempRoot, 'driver.cjs'), DRIVER);
    for (const [name, contents] of Object.entries(extraFiles)) {
      writeFileSync(join(tempRoot, name), contents);
    }
    const env: Record<string, string | undefined> = {
      ...process.env,
      NODE_ENV: 'test',
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: undefined,
      ANDROID_GOOGLE_SERVICES_FILE: undefined,
      EAS_BUILD: undefined,
      EAS_BUILD_PLATFORM: undefined,
      ...envOverrides,
    };
    for (const key of Object.keys(env)) {
      if (env[key] === undefined) {
        delete env[key];
      }
    }
    const run = spawnSync(process.execPath, [join(tempRoot, 'driver.cjs'), ...argv], {
      cwd: tempRoot,
      env: env as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
    const stdout = run.stdout ?? '';
    const stderr = run.stderr ?? '';
    assert.equal(run.status, 0, `the config driver failed: ${stderr}`);
    const line = stdout.split('\n').find((l) => l.startsWith('CONFIG_JSON:'));
    assert.ok(line, 'the driver must print the resulting android config');
    return {
      stdout,
      stderr,
      android: JSON.parse(line.slice('CONFIG_JSON:'.length)) as Record<string, unknown> | null,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('native Android builds see the missing-fact warnings, exactly once', () => {
  it('prebuild warns once per missing fact across nine cache-cleared evaluations', () => {
    const result = evaluate(['prebuild']);
    assert.equal(
      count(result.stderr, MAPS_MARK),
      1,
      'the maps warning must fire exactly once, not once per config evaluation',
    );
    assert.equal(count(result.stderr, FIREBASE_MARK), 1);
    // The honest wording: the key is required for native builds and Expo Go
    // does not need it (it cannot show Google Maps at all since SDK 53).
    assert.match(result.stderr, /required for every native Android build/);
    assert.match(result.stderr, /Expo SDK 53/);
  });

  it('run:android is a native Android build', () => {
    const result = evaluate(['run:android']);
    assert.equal(count(result.stderr, MAPS_MARK), 1);
    assert.equal(count(result.stderr, FIREBASE_MARK), 1);
  });

  it('an Android EAS build warns; an unspecified-platform EAS build warns too', () => {
    const android = evaluate([], { EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'android' });
    assert.equal(count(android.stderr, MAPS_MARK), 1);
    const unspecified = evaluate([], { EAS_BUILD: 'true' });
    assert.equal(count(unspecified.stderr, MAPS_MARK), 1);
  });
});

describe('everything that does not generate the Android project stays silent', () => {
  it('expo start --go (Expo Go) prints no warnings', () => {
    const result = evaluate(['start', '--go']);
    assert.equal(count(result.stderr, MAPS_MARK), 0);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('expo export (a JS bundle, no native project) prints no warnings', () => {
    const result = evaluate(['export', '--platform', 'android']);
    assert.equal(count(result.stderr, MAPS_MARK), 0);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('an explicitly iOS-targeted prebuild prints no warnings (all spellings)', () => {
    for (const argv of [
      ['prebuild', '--platform', 'ios'],
      ['prebuild', '-p', 'ios'],
      ['prebuild', '--platform=ios'],
    ]) {
      const result = evaluate(argv);
      assert.equal(count(result.stderr, MAPS_MARK), 0, JSON.stringify(argv));
      assert.equal(count(result.stderr, FIREBASE_MARK), 0, JSON.stringify(argv));
    }
  });

  it('an iOS EAS build prints no warnings', () => {
    const result = evaluate([], { EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'ios' });
    assert.equal(count(result.stderr, MAPS_MARK), 0);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('command tokens are matched exactly, never as substrings', () => {
    const result = evaluate(['something-prebuild-looking']);
    assert.equal(count(result.stderr, MAPS_MARK), 0);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });
});

describe('the injected facts still work (the gate only silences, never unwires)', () => {
  it('a set maps key is injected into the android config and never printed', () => {
    const key = 'test-only-do-not-log-123';
    const result = evaluate(['prebuild'], { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: key });
    const android = result.android as {
      config?: { googleMaps?: { apiKey?: string } };
    };
    assert.equal(
      android.config?.googleMaps?.apiKey,
      key,
      'the key must still be wired into android.config.googleMaps.apiKey',
    );
    // The value is of course in the *returned config* (that is the point of
    // the injection, and the CONFIG_JSON line is the driver printing it back).
    // What is forbidden is the key in any log/warning output — and in stdout
    // anywhere other than the driver's own config echo.
    assert.ok(
      result.stdout
        .split('\n')
        .filter((l) => l.includes(key))
        .every((l) => l.startsWith('CONFIG_JSON:')),
      'the key may only appear in the driver’s config echo, never in any log line',
    );
    assert.ok(!result.stderr.includes(key), 'the key must never be logged');
    assert.equal(count(result.stderr, MAPS_MARK), 0);
    // The other missing fact is still reported — the warnings are independent.
    assert.equal(count(result.stderr, FIREBASE_MARK), 1);
  });

  it('a present google-services.json is wired and not warned about', () => {
    const result = evaluate(
      ['prebuild'],
      {},
      { 'google-services.json': '{"project_id":"test-project"}' },
    );
    assert.equal(result.android?.googleServicesFile, './google-services.json');
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
    assert.equal(count(result.stderr, MAPS_MARK), 1, 'the maps gap is still reported');
  });

  it('a ANDROID_GOOGLE_SERVICES_FILE override pointing at a missing file is reported', () => {
    const result = evaluate(['prebuild'], { ANDROID_GOOGLE_SERVICES_FILE: 'does/not/exist.json' });
    assert.match(
      result.stderr,
      /ANDROID_GOOGLE_SERVICES_FILE points at a file that does not exist/,
    );
    assert.equal(count(result.stderr, MAPS_MARK), 1);
  });
});
