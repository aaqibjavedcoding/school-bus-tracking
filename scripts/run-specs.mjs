#!/usr/bin/env node
/**
 * The spec runner — find the test files, then run them.
 *
 * ## Why this exists
 *
 * `web/package.json` and `mobile/package.json` used to list every spec file by
 * name inside the `test` scripts: 183 paths in `test:server`, 46 in `test:web`,
 * 114 in mobile's `test`. Three things were wrong with that:
 *
 * 1. **A new spec was invisible until someone remembered the list.** Adding a
 *    module meant editing a 189-token shell line, and forgetting it meant the
 *    spec silently never ran. `mobile/src/features/crew/arrived-stop-announcer.spec.ts`
 *    was exactly that: on disk, green locally, never executed by CI.
 * 2. **A missing space silently dropped two specs.** The `test:web` line
 *    contained `src/lib/nav-routes.spec.tssrc/features/admin/subscriptions/helpers.spec.ts`
 *    — two paths glued into one nonexistent path. Node's runner skipped it
 *    without complaining.
 * 3. **There was no way to run a slice.** Touching one map module meant running
 *    all 343 specs, so an agent session doing a two-file change spent its whole
 *    budget on unrelated tests — and timed out.
 * 4. **Scoped runs missed whole-codebase guards.** The road-routing backend was
 *    green under its feature filter, then failed CI because adding the
 *    RouteGeometry model tripped the model-count checkpoint in
 *    `database/marketing-models.spec.ts`. Guards mode keeps registry, policy,
 *    migration, security and i18n invariants in every pre-push test pass.
 *
 * Discovery by convention fixes all four: a `*.spec.ts` under the right
 * directory **is** a test, no registration step. And because discovery is a
 * list we control, the same script can narrow it — by substring, by what git
 * says changed, or to the whole-codebase guards that a feature slice cannot
 * see.
 *
 * ## What is deliberately NOT discovered
 *
 * - `*.sim.spec.ts` — simulation specs need their own node flags and module
 *   loaders (`--experimental-test-module-mocks`, the native-stubs loader), so
 *   they keep their dedicated scripts.
 * - `web/test/integration/**` and `web/test/e2e/**` — these need a live
 *   Postgres and run via `test:integration` / `test:e2e`.
 *
 * ## Usage
 *
 *   node scripts/run-specs.mjs <suite> [options]
 *
 *   suite: web-server | web-client | web | mobile | all | guards
 *
 *   --filter <text>   only specs whose path contains <text> (repeatable)
 *   --changed         only specs related to files changed vs the merge base
 *   --guards          only whole-codebase invariant specs for the selected suite(s)
 *   --base <ref>      base ref for --changed (default: origin/main, then main)
 *   --list            print the files that would run, run nothing
 *   --isolation=none  run a suite in a single process (faster, less isolated)
 *
 * Examples:
 *
 *   node scripts/run-specs.mjs web-server --filter routing
 *   node scripts/run-specs.mjs mobile --filter map --filter crew
 *   node scripts/run-specs.mjs all --changed
 *   node scripts/run-specs.mjs guards
 *   node scripts/run-specs.mjs web --guards
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories we never walk into. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.expo',
  'dist',
  'build',
  'coverage',
  '.git',
  '.turbo',
]);

/** A spec file we never auto-run (it has its own script). */
function isExcludedSpec(relPath) {
  return relPath.includes('.sim.spec.');
}

/**
 * The suites.
 *
 * `cwd`      — where the node process runs (so relative spec paths resolve).
 * `roots`    — directories walked for specs, relative to `cwd`.
 * `exclude`  — extra path fragments to drop.
 * `command`  — argv (minus the file list) and the env the runtime needs.
 */
const SUITES = {
  'web-server': {
    cwd: 'web',
    roots: ['src/server'],
    exclude: [],
    env: { TS_NODE_PROJECT: 'tsconfig.server.json' },
    nodeArgs: ['-r', 'ts-node/register/transpile-only', '--test'],
  },
  'web-client': {
    cwd: 'web',
    roots: ['src', 'scripts'],
    // src/server belongs to the other suite; test/ needs a database.
    exclude: [`src${sep}server${sep}`, `test${sep}`],
    env: {},
    nodeArgs: ['--experimental-strip-types', '--test'],
  },
  mobile: {
    cwd: 'mobile',
    roots: ['src', 'scripts'],
    exclude: [],
    env: {},
    nodeArgs: ['--experimental-strip-types', '--test', '--test-timeout=60000'],
  },
};

/**
 * Specs that protect whole-codebase invariants and therefore cannot be inferred
 * from a feature-scoped filter. Fragments are relative to each suite's cwd.
 */
export const GUARD_FRAGMENTS = {
  'web-server': [
    'database/marketing-models.spec',
    'database/database.module.spec',
    'database/base-model-timestamp-columns.spec',
    'migrations.spec',
    'http/route-runtime-idempotency.spec',
    'common/security/',
  ],
  'web-client': ['map-provider-policy.spec', 'list-refresh-policy.spec', 'nav-routes.spec'],
  mobile: [
    'map-provider-policy.spec',
    'i18n-parity.spec',
    'i18n-literals.spec',
    'i18n-clipping.spec',
    'maplibre-runtime.spec',
    'app-config-warnings.spec',
  ],
};

/** Suite names that expand to several suites. */
const GROUPS = {
  web: ['web-server', 'web-client'],
  all: ['web-server', 'web-client', 'mobile'],
  guards: ['web-server', 'web-client', 'mobile'],
};

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (/\.spec\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Every spec a suite owns, as paths relative to the suite's cwd, sorted. */
export function discoverSpecs(suiteName) {
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Unknown suite: ${suiteName}`);
  const suiteRoot = join(repoRoot, suite.cwd);
  const found = [];
  for (const root of suite.roots) walk(join(suiteRoot, root), found);

  const seen = new Set();
  const specs = [];
  for (const absolute of found) {
    const relPath = relative(suiteRoot, absolute);
    if (isExcludedSpec(relPath)) continue;
    if (suite.exclude.some((fragment) => relPath.includes(fragment))) continue;
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    specs.push(relPath);
  }
  return specs.sort();
}

/** Files changed against the base ref, repo-relative. Empty list on failure. */
function changedFiles(baseRef) {
  const candidates = baseRef ? [baseRef] : ['origin/main', 'main'];
  for (const ref of candidates) {
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', ref], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (mergeBase.status !== 0) continue;
    const base = mergeBase.stdout.trim();
    const diff = spawnSync('git', ['diff', '--name-only', base, '--'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (diff.status !== 0) continue;
    return [...diff.stdout.split('\n'), ...untracked.stdout.split('\n')]
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * The specs a changed file implicates:
 *   - the changed file itself when it is a spec;
 *   - its sibling `<name>.spec.ts`;
 *   - every spec in the same directory (cheap, and catches the common case of
 *     a module whose behaviour is pinned by a neighbouring spec).
 */
export function specsForChanges(suiteName, changed) {
  const suite = SUITES[suiteName];
  const all = discoverSpecs(suiteName);
  const prefix = suite.cwd + sep;
  const touchedDirs = new Set();
  const touchedSpecs = new Set();

  for (const file of changed) {
    const normalised = file.split('/').join(sep);
    if (!normalised.startsWith(prefix)) continue;
    const relPath = normalised.slice(prefix.length);
    if (/\.spec\.tsx?$/.test(relPath)) touchedSpecs.add(relPath);
    const base = relPath.replace(/\.(ts|tsx)$/, '');
    touchedSpecs.add(`${base}.spec.ts`);
    touchedSpecs.add(`${base}.spec.tsx`);
    touchedDirs.add(dirname(relPath));
  }

  return all.filter((spec) => touchedSpecs.has(spec) || touchedDirs.has(dirname(spec)));
}

function parseArgs(argv) {
  const options = {
    suites: [],
    filters: [],
    changed: false,
    guards: false,
    base: null,
    list: false,
    isolation: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--filter') {
      options.filters.push(argv[++i]);
    } else if (arg.startsWith('--filter=')) {
      options.filters.push(arg.slice('--filter='.length));
    } else if (arg === '--changed') {
      options.changed = true;
    } else if (arg === '--guards') {
      options.guards = true;
    } else if (arg === '--base') {
      options.base = argv[++i];
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg.startsWith('--isolation=')) {
      options.isolation = arg.slice('--isolation='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const name = positional[0] ?? 'all';
  options.suites = GROUPS[name] ?? [name];
  if (name === 'guards') options.guards = true;
  // Bare words after the suite are treated as filters: `run-specs mobile map`.
  options.filters.push(...positional.slice(1));
  return options;
}

function runSuite(suiteName, specs, options) {
  const suite = SUITES[suiteName];
  if (specs.length === 0) {
    console.log(`[${suiteName}] no matching specs — nothing to run.`);
    return 0;
  }
  const nodeArgs = [...suite.nodeArgs];
  if (options.isolation === 'none') nodeArgs.push('--experimental-test-isolation=none');

  console.log(`[${suiteName}] running ${specs.length} spec file(s)`);
  const result = spawnSync(process.execPath, [...nodeArgs, ...specs], {
    cwd: join(repoRoot, suite.cwd),
    env: { ...process.env, ...suite.env },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const changed = options.changed ? changedFiles(options.base) : null;
  if (options.changed && changed.length === 0) {
    console.log('[run-specs] no changed files detected — nothing to run.');
    return 0;
  }

  let worst = 0;
  for (const suiteName of options.suites) {
    if (!SUITES[suiteName]) {
      console.error(
        `Unknown suite "${suiteName}". Known: ${Object.keys(SUITES).join(', ')}, ${Object.keys(GROUPS).join(', ')}`,
      );
      return 1;
    }
    let specs = options.changed ? specsForChanges(suiteName, changed) : discoverSpecs(suiteName);
    if (options.guards) {
      const fragments = GUARD_FRAGMENTS[suiteName].map((fragment) => fragment.split('/').join(sep));
      specs = specs.filter((spec) => fragments.some((fragment) => spec.includes(fragment)));
    }
    if (options.filters.length > 0) {
      specs = specs.filter((spec) => options.filters.some((f) => spec.includes(f)));
    }
    if (options.list) {
      console.log(`[${suiteName}] ${specs.length} spec file(s)`);
      for (const spec of specs) console.log(`  ${spec}`);
      continue;
    }
    const status = runSuite(suiteName, specs, options);
    if (status !== 0) worst = status;
  }
  return worst;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
