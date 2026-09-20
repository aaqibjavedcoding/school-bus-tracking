import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build-time behaviour of `app.config.js`: the missing-`google-services.json`
 * warning, and the MapLibre config plugin.
 *
 * The rule under test: a missing google-services.json is only news where a
 * **native Android project is actually being generated** (`expo prebuild` /
 * `expo run:android` without an iOS target, or an Android EAS build).
 * `expo start --go`, `expo export` and iOS runs must stay silent — in the
 * Expo Go case the app already says the honest thing at runtime (the
 * "needs a development build" map panel,
 * `src/features/map/map-surface-mode.ts`; the runtime diagnostics), so a
 * build-time warning would only scare.
 *
 * (There is deliberately no Maps-key warning any more: the map is MapLibre
 * over OpenFreeMap and needs no key at all — see `map-style.ts` and
 * `docs/live-tracking-map.md` → "Map provider policy".)
 *
 * Expo evaluates the config file more than once per command (and tooling
 * reloads clear the require cache between evaluations), so the driver below
 * re-requires `app.config.js` nine times with a cache clear in between and the
 * assertions require *exactly one* warning per missing fact — the proof that
 * `warnOnce` survives the cache clears via its environment marker. They also
 * require the MapLibre plugin to be present **exactly once** across those
 * evaluations, so a future edit cannot silently double-add it.
 */

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const FIREBASE_MARK = 'mobile/google-services.json is missing';
const MAPLIBRE_PLUGIN = '@maplibre/maplibre-react-native';

/** Evaluates app.config.js N times (cache-cleared) in a fresh process. */
const DRIVER = `
const path = require('node:path');
const configPath = path.join(__dirname, 'app.config.js');
const baseConfig = {
  name: 'School Bus Tracking',
  slug: 'school-bus-tracking',
  android: { package: 'com.schoolbustracking.app' },
  plugins: ['expo-router'],
};
let result;
for (let i = 0; i < 9; i += 1) {
  delete require.cache[require.resolve(configPath)];
  result = require(configPath)({ config: JSON.parse(JSON.stringify(baseConfig)) });
}
process.stdout.write('CONFIG_JSON:' + JSON.stringify({ android: result.android ?? null, plugins: result.plugins ?? null }) + '\\n');
`;

interface EvalResult {
  stdout: string;
  stderr: string;
  android: Record<string, unknown> | null;
  plugins: string[];
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
    assert.ok(line, 'the driver must print the resulting config');
    const parsed = JSON.parse(line.slice('CONFIG_JSON:'.length)) as {
      android: Record<string, unknown> | null;
      plugins: string[];
    };
    return { stdout, stderr, android: parsed.android, plugins: parsed.plugins };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('the MapLibre config plugin is wired (the map engine is part of the build)', () => {
  it('is added to the plugins array, exactly once, across nine cache-cleared evaluations', () => {
    for (const argv of [['start', '--go'], ['prebuild'], ['export', '--platform', 'android']]) {
      const result = evaluate(argv);
      assert.equal(
        result.plugins.filter((p) => p === MAPLIBRE_PLUGIN).length,
        1,
        `the plugin must be present exactly once for ${JSON.stringify(argv)}`,
      );
      // Pre-existing plugins survive the merge.
      assert.ok(result.plugins.includes('expo-router'), 'existing plugins are preserved');
    }
  });
});

describe('native Android builds see the missing google-services.json warning, exactly once', () => {
  it('prebuild warns once across nine cache-cleared evaluations', () => {
    const result = evaluate(['prebuild']);
    assert.equal(
      count(result.stderr, FIREBASE_MARK),
      1,
      'the warning must fire exactly once, not once per config evaluation',
    );
  });

  it('run:android is a native Android build', () => {
    const result = evaluate(['run:android']);
    assert.equal(count(result.stderr, FIREBASE_MARK), 1);
  });

  it('an Android EAS build warns; an unspecified-platform EAS build warns too', () => {
    const android = evaluate([], { EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'android' });
    assert.equal(count(android.stderr, FIREBASE_MARK), 1);
    const unspecified = evaluate([], { EAS_BUILD: 'true' });
    assert.equal(count(unspecified.stderr, FIREBASE_MARK), 1);
  });
});

describe('everything that does not generate the Android project stays silent', () => {
  it('expo start --go (Expo Go) prints no warnings', () => {
    const result = evaluate(['start', '--go']);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('expo export (a JS bundle, no native project) prints no warnings', () => {
    const result = evaluate(['export', '--platform', 'android']);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('an explicitly iOS-targeted prebuild prints no warnings (all spellings)', () => {
    for (const argv of [
      ['prebuild', '--platform', 'ios'],
      ['prebuild', '-p', 'ios'],
      ['prebuild', '--platform=ios'],
    ]) {
      const result = evaluate(argv);
      assert.equal(count(result.stderr, FIREBASE_MARK), 0, JSON.stringify(argv));
    }
  });

  it('an iOS EAS build prints no warnings', () => {
    const result = evaluate([], { EAS_BUILD: 'true', EAS_BUILD_PLATFORM: 'ios' });
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('command tokens are matched exactly, never as substrings', () => {
    const result = evaluate(['something-prebuild-looking']);
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });
});

describe('the injected fact still works (the gate only silences, never unwires)', () => {
  it('a present google-services.json is wired and not warned about', () => {
    const result = evaluate(
      ['prebuild'],
      {},
      { 'google-services.json': '{"project_id":"test-project"}' },
    );
    assert.equal(result.android?.googleServicesFile, './google-services.json');
    assert.equal(count(result.stderr, FIREBASE_MARK), 0);
  });

  it('a ANDROID_GOOGLE_SERVICES_FILE override pointing at a missing file is reported', () => {
    const result = evaluate(['prebuild'], { ANDROID_GOOGLE_SERVICES_FILE: 'does/not/exist.json' });
    assert.match(
      result.stderr,
      /ANDROID_GOOGLE_SERVICES_FILE points at a file that does not exist/,
    );
  });
});
