import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guard: **every create / update / delete handler refreshes data.**
 *
 * The reported bug was a list that kept showing the rows from before its own
 * save, which an operator fixed by pressing the browser's reload button. The
 * fix is twofold, and both halves are pinned here because both are easy to undo
 * by accident in a later refactor:
 *
 * 1. `services/api.ts` broadcasts one invalidation per **successful** mutation
 *    (`lib/data-updated`), and both list hooks listen — so no screen can be
 *    forgotten, including the ones a page does not own;
 * 2. each handler that writes still refreshes what it rendered, which is what
 *    keeps a screen responsive without waiting for the broadcast and what
 *    updates data a refetch cannot (locally patched rows, closed dialogs).
 *
 * Like `map-provider-policy.spec.ts`, this is a source scanner: there is no
 * browser in CI, and an assertion over the files is the only way to stop the
 * next form from shipping without a reload.
 */

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['src/app/(authenticated)', 'src/features'] as const;

/**
 * An api-client call that can change server state: everything but the reads.
 * Named by verb rather than by a whitelist of write verbs, because a new
 * `apiClient.archiveThing()` must be caught by this guard, not slip through it.
 */
const READ_CALL = /^(list|get|download|preview|ensure|validate|run|has|resolve)/;
const API_CALL = /apiClient\.(\w+)\s*\(/g;
const MUTATION_CALL = {
  test: (body: string): boolean => {
    API_CALL.lastIndex = 0;
    for (const match of body.matchAll(API_CALL)) {
      if (!READ_CALL.test(match[1]!)) return true;
    }
    return false;
  },
};

/** Anything that means "the data on this screen is current again". */
const REFRESH_TOKEN =
  /(reload|refresh|revalidate|refetch|invalidate|notifyDataUpdated)\s*[.(]|on(Changed|Saved|Updated|Imported|Submitted|Done|Refresh)\s*[.(?]|set(?:Data|Items)\s*\(|router\.(push|replace|refresh)\s*\(/;

/** A handler's opening line: `const save = async (…) => {` / `function remove(…) {`. */
const HANDLER_START =
  /^\s*(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:React\.)?(?:useCallback\(\s*)?(?:async\s*)?\(/;

/**
 * An opt-out the reader can see, and the scanner cannot invent: a write that
 * genuinely changes no list row (minting a pairing QR) states so, with a
 * reason. A bare marker with no reason is itself a failure.
 */
const EXEMPT = /\/\/\s*refresh-exempt:\s*(\S.*)$/;

/** The file-level marker: "this is a list screen", i.e. worth auditing. */
const LIST_HOOK = /use(?:Load|PagedResource)\s*\(/;

function listFiles(dir: string, out: string[] = []): string[] {
  const absolute = join(webRoot, dir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute)) {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) listFiles(relative(webRoot, child), out);
    else if (/\.tsx?$/.test(entry) && !/\.spec\.ts$/.test(entry)) out.push(relative(webRoot, child));
  }
  return out;
}

/** The body of the handler starting at `start`, by brace counting. */
function handlerBody(lines: string[], start: number): string {
  let depth = 0;
  let seenBrace = false;
  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    collected.push(lines[i]!);
    for (const character of lines[i]!) {
      if (character === '{') {
        depth += 1;
        seenBrace = true;
      } else if (character === '}') depth -= 1;
    }
    if (seenBrace && depth <= 0) break;
  }
  return collected.join('\n');
}

/** Whether a body refreshes, one level of file-local helper deep. */
function bodyRefreshes(body: string, helpers: Map<string, string>, depth = 0): boolean {
  if (REFRESH_TOKEN.test(body)) return true;
  if (depth >= 2) return false;
  for (const [name, helperBody] of helpers) {
    if (helperBody === body) continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(body) && bodyRefreshes(helperBody, helpers, depth + 1)) {
      return true;
    }
  }
  return false;
}

/** Handlers that write, and whether each one refreshes, on list screens only. */
function audit(): Array<{ file: string; handler: string; line: number; refreshed: boolean }> {
  const findings: Array<{ file: string; handler: string; line: number; refreshed: boolean }> = [];
  for (const root of SCAN_ROOTS) {
    for (const file of listFiles(root)) {
      const source = readFileSync(join(webRoot, file), 'utf8');
      // A list screen is what the acceptance criterion is about ("zero manual
      // reloads on any web list page"): only files that fetch through the shared
      // list hooks are audited, so a session or a modal helper is not mistaken
      // for one.
      if (!LIST_HOOK.test(source)) continue;
      const lines = source.split('\n');
      const handlers = new Map<string, string>();
      const starts = new Map<string, number>();
      lines.forEach((line, index) => {
        const match = line.match(HANDLER_START);
        if (!match) return;
        const body = handlerBody(lines, index);
        handlers.set(match[1]!, body);
        starts.set(match[1]!, index + 1);
      });
      for (const [handler, body] of handlers) {
        if (!MUTATION_CALL.test(body)) continue;
        const exempt = body.match(EXEMPT);
        findings.push({
          file,
          handler,
          line: starts.get(handler)!,
          refreshed: Boolean(exempt) || bodyRefreshes(body, handlers),
        });
      }
    }
  }
  return findings;
}

describe('web list-refresh policy (no manual reload after a write)', () => {
  it('scans the real surface, not an empty set', () => {
    const found = audit();
    assert.ok(
      found.length >= 25,
      `expected every create/update/delete handler to be found; got ${found.length} — scanner broken?`,
    );
  });

  it('every handler that writes also refreshes what it renders', () => {
    const missing = audit()
      .filter((entry) => !entry.refreshed)
      .map((entry) => `${entry.file}:${entry.line}  ${entry.handler}()`);
    assert.deepEqual(
      missing,
      [],
      `these handlers write without refreshing their data:\n${missing.join('\n')}`,
    );
  });

  it('the api layer broadcasts one invalidation per successful mutation', () => {
    const api = readFileSync(join(webRoot, 'src/services/api.ts'), 'utf8');
    assert.match(
      api,
      /notifyDataUpdated\(\)/,
      'a successful mutation must notify lib/data-updated, or only the list that owns the write refreshes',
    );
    assert.match(
      api,
      /apiCache\.clear\(\)/,
      'the response cache must still be dropped on every mutation, successful or not',
    );
  });

  it('both list hooks listen, so no screen has to remember to', () => {
    for (const hook of ['src/hooks/useLoad.ts', 'src/hooks/usePagedResource.ts']) {
      const source = readFileSync(join(webRoot, hook), 'utf8');
      assert.match(
        source,
        /subscribeDataUpdated\(/,
        `${hook} must refresh when the app reports a write`,
      );
      assert.match(
        source,
        /createDebouncedReload\(/,
        `${hook} must coalesce a burst of writes into one refetch`,
      );
    }
  });
});
