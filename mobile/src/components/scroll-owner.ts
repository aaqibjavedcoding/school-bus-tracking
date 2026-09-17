/**
 * Scroll-owner guard — **one scroll owner per screen**.
 *
 * React Native refuses to nest a virtualized list inside a plain `ScrollView`
 * that scrolls the same way, and says so in the log:
 *
 *   VirtualizedLists should never be nested inside plain ScrollViews with the
 *   same orientation
 *
 * The warning is not cosmetic. Inside an outer vertical `ScrollView` the inner
 * list is measured with an unbounded height, so it renders *every* row at once
 * and recycling — the whole point of `FlatList`/`SectionList` — silently stops
 * happening. Two scrollers also fight over the same gesture.
 *
 * `<Screen />` is this app's plain vertical `ScrollView`, so the rule is
 * mechanical and checkable without a device: a screen may render a virtualized
 * list *or* a `<Screen>`, but a list may never appear between a `<Screen>` and
 * its `</Screen>`. A screen that legitimately needs both (admin trip detail
 * keeps `<Screen>` for its error and "no students" branches) is fine — the
 * list just has to sit outside it and own the scrolling itself, taking the
 * content above it as its `ListHeaderComponent`.
 *
 * This module is the pure half of the check (no `react-native` import) so
 * `scroll-owner.spec.ts` can pin it under plain `node --test`; the spec then
 * applies it to the whole `app/` + `src/` tree, the same split
 * `theme/legibility.ts` + `theme/legibility.spec.ts` already use.
 */

/** Every component that renders a virtualized (recycling) list. */
export const VIRTUALIZED_LISTS = [
  'VirtualizedList',
  'FlatList',
  'FlatListView',
  'SectionList',
  'SectionListView',
  'ListScreen',
  'ManifestList',
] as const;

/** Every component that renders a plain, non-recycling vertical scroller. */
export const SCROLL_CONTAINERS = ['ScrollView', 'Screen'] as const;

export interface NestedListViolation {
  line: number;
  /** The virtualized list found inside a scroller. */
  list: string;
  /** The scroller it was nested in. */
  container: string;
  snippet: string;
}

/**
 * Characters after which a quote really does open a string literal.
 *
 * Without this, the apostrophe in JSX text (`<Text>Driver's stop</Text>`)
 * looks like the start of a string and swallows the rest of the line — which
 * is how a scanner ends up *hiding* the tag it was looking for.
 */
const VALUE_POSITION = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '{',
  '&',
  '|',
  '?',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '~',
  '^',
  '<',
  '>',
  ';',
]);

/**
 * Blank out comments and string-literal *contents*, preserving length and line
 * breaks so reported line numbers still point at the original source.
 *
 * Comments have to go: this guard's own call sites document the rule with a
 * literal `<Screen>` in a doc comment, and a scanner that reads prose would
 * report the fix as the bug. Strings are blanked so a `//` inside a URL cannot
 * be mistaken for a line comment.
 *
 * The one deliberate trade-off: a false positive here is impossible (we only
 * ever *remove* characters), so at worst an exotic literal hides a tag and the
 * check under-reports. It never cries wolf.
 */
export function maskCommentsAndStrings(source: string): string {
  const chars = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < chars.length; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  };
  const opensString = (quoteIndex: number): boolean => {
    let i = quoteIndex - 1;
    while (i >= 0 && /\s/.test(source[i]!)) i -= 1;
    return i < 0 || VALUE_POSITION.has(source[i]!);
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      let end = i;
      while (end < source.length && source[end] !== '\n') end += 1;
      blank(i, end);
      i = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const found = source.indexOf('*/', i + 2);
      const end = found === -1 ? source.length : found + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      if (!opensString(i)) {
        // An apostrophe in JSX text — literal punctuation, not a string.
        i += 1;
        continue;
      }
      let end = i + 1;
      let closed = false;
      while (end < source.length) {
        const current = source[end]!;
        if (current === '\\') {
          end += 2;
          continue;
        }
        if (current === char) {
          end += 1;
          closed = true;
          break;
        }
        // `'` and `"` cannot span lines in JS, so a newline means this was
        // prose after all — stop instead of eating the rest of the file.
        if (char !== '`' && current === '\n') break;
        end += 1;
      }
      blank(i + 1, closed ? end - 1 : end);
      i = end;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

/** Does the JSX tag starting at `from` (just past its name) close itself? */
function tagIsSelfClosing(masked: string, from: number): boolean {
  let braces = 0;
  for (let i = from; i < masked.length; i += 1) {
    const char = masked[i]!;
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '>' && braces <= 0) return masked[i - 1] === '/';
  }
  return false;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Every virtualized list this source renders inside a plain scroller.
 * An empty result is the invariant holding.
 */
export function nestedVirtualizedLists(source: string): NestedListViolation[] {
  const masked = maskCommentsAndStrings(source);
  const lines = source.split('\n');
  const containers: readonly string[] = SCROLL_CONTAINERS;
  const isContainer = (name: string): boolean => containers.includes(name);

  const tags: { name: string; index: number; closing: boolean }[] = [];
  for (const name of [...SCROLL_CONTAINERS, ...VIRTUALIZED_LISTS]) {
    const pattern = new RegExp(`<(\\/?)${name}(?![A-Za-z0-9_$])`, 'g');
    for (const match of masked.matchAll(pattern)) {
      tags.push({ name, index: match.index!, closing: match[1] === '/' });
    }
  }
  tags.sort((a, b) => a.index - b.index);

  const open: string[] = [];
  const violations: NestedListViolation[] = [];
  for (const tag of tags) {
    if (isContainer(tag.name)) {
      if (tag.closing) {
        open.pop();
      } else if (!tagIsSelfClosing(masked, tag.index + tag.name.length + 1)) {
        open.push(tag.name);
      }
      continue;
    }
    if (!tag.closing && open.length > 0) {
      const line = lineOf(source, tag.index);
      violations.push({
        line,
        list: tag.name,
        container: open[open.length - 1]!,
        snippet: (lines[line - 1] ?? '').trim(),
      });
    }
  }
  return violations;
}
