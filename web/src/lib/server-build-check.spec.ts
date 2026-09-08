import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  inspectServerBuild,
  listServerSources,
  describeProblem,
  ensureServerBuild,
} = require('../../server-build-check.js');

/**
 * Regression guard for the stale-`web/dist` failure mode.
 *
 * Route handlers `require()` the compiled server tree at runtime. When a
 * source module exists but its compiled output does not (typical right after
 * pulling a branch that added an endpoint — e.g. `api/dashboard.ts` — without
 * re-running `build:server`), the server boots fine and then the first call
 * into that module answers with Next's generic 500 page instead of the JSON
 * envelope; the dashboard rendered that raw page. `server.js` now refuses to
 * serve such a tree (production) or rebuilds it (dev). These tests pin the
 * detection rules on synthetic trees so they never touch the real `dist`.
 */

const tempDirs: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-build-check-'));
  tempDirs.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function setMtime(file: string, epochSeconds: number): void {
  fs.utimesSync(file, epochSeconds, epochSeconds);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('server build check — source discovery', () => {
  it('lists every compilable server source and skips specs, .d.ts and the excluded test helpers', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'src/server/api/dashboard.spec.ts': '',
      'src/server/http/route-testing.ts': '',
      'src/server/http/test-server.ts': '',
      'src/server/http/route-runtime.ts': '',
      'src/server/types/global.d.ts': '',
      'src/server/database/migrations/.gitkeep': '',
      'src/server/modules/dashboard/dashboard.service.ts': '',
    });

    const sources = listServerSources(path.join(root, 'src/server')).sort();
    assert.deepEqual(sources, [
      'api/dashboard.ts',
      'http/route-runtime.ts',
      'modules/dashboard/dashboard.service.ts',
    ]);
  });
});

describe('server build check — inspection', () => {
  it('passes when every source has a compiled output that is at least as new', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'src/server/api/auth.ts': '',
      'dist/api/dashboard.js': '',
      'dist/api/auth.js': '',
    });
    setMtime(path.join(root, 'src/server/api/dashboard.ts'), 1_000);
    setMtime(path.join(root, 'src/server/api/auth.ts'), 1_000);
    setMtime(path.join(root, 'dist/api/dashboard.js'), 2_000);
    setMtime(path.join(root, 'dist/api/auth.js'), 1_000);

    const result = inspectServerBuild({
      serverSrc: path.join(root, 'src/server'),
      serverDist: path.join(root, 'dist'),
    });
    assert.deepEqual(result, { ok: true, missing: [], stale: [], reason: null });
  });

  it('reports the module whose compiled output is missing (the dashboard-stats scenario)', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'src/server/api/auth.ts': '',
      'dist/api/auth.js': '',
    });

    const result = inspectServerBuild({
      serverSrc: path.join(root, 'src/server'),
      serverDist: path.join(root, 'dist'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-outputs');
    assert.deepEqual(result.missing, ['api/dashboard.ts']);
    assert.match(describeProblem(result), /incomplete/);
    assert.match(describeProblem(result), /src\/server\/api\/dashboard\.ts/);
  });

  it('reports a source edited after its output was written', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'dist/api/dashboard.js': '',
    });
    setMtime(path.join(root, 'dist/api/dashboard.js'), 1_000);
    setMtime(path.join(root, 'src/server/api/dashboard.ts'), 5_000);

    const result = inspectServerBuild({
      serverSrc: path.join(root, 'src/server'),
      serverDist: path.join(root, 'dist'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'stale-outputs');
    assert.deepEqual(result.stale, ['api/dashboard.ts']);
    assert.match(describeProblem(result), /stale/);
  });

  it('ignores mtimes when freshness checking is off (production images)', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'dist/api/dashboard.js': '',
    });
    setMtime(path.join(root, 'dist/api/dashboard.js'), 1_000);
    setMtime(path.join(root, 'src/server/api/dashboard.ts'), 5_000);

    const result = inspectServerBuild({
      serverSrc: path.join(root, 'src/server'),
      serverDist: path.join(root, 'dist'),
      checkFreshness: false,
    });
    assert.equal(result.ok, true);
  });

  it('reports a missing dist directory', () => {
    const root = makeTree({ 'src/server/api/dashboard.ts': '' });
    const result = inspectServerBuild({
      serverSrc: path.join(root, 'src/server'),
      serverDist: path.join(root, 'dist'),
    });
    assert.equal(result.reason, 'dist-missing');
    assert.match(describeProblem(result), /missing/);
  });
});

describe('server build check — start-up policy', () => {
  it('refuses to start a production server on a partial dist and names the fix', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'src/server/api/auth.ts': '',
      'dist/api/auth.js': '',
    });

    assert.throws(
      () => ensureServerBuild({ webDir: root, dev: false, log: () => {} }),
      (error: Error) =>
        /incomplete/.test(error.message) &&
        /api\/dashboard\.ts/.test(error.message) &&
        /npm run build:server/.test(error.message),
    );
  });

  it('lets a complete production dist through without touching it', () => {
    const root = makeTree({
      'src/server/api/dashboard.ts': '',
      'dist/api/dashboard.js': '',
    });
    const result = ensureServerBuild({ webDir: root, dev: false, log: () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.rebuilt, false);
  });

  it('can be bypassed explicitly with SKIP_SERVER_BUILD_CHECK=true', () => {
    const root = makeTree({ 'src/server/api/dashboard.ts': '' });
    const previous = process.env.SKIP_SERVER_BUILD_CHECK;
    process.env.SKIP_SERVER_BUILD_CHECK = 'true';
    try {
      const result = ensureServerBuild({ webDir: root, dev: false, log: () => {} });
      assert.equal(result.ok, true);
    } finally {
      if (previous === undefined) delete process.env.SKIP_SERVER_BUILD_CHECK;
      else process.env.SKIP_SERVER_BUILD_CHECK = previous;
    }
  });
});
