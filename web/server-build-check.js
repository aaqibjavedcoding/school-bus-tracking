/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Build-integrity check for the compiled server tree (`web/dist`).
 *
 * ## Why this exists
 *
 * The backend under `src/server` is compiled separately to CommonJS
 * (`npm run build:server`), and both the custom server and every App Router
 * route handler `require()` that output at runtime (see the `externals` rule
 * in `next.config.js`). Nothing else ever touches the `.ts` sources.
 *
 * That makes `web/dist` a *second build artefact* that can silently drift from
 * the sources: pulling a branch that adds a new module (for example the
 * dashboard-stats endpoint's `src/server/api/dashboard.ts`) and starting the
 * app **without** re-running `build:server` yields a `dist/` that still lacks
 * `api/dashboard.js`. The server boots normally — login works, the sidebar
 * renders — and then the first request into the missing module throws
 * `Cannot find module '…/dist/api/dashboard'` *inside the route handler*,
 * before the JSON error envelope is reached. Next answers with its generic
 * HTML/JSON 500 page, and the dashboard renders that raw payload in place of
 * the UI.
 *
 * This module turns that into either a self-healing dev start or a clear
 * startup error, exactly like the existing "detached Sequelize model" check.
 *
 * ## What it checks
 *
 * `dist` must contain a compiled `.js` for **every** non-spec `.ts` under
 * `src/server` (mirroring `tsconfig.build.json`), and — unless
 * `SKIP_SERVER_BUILD_CHECK=true` — no source may be newer than its output.
 * The workspace packages under `packages/*` must also have current generated
 * `dist/*.js` and `dist/*.d.ts` output before the web server is rebuilt,
 * because TypeScript resolves those packages through their published
 * `types`/`exports` entries.
 *
 * Plain CommonJS with no dependencies so `server.js` can require it before
 * anything from `dist` is loaded.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** Mirrors the `exclude` list of `tsconfig.build.json`. */
const EXCLUDED_RELATIVE_FILES = new Set(['http/route-testing.ts', 'http/test-server.ts']);

/** The workspace packages that must be built before the web server is compiled. */
const WORKSPACE_PACKAGES_DIR = 'packages';

/** Recursively lists `.ts` sources that `tsconfig.build.json` compiles. */
function listServerSources(serverSrc, dir = serverSrc, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listServerSources(serverSrc, full, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) {
      continue;
    }
    if (entry.name.endsWith('.spec.ts')) {
      continue;
    }
    const relative = toPosix(path.relative(serverSrc, full));
    if (EXCLUDED_RELATIVE_FILES.has(relative)) {
      continue;
    }
    out.push(relative);
  }
  return out;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/** Recursively lists TypeScript sources for one workspace package. */
function listPackageSources(packageSrc, dir = packageSrc, out = []) {
  if (!fs.existsSync(packageSrc)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listPackageSources(packageSrc, full, out);
      continue;
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
      continue;
    }
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.tsx')) {
      continue;
    }
    out.push(toPosix(path.relative(packageSrc, full)));
  }
  return out;
}

function readPackageName(packageDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    return typeof manifest.name === 'string' ? manifest.name : path.basename(packageDir);
  } catch {
    return path.basename(packageDir);
  }
}

function listWorkspacePackages(repoRoot) {
  const packagesDir = path.join(repoRoot, WORKSPACE_PACKAGES_DIR);
  if (!fs.existsSync(packagesDir)) {
    return [];
  }
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))
    .filter(
      (packageDir) =>
        fs.existsSync(path.join(packageDir, 'package.json')) &&
        fs.existsSync(path.join(packageDir, 'src')),
    )
    .sort()
    .map((packageDir) => ({ name: readPackageName(packageDir), dir: packageDir }));
}

function expectedPackageOutputs(packageDir, relativeSource) {
  const stem = relativeSource.replace(/\.tsx?$/, '');
  return [
    path.join(packageDir, 'dist', `${stem}.js`),
    path.join(packageDir, 'dist', `${stem}.d.ts`),
  ];
}

/**
 * Compares workspace package `dist` outputs against their sources.
 *
 * The web server compiler resolves packages such as
 * `@school-bus-tracking/shared-types` through each package's published
 * `types`/`exports` entry, i.e. `packages/<name>/dist/index.d.ts`. If that
 * generated declaration file is stale, `tsc -p web/tsconfig.build.json` reads
 * old shapes even when `packages/<name>/src` is correct. Catch that drift
 * before rebuilding the server tree.
 *
 * @returns {{ ok: boolean, missing: Array<{ packageName: string, source: string, output: string }>, stale: Array<{ packageName: string, source: string, output: string }>, reason: string | null }}
 */
function inspectWorkspacePackageBuilds({ repoRoot, checkFreshness = true }) {
  const missing = [];
  const stale = [];
  for (const workspacePackage of listWorkspacePackages(repoRoot)) {
    const packageSrc = path.join(workspacePackage.dir, 'src');
    for (const relative of listPackageSources(packageSrc)) {
      const source = path.join(packageSrc, relative);
      const sourceStat = fs.statSync(source);
      for (const output of expectedPackageOutputs(workspacePackage.dir, relative)) {
        const outputRelative = toPosix(path.relative(workspacePackage.dir, output));
        let outputStat;
        try {
          outputStat = fs.statSync(output);
        } catch {
          missing.push({
            packageName: workspacePackage.name,
            source: relative,
            output: outputRelative,
          });
          continue;
        }
        if (checkFreshness && sourceStat.mtimeMs > outputStat.mtimeMs + 1) {
          stale.push({
            packageName: workspacePackage.name,
            source: relative,
            output: outputRelative,
          });
        }
      }
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing, stale, reason: 'missing-package-outputs' };
  }
  if (stale.length > 0) {
    return { ok: false, missing, stale, reason: 'stale-package-outputs' };
  }
  return { ok: true, missing, stale, reason: null };
}

/**
 * Compares the compiled tree against the sources.
 *
 * @returns {{ ok: boolean, missing: string[], stale: string[], reason: string | null }}
 */
function inspectServerBuild({ serverSrc, serverDist, checkFreshness = true }) {
  if (!fs.existsSync(serverDist)) {
    return { ok: false, missing: [], stale: [], reason: 'dist-missing' };
  }

  const missing = [];
  const stale = [];
  for (const relative of listServerSources(serverSrc)) {
    const compiled = path.join(serverDist, relative.replace(/\.ts$/, '.js'));
    let compiledStat;
    try {
      compiledStat = fs.statSync(compiled);
    } catch {
      missing.push(relative);
      continue;
    }
    if (!checkFreshness) {
      continue;
    }
    const sourceStat = fs.statSync(path.join(serverSrc, relative));
    // A source edited after its output was written means the running code is
    // not the code in the repository. (A git checkout touches mtimes too, so
    // switching branches is caught as well.)
    if (sourceStat.mtimeMs > compiledStat.mtimeMs + 1) {
      stale.push(relative);
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing, stale, reason: 'missing-outputs' };
  }
  if (stale.length > 0) {
    return { ok: false, missing, stale, reason: 'stale-outputs' };
  }
  return { ok: true, missing, stale, reason: null };
}

function formatList(items, limit = 8) {
  const shown = items.slice(0, limit).map((item) => `  - src/server/${item}`);
  if (items.length > limit) {
    shown.push(`  … and ${items.length - limit} more`);
  }
  return shown.join('\n');
}

function formatPackageOutputList(items, limit = 8) {
  const shown = items
    .slice(0, limit)
    .map((item) => `  - ${item.packageName}: ${item.output} (from src/${item.source})`);
  if (items.length > limit) {
    shown.push(`  … and ${items.length - limit} more`);
  }
  return shown.join('\n');
}

function describeProblem(result) {
  switch (result.reason) {
    case 'dist-missing':
      return 'web/dist is missing.';
    case 'missing-outputs':
      return `web/dist is incomplete — ${result.missing.length} server module(s) have no compiled output:\n${formatList(result.missing)}`;
    case 'stale-outputs':
      return `web/dist is stale — ${result.stale.length} server source(s) are newer than their compiled output:\n${formatList(result.stale)}`;
    default:
      return 'web/dist failed the build-integrity check.';
  }
}

function describeWorkspacePackageProblem(result) {
  switch (result.reason) {
    case 'missing-package-outputs':
      return `Workspace package output is incomplete — ${result.missing.length} generated file(s) are missing:\n${formatPackageOutputList(result.missing)}`;
    case 'stale-package-outputs':
      return `Workspace package output is stale — ${result.stale.length} generated file(s) are older than their source:\n${formatPackageOutputList(result.stale)}`;
    default:
      return 'Workspace package output failed the build-integrity check.';
  }
}

function formatExitStatus(result) {
  if (result.status !== null && result.status !== undefined) {
    return `exit ${result.status}`;
  }
  return `signal ${result.signal ?? 'unknown'}`;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** Runs `npm run build:packages` synchronously in the repository root. */
function rebuildWorkspacePackages(repoRoot, log, runCommand = spawnSync) {
  log('Rebuilding workspace packages (npm run build:packages)…');
  const started = Date.now();
  const result = runCommand(npmCommand(), ['run', 'build:packages'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `Automatic workspace package rebuild failed (${formatExitStatus(
        result,
      )}). Fix the TypeScript errors above or run \`npm run build:packages\` manually.`,
    );
  }
  log(`Workspace packages rebuilt in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

/** Runs `tsc -p tsconfig.build.json` synchronously in `webDir`. */
function rebuildServer(webDir, log, runCommand = spawnSync) {
  log(`Rebuilding the server tree (tsc -p tsconfig.build.json)…`);
  const started = Date.now();
  const tscBin = path.join(webDir, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const localTsc = path.join(webDir, 'node_modules', 'typescript', 'bin', 'tsc');
  const bin = fs.existsSync(localTsc) ? localTsc : tscBin;
  const result = runCommand(process.execPath, [bin, '-p', 'tsconfig.build.json'], {
    cwd: webDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `Automatic server rebuild failed (${formatExitStatus(
        result,
      )}). Fix the TypeScript errors above or run \`npm run build:server\` manually.`,
    );
  }
  log(`Server tree rebuilt in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

function ensureWorkspacePackageBuilds({ repoRoot, dev, log, runCommand = spawnSync }) {
  // Freshness is only meaningful in local development checkouts. Production
  // images may copy source and dist with normalized mtimes, but missing package
  // output is still always a startup-time problem.
  const result = inspectWorkspacePackageBuilds({ repoRoot, checkFreshness: dev });
  if (result.ok) {
    return { ...result, rebuilt: false };
  }

  const problem = describeWorkspacePackageProblem(result);
  if (!dev) {
    throw new Error(
      `${problem}\nRun \`npm run build:packages\` (or \`npm run build\`) before starting the server. ` +
        'The web server compiler and runtime resolve workspace packages from their generated dist output.',
    );
  }

  log(problem);
  rebuildWorkspacePackages(repoRoot, log, runCommand);

  const verified = inspectWorkspacePackageBuilds({ repoRoot, checkFreshness: true });
  if (!verified.ok) {
    throw new Error(
      `${describeWorkspacePackageProblem(
        verified,
      )}\nThe rebuild did not produce the expected workspace package output; run \`npm run build:packages\` manually.`,
    );
  }
  return { ...verified, rebuilt: true };
}

/**
 * Guards the start-up of `server.js`.
 *
 * - `dev` (`NODE_ENV !== 'production'`): missing/incomplete/stale workspace
 *   package output is rebuilt first, then a missing/incomplete/stale `dist` is
 *   rebuilt in place, so `npm run dev` right after `git pull` just works.
 * - production: never compiles at runtime — throws with the list of missing
 *   or stale outputs and the command that fixes it.
 *
 * `SKIP_SERVER_BUILD_CHECK=true` disables the check entirely (containers that
 * copy `dist` with reset mtimes, or intentionally exotic setups).
 */
function ensureServerBuild({ webDir, dev, log, runCommand = spawnSync }) {
  if (process.env.SKIP_SERVER_BUILD_CHECK === 'true') {
    return { ok: true, missing: [], stale: [], reason: null, rebuilt: false };
  }

  const repoRoot = path.resolve(webDir, '..');
  ensureWorkspacePackageBuilds({ repoRoot, dev, log, runCommand });

  const serverSrc = path.join(webDir, 'src', 'server');
  const serverDist = path.join(webDir, 'dist');

  // Freshness (mtime) is only meaningful where the sources live next to the
  // build; production images routinely ship `dist` without matching mtimes.
  const result = inspectServerBuild({ serverSrc, serverDist, checkFreshness: dev });
  if (result.ok) {
    return { ...result, rebuilt: false };
  }

  const problem = describeProblem(result);

  if (!dev) {
    throw new Error(
      `${problem}\nRun \`npm run build:server\` (or \`npm run build\`) before starting the server. ` +
        'Serving a partial build makes affected API routes answer with a raw 500 page instead of JSON.',
    );
  }

  log(problem);
  rebuildServer(webDir, log, runCommand);

  const verified = inspectServerBuild({ serverSrc, serverDist, checkFreshness: true });
  if (!verified.ok) {
    throw new Error(
      `${describeProblem(verified)}\nThe rebuild did not produce the expected output; run \`npm run build:server\` manually.`,
    );
  }
  return { ...verified, rebuilt: true };
}

module.exports = {
  EXCLUDED_RELATIVE_FILES,
  listServerSources,
  listPackageSources,
  inspectWorkspacePackageBuilds,
  describeWorkspacePackageProblem,
  inspectServerBuild,
  describeProblem,
  ensureServerBuild,
};
