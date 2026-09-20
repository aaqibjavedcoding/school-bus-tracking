import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Regression guard for the crew render loop ("Maximum update depth exceeded").
 *
 * The loop: `GpsPermissionRecovery`'s mount effect called
 * `refreshCrewPermissions()` → the lifecycle published → every subscribed
 * screen re-rendered → the Help screen handed the panel a **new** `sharing`
 * object and a **new** inline `onPermissionGranted` → the panel's
 * `useCallback` keyed on them changed identity → the effect re-ran → …
 *
 * Source scanners in the style of `help-routing.spec.ts`: each of the four
 * layers that closes the loop is pinned so a refactor cannot quietly reopen it.
 * The behavioural half (an unchanged refresh publishes nothing) lives in
 * `tracking-recovery.sim.spec.ts`.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

const RECOVERY_PANEL = 'src/features/crew/GpsPermissionRecovery.tsx';
const SHARING_HOOK = 'src/features/crew/useCrewLocationSharing.ts';
const LIFECYCLE = 'src/features/crew/tracking-lifecycle.ts';
const HELP_SCREEN = 'app/(crew)/help.tsx';

/** The dependency arrays of every `useCallback` / `useEffect` in a source. */
function hookDependencyArrays(source: string, hook: 'useCallback' | 'useEffect'): string[] {
  const deps: string[] = [];
  const pattern = new RegExp(`${hook}\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    // Walk to the matching close paren of this hook call, then read the last
    // `[...]` argument inside it.
    let depth = 0;
    let end = -1;
    for (let i = match.index + hook.length; i < source.length; i += 1) {
      const char = source[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const call = source.slice(match.index, end);
    const lastArray = call.match(/\[[^\]]*\]\s*,?\s*$/);
    deps.push(lastArray ? lastArray[0] : '');
  }
  return deps;
}

test('GpsPermissionRecovery never keys a hook on the `sharing` object or the callback prop', () => {
  const source = read(RECOVERY_PANEL);
  for (const hook of ['useCallback', 'useEffect'] as const) {
    for (const deps of hookDependencyArrays(source, hook)) {
      assert.ok(
        !/\bsharing\b/.test(deps),
        `${hook} deps ${deps} must use primitives (Boolean(sharing), backgroundConsent), not the object`,
      );
      assert.ok(
        !/\bonPermissionGranted\b/.test(deps),
        `${hook} deps ${deps} must not include the callback prop — read it through a ref`,
      );
    }
  }
  assert.ok(
    /const onPermissionGrantedRef = useRef\(onPermissionGranted\)/.test(source) &&
      /onPermissionGrantedRef\.current = onPermissionGranted/.test(source),
    'the granted callback is read through a latest-callback ref',
  );
  assert.ok(
    /const hasLifecycle = sharing !== null && sharing !== undefined/.test(source),
    'the lifecycle wiring is reduced to a boolean before it reaches a dependency array',
  );
});

test('useCrewLocationSharing hands out one memoised binding per distinct state', () => {
  const source = read(SHARING_HOOK);
  assert.ok(
    /return useMemo<CrewLocationSharing>\(/.test(source),
    'the returned binding must be a useMemo — a fresh literal per render re-arms every consumer',
  );
});

test('the lifecycle ignores no-op patches (no publish for unchanged values)', () => {
  const source = read(LIFECYCLE);
  assert.ok(/function isNoopPatch</.test(source), 'isNoopPatch guards every patch helper');
  for (const helper of ['function patch(', 'function patchStats(', 'function patchRecovery(']) {
    const start = source.indexOf(helper);
    assert.ok(start >= 0, `${helper} exists`);
    const body = source.slice(start, source.indexOf('publish();', start));
    assert.ok(body.includes('isNoopPatch('), `${helper} returns early on a no-op patch`);
  }
});

test('the Help screen passes a stable onPermissionGranted, never an inline arrow', () => {
  const source = read(HELP_SCREEN);
  assert.ok(
    !/onPermissionGranted=\{\s*\(\)\s*=>/.test(source),
    'an inline arrow is a new function every render',
  );
  assert.ok(
    /onPermissionGranted=\{noopPermissionGranted\}/.test(source),
    'the module-level no-op is what the panel receives',
  );
});
