#!/usr/bin/env node
/**
 * Launcher for the Expo dev server that guarantees the printed QR code is one
 * Expo Go can actually open.
 *
 * ## The bug this exists to prevent
 *
 * `expo start --go` is not enough. `--go` only sets the CLI's *target*; it does
 * not control what the QR code encodes. `@expo/cli` decides that separately, in
 * `DevServerManagerActions.printDevServerInfoAsync`:
 *
 *     const qr = printQRCode(interstitialPageUrl ?? nativeRuntimeUrl);
 *
 * `interstitialPageUrl` comes from `BundlerDevServer.getRedirectUrl()`, which is
 * non-null whenever `isRedirectPageEnabled()` is true:
 *
 *     return !env.EXPO_NO_REDIRECT_PAGE &&
 *       !this.isDevClient &&                                  // --go => true here
 *       !!resolveFrom.silent(this.projectRoot, 'expo-dev-client');
 *
 * This workspace depends on `expo-dev-client` (the supported workflow for push
 * notifications), so that last check passes and the redirect page turns ON —
 * *precisely because* we passed `--go` and `isDevClient` is false. The QR then
 * encodes the "choose an app" interstitial:
 *
 *     http://<lan-ip>:8081/_expo/loading        ← an HTML page, NOT a deep link
 *
 * Expo Go's scanner only opens `exp://` / `exp+…://` deep links. Handed an
 * `http://…/_expo/loading` URL it has nothing to launch, so the scan silently
 * does nothing — the exact "QR scan karne pe URL open nahi ho raha" symptom.
 * (The page is meant to be opened in a *phone browser*, where JavaScript then
 * redirects into a runtime. Scanning it with Expo Go is a dead end.)
 *
 * Setting `EXPO_NO_REDIRECT_PAGE=1` disables the interstitial, so the QR falls
 * back to `nativeRuntimeUrl` — `exp://<lan-ip>:8081`, which Expo Go opens.
 *
 * Verified against @expo/cli (Expo SDK 57):
 *   default:                   Choose an app to open your project at http://…/_expo/loading
 *   EXPO_NO_REDIRECT_PAGE=1:   (no interstitial line) Metro: exp://…:8081
 *
 * ## Why a Node script instead of an inline env var
 *
 * `EXPO_NO_REDIRECT_PAGE=1 expo start` is bash syntax; it fails in Windows CMD
 * and PowerShell, which contributors here use. Doing it in Node keeps one
 * command working on every platform without adding a `cross-env` dependency.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');

/**
 * Environment for the Expo CLI.
 *
 * `EXPO_NO_REDIRECT_PAGE` is only forced when the caller has not set it: an
 * explicit `EXPO_NO_REDIRECT_PAGE=0` stays honoured so the interstitial can
 * still be demoed/debugged on purpose.
 */
export function buildEnv(baseEnv = {}) {
  const env = { ...baseEnv };
  if (env.EXPO_NO_REDIRECT_PAGE === undefined || env.EXPO_NO_REDIRECT_PAGE === '') {
    env.EXPO_NO_REDIRECT_PAGE = '1';
  }
  return env;
}

/**
 * Arguments for `expo start`.
 *
 * `--go` is added unless the caller already picked a target (`--go`/`-g` or
 * `--dev-client`/`-d`), so `start:dev-client` can reuse this launcher without
 * being forced back onto Expo Go.
 */
export function buildArgs(userArgs = []) {
  const args = ['start', ...userArgs];
  const picksTarget = userArgs.some((arg) =>
    ['--go', '-g', '--dev-client', '-d'].includes(arg),
  );
  if (!picksTarget) args.splice(1, 0, '--go');
  return args;
}

/** True when the resolved args target a development build rather than Expo Go. */
export function targetsDevClient(args = []) {
  return args.some((arg) => arg === '--dev-client' || arg === '-d');
}

function main() {
  const userArgs = process.argv.slice(2);
  const args = buildArgs(userArgs);
  const env = buildEnv(process.env);

  if (!targetsDevClient(args)) {
    console.log(
      '\u2139 Expo Go mode: interstitial redirect page disabled so the QR code is an ' +
        'exp:// link Expo Go can open (see mobile/scripts/start-expo.mjs).\n',
    );
  }

  // Resolve the CLI the workspace actually installed rather than shelling out
  // to `npx`, which can go to the network and picks a different resolution.
  const require = createRequire(join(mobileRoot, 'package.json'));
  let cli;
  try {
    cli = require.resolve('expo/bin/cli');
  } catch {
    console.error(
      '\u2716 Could not resolve the Expo CLI (expo/bin/cli). Run "npm install" from the repo root.',
    );
    process.exit(1);
  }

  const child = spawn(process.execPath, [cli, ...args], {
    cwd: mobileRoot,
    stdio: 'inherit',
    env,
  });

  const forward = (signal) => () => child.kill(signal);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

// Only run when executed directly, so the helpers above stay unit-testable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
