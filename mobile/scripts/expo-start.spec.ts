import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression test for "QR scan does not open the app".
 *
 * `expo-dev-client` is installed in this workspace, so the Expo CLI keeps the
 * `_expo/loading` interstitial enabled even for `expo start --go` and encodes
 * `http://<lan-ip>:8081/_expo/loading` into the QR instead of `exp://…`.
 * `scripts/expo-start.mjs` sets `EXPO_NO_REDIRECT_PAGE=1` before the CLI boots
 * to stop that. These assertions fail if a script stops going through the
 * launcher, or if the launcher stops pinning the Expo Go target / the env var.
 */

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = 'node scripts/expo-start.mjs';

const pkg = JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** Runs the launcher in dry-run mode and returns what it would have executed. */
function dryRun(...extraArgs: string[]) {
  const out = execFileSync(
    process.execPath,
    [join(mobileRoot, 'scripts', 'expo-start.mjs'), ...extraArgs],
    {
      cwd: mobileRoot,
      encoding: 'utf8',
      env: withoutRedirectOverride({ ...process.env, EXPO_START_DRY_RUN: '1' }),
    },
  );
  return JSON.parse(out) as {
    entry: string;
    command: string[];
    env: { EXPO_NO_REDIRECT_PAGE: string };
  };
}

/**
 * `execFileSync` stringifies every env value, so an inherited
 * `EXPO_NO_REDIRECT_PAGE` has to be removed rather than set to `undefined` —
 * otherwise the launcher would see the literal string "undefined".
 */
function withoutRedirectOverride(env: Record<string, string | undefined>) {
  const next = { ...env };
  delete next.EXPO_NO_REDIRECT_PAGE;
  return next as NodeJS.ProcessEnv;
}

describe('Expo Go QR target (mobile start scripts)', () => {
  it('routes every Expo Go script through the launcher', () => {
    for (const script of ['start', 'start:go', 'start:tunnel', 'android', 'ios']) {
      assert.ok(
        pkg.scripts[script]?.startsWith(LAUNCHER),
        `"${script}" must start with "${LAUNCHER}", got "${pkg.scripts[script]}"`,
      );
    }
  });

  it('keeps the SDK guard and the dev-build script as they were', () => {
    assert.equal(pkg.scripts.prestart, 'npm run verify:sdk');
    assert.equal(pkg.scripts.preandroid, 'npm run verify:sdk');
    assert.equal(pkg.scripts.preios, 'npm run verify:sdk');
    // `--dev-client` already disables the interstitial, so it needs no launcher.
    assert.equal(pkg.scripts['start:dev-client'], 'expo start --dev-client');
  });

  it('starts the Expo CLI with --go and the interstitial page disabled', () => {
    const plan = dryRun();
    assert.equal(plan.entry, 'expo/bin/cli');
    assert.equal(plan.command[0], 'start');
    assert.ok(plan.command.includes('--go'), `expected --go in ${plan.command.join(' ')}`);
    assert.equal(
      plan.env.EXPO_NO_REDIRECT_PAGE,
      '1',
      'without EXPO_NO_REDIRECT_PAGE=1 the QR encodes http://<host>:8081/_expo/loading, which Expo Go cannot open',
    );
  });

  it('never emits --go and --dev-client together (the CLI rejects that pair)', () => {
    const plan = dryRun('--dev-client');
    assert.ok(!plan.command.includes('--go'));
    assert.ok(plan.command.includes('--dev-client'));
  });

  it('passes extra flags through and does not duplicate --go', () => {
    const tunnel = dryRun('--tunnel', '--go');
    assert.deepEqual(
      tunnel.command.filter((arg) => arg === '--go').length,
      1,
      `--go appeared twice in ${tunnel.command.join(' ')}`,
    );
    assert.ok(tunnel.command.includes('--tunnel'));

    const clear = dryRun('-c', '--port', '8082');
    assert.ok(clear.command.includes('-c'));
    assert.deepEqual(clear.command.slice(-2), ['--port', '8082']);
  });

  it('lets an explicit EXPO_NO_REDIRECT_PAGE from the caller win', () => {
    const out = execFileSync(process.execPath, [join(mobileRoot, 'scripts', 'expo-start.mjs')], {
      cwd: mobileRoot,
      encoding: 'utf8',
      env: { ...process.env, EXPO_START_DRY_RUN: '1', EXPO_NO_REDIRECT_PAGE: '0' },
    });
    const plan = JSON.parse(out) as { env: { EXPO_NO_REDIRECT_PAGE: string } };
    assert.equal(plan.env.EXPO_NO_REDIRECT_PAGE, '0');
  });
});
