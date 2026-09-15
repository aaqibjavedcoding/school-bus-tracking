import { typography } from '@school-bus-tracking/design-tokens';
import { text } from './tokens.ts';

/**
 * Legibility guard — a pure source scanner that keeps the app's type-scale
 * rules enforceable under `node --test`:
 *
 * - crew surfaces (`app/(crew)`, `src/features/crew`, `src/features/tracking`):
 *   nothing below 16px — a driver reads the screen at arm's length;
 * - everything else: the shared floor is 14px (`labels/secondary` minimum) —
 *   the design tokens' `xs` (12px) has no place on a phone screen.
 *
 * The scanner only understands the literal forms style code actually uses
 * (`fontSize: 13`, `fontSize: typography.fontSizes.xs`,
 * `fontSize: text.secondary`); dynamic expressions are ignored by design —
 * this is a guardrail with a spec, not a proof.
 */

/** Resolvable size of every alias style code may reference. */
const ALIAS_SIZES: Record<string, number> = {
  ...Object.fromEntries(
    Object.entries(typography.fontSizes).map(([key, value]) => [`fontSizes.${key}`, value]),
  ),
  'text.body': text.body,
  'text.secondary': text.secondary,
  'text.title': text.title,
  'text.numeric': text.numeric,
  'text.statusWord': text.statusWord,
};

export interface FontViolation {
  line: number;
  snippet: string;
  size: number;
}

/**
 * Return every literal `fontSize` below `floor` in a TS/TSX source string.
 * `fontSizes.xs = 12` and `fontSizes.sm = 14` resolve through the design
 * token values rather than hardcoded numbers, so a scale change upstream
 * keeps this guard honest.
 */
export function fontSizeViolations(source: string, floor: number): FontViolation[] {
  const violations: FontViolation[] = [];
  // Block comments go first so documented examples (like the ones in this
  // very file) are never parsed as style code.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = stripped.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    // Strip trailing // comments so documented exceptions in prose are not
    // misparsed as style code.
    const code = line.replace(/\/\/.*$/, '');
    const dynamic =
      /fontSize\s*:\s*([0-9]+(?:\.[0-9]+)?|typography\.fontSizes\.[a-z0-9]+|text\.[a-zA-Z]+)/gi;
    for (const match of code.matchAll(dynamic)) {
      const raw = match[1]!;
      const size = /^[0-9]/.test(raw)
        ? Number(raw)
        : ALIAS_SIZES[raw.startsWith('typography.') ? raw.slice('typography.'.length) : raw];
      if (typeof size === 'number' && size < floor) {
        violations.push({ line: index + 1, snippet: line.trim(), size });
      }
    }
  }
  return violations;
}

/** `.tsx`/`.ts` files under a root, excluding test files (node --test's own). */
export function collectSourceFiles(
  root: string,
  readDir: (dir: string) => { name: string; isDirectory: boolean }[],
): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        stack.push(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
        files.push(path);
      }
    }
  }
  return files.sort();
}
