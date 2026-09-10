#!/usr/bin/env node
/**
 * Starts the Expo dev server with a QR code the **Expo Go** app can open.
 *
 * Why this wrapper exists (and why `expo start --go` on its own is not enough):
 *
 * This workspace installs `expo-dev-client` (it is the supported workflow for
 * remote push notifications — see docs/notifications.md). The Expo CLI reads
 * that as "the developer may want a custom runtime" and turns the QR code into
 * an *interstitial web page* instead of a deep link:
 *
 *     // @expo/cli → BundlerDevServer.isRedirectPageEnabled()
 *     return !env.EXPO_NO_REDIRECT_PAGE && !this.isDevClient &&
 *            !!resolveFrom.silent(projectRoot, 'expo-dev-client');
 *
 *     // @expo/cli → DevServerManagerActions.printDevServerInfoAsync()
 *     printQRCode(interstitialPageUrl ?? nativeRuntimeUrl);
 *
 * Note the middle condition: `--go` sets `isDevClient` to `false`, so with
 * `expo-dev-client` installed the redirect page stays ENABLED. `--go` therefore
 * never gets to decide what the QR encodes — the QR becomes
 *
 *     http://<lan-ip>:8081/_expo/loading
 *
 * instead of
 *
 *     exp://<lan-ip>:8081
 *
 * and the terminal says so:
 *
 *     › Choose an app to open your project at http://<lan-ip>:8081/_expo/loading
 *     › Metro: exp://<lan-ip>:8081
 *
 * That HTTP URL is what breaks the scan in the field:
 *   - scanned with the phone camera, it has to be loaded by the phone's browser,
 *     so a guest WiFi with AP isolation, a phone on mobile data, or a host
 *     firewall that blocks inbound 8081 turns it into "the link does not open";
 *   - scanned with Expo Go's own scanner, Expo Go is handed a web page rather
 *     than an `exp://` project URL and opens nothing.
 *
 * `EXPO_NO_REDIRECT_PAGE=1` is the only switch that turns the interstitial off
 * (the CLI exposes no flag for it), and it is read from `process.env`, so it
 * has to be set before the CLI boots. Setting it in a `.env` file does not
 * work here — `.env` is gitignored — and `EXPO_NO_REDIRECT_PAGE=1 npx expo …`
 * is not valid in Windows CMD/PowerShell. Hence this launcher: it sets the
 * variable, pins the Expo Go target, and execs the CLI with the current Node,
 * which behaves the same on macOS, Linux and Windows.
 *
 * The development-build workflow is untouched: `--dev-client` already disables
 * the interstitial on its own, so `npm run start:dev-client` bypasses this.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let expoCli;
try {
  // `expo/bin/cli` is a JS file with a shebang; running it through the current
  // Node keeps this working on Windows, where `.cmd` shims need a shell.
  expoCli = require.resolve('expo/bin/cli', { paths: [mobileRoot] });
} catch {
  console.error(
    '\n✖ Could not find the Expo CLI. Install dependencies from the repo root first:\n\n' +
      '    npm install\n',
  );
  process.exit(1);
}

const passthrough = process.argv.slice(2);

// `--go` and `--dev-client` are mutually exclusive in the CLI (it throws
// BAD_ARGS), so only pin `--go` when the caller did not ask for a dev build.
const wantsDevClient = passthrough.includes('--dev-client') || passthrough.includes('-d');
const args = wantsDevClient
  ? passthrough
  : ['--go', ...passthrough.filter((arg) => arg !== '--go' && arg !== '-g')];

const env = {
  ...process.env,
  // Kill the `_expo/loading` interstitial so the QR encodes `exp://…`. An
  // explicit value from the caller always wins.
  EXPO_NO_REDIRECT_PAGE: process.env.EXPO_NO_REDIRECT_PAGE ?? '1',
};

// Test/diagnostic hook: print what would be executed instead of running Metro.
// `mobile/scripts/expo-start.spec.ts` asserts against this.
if (process.env.EXPO_START_DRY_RUN === '1') {
  process.stdout.write(
    `${JSON.stringify({ entry: 'expo/bin/cli', command: ['start', ...args], env: { EXPO_NO_REDIRECT_PAGE: env.EXPO_NO_REDIRECT_PAGE } }, null, 2)}\n`,
  );
  process.exit(0);
}

const child = spawn(process.execPath, [expoCli, 'start', ...args], {
  cwd: mobileRoot,
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`\n✖ Failed to start the Expo dev server: ${error.message}\n`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
