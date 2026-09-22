import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { maskCommentsAndStrings } from './scroll-owner.ts';

/**
 * The wiring guard for "the keyboard never covers an input" — the top
 * acceptance criterion of the UX batch.
 *
 * One reusable wrapper owns the behaviour: `src/components/keyboard-form.tsx`
 * (`KeyboardForm` = KAV with the per-platform behaviour + a ScrollView that
 * scrolls the focused input above the keyboard, with the fields registering
 * themselves through `KeyboardFormContext`). `Screen`, `ListScreen`,
 * `FormSheet` and the `Select` picker delegate to the same
 * `useKeyboardReveal` machinery, so the acceptance criterion reduces to two
 * checks, both done here:
 *
 * 1. **the wrapper is wired correctly** — KAV with `keyboardBehavior` (the
 *    iOS/Android behaviour split lives in `keyboard-aware.ts` and is unit
 *    tested there), platform-correct keyboard events, focus registration and
 *    the reveal scroll;
 * 2. **no screen is left unhandled** — every `app/**` file that contains a
 *    text input renders it inside a keyboard-aware container
 *    (`KeyboardForm` / `FormSheet` / `Screen` / `ListScreen`). A new screen
 *    that drops a raw `<Field>` in a plain `<View>` fails here in CI
 *    instead of hiding the field behind the keyboard in the field.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

// ── Layer 1: the wrapper itself ────────────────────────────────────────────

describe('keyboard-form.tsx wiring', () => {
  const source = read('src/components/keyboard-form.tsx');

  it('wraps the form in a KeyboardAvoidingView with the per-platform behaviour', () => {
    assert.ok(source.includes('KeyboardAvoidingView'), 'KAV is the avoidance primitive');
    // The behaviour split (padding on iOS, height on Android) is shared —
    // pinned here so the wrapper cannot silently hard-code one platform.
    assert.ok(
      source.includes('keyboardBehavior(Platform.OS)'),
      'behaviour must come from the per-platform keyboardBehavior()',
    );
  });

  it('listens to the platform-correct keyboard show/hide event pairs', () => {
    for (const event of [
      'keyboardWillShow',
      'keyboardDidShow',
      'keyboardWillHide',
      'keyboardDidHide',
    ]) {
      assert.ok(source.includes(`'${event}'`), `${event} is part of the listener matrix`);
    }
    assert.ok(
      source.includes("Platform.OS === 'ios'"),
      'the will/did split is chosen per platform',
    );
  });

  it('reveals the focused input by scrolling, not by re-laying-out', () => {
    assert.ok(source.includes('measureInWindow'), 'the input position is measured in window space');
    assert.ok(source.includes('scrollOffsetToRevealInput'), 'the reveal geometry is shared');
    assert.ok(source.includes('scrollTo({ y: offset, animated: true })'), 'the fix is a scroll');
  });

  it('lets every input register itself on focus', () => {
    assert.ok(source.includes('focusInput'), 'the context exposes focusInput');
    assert.ok(source.includes('KeyboardFormContext.Provider'), 'the provider publishes it');
  });
});

// ── Layer 2: no screen is left unhandled ───────────────────────────────────

/** Containers that provide the reveal context for their scroll area. */
const CONTAINER_TAGS = ['KeyboardForm', 'FormSheet', 'Screen', 'ListScreen'] as const;
/** Elements that contain a real text input the keyboard could cover. */
const INPUT_TAGS = ['Field', 'PasswordField', 'TextInput', 'SearchBar', 'DateTimeField'] as const;

const ALL_TAGS = [...CONTAINER_TAGS, ...INPUT_TAGS];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(mobileRoot, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(mobileRoot, relative)).isDirectory()) listFiles(relative, out);
    else out.push(relative);
  }
  return out;
}

/**
 * Reports every input tag in a masked source that is not nested inside one
 * of the keyboard-aware containers — including JSX passed to a container as
 * a prop (`header={<SearchBar/>}`), which renders in the same scroll area.
 */
function inputsOutsideContainers(source: string): Array<{ line: number; tag: string }> {
  const masked = maskCommentsAndStrings(source);
  const violations: Array<{ line: number; tag: string }> = [];

  const findLine = (index: number): number => masked.slice(0, index).split('\n').length;
  // The lookbehind keeps TypeScript generics (`useRef<TextInput>`) out of the
  // scan — a tag position is never preceded by an identifier character.
  const tagRe = new RegExp(`(?<![A-Za-z0-9_$])<(/?)(${ALL_TAGS.join('|')})(?=[\\s/>])`, 'g');

  interface TagOccurrence {
    index: number;
    /** The `>` that ends an opening tag (its own span for self-closing tags). */
    end: number;
    isClose: boolean;
    selfClosing: boolean;
    name: string;
  }
  /**
   * The `>` that terminates the opening tag at `tagStart`.
   *
   * Everything inside the tag's attribute expressions — nested JSX
   * (`header={<><SearchBar/></>}`), arrows (`=>`), comparisons
   * (`length > 0`), fragments — lives inside a `{…}` / `[…]` / `[…]`
   * bracket pair, so a `>` only terminates the tag when the bracket depth
   * is back at zero. The one tag-level `<…>` that is not a bracketed
   * expression is a TSX generic parameter list (`FilterChips<Role>`),
   * skipped by identifier-lookbehind.
   *
   * The shared masker blanks string contents, and a template literal with a
   * nested backtick (`${cond ? `a` : `b`}`) is split at the inner backtick:
   * the opener's `${` is blanked while its `}` survives, leaving a stray
   * close bracket. That closer has no matching opener, so a `}`/`)`/`]`
   * found at depth zero is mask noise and is skipped rather than treated as
   * unbalanced source. Returns `null` only if no terminating `>` is found.
   */
  const findTagTerminator = (
    text: string,
    tagStart: number,
  ): { end: number; selfClosing: boolean } | null => {
    let depth = 0;
    for (let i = tagStart + 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{' || ch === '(' || ch === '[') {
        depth += 1;
      } else if (ch === '}' || ch === ')' || ch === ']') {
        if (depth === 0) continue; // stray close bracket from a split template literal
        depth -= 1;
      } else if (ch === '<' && /^[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) {
        // TSX generic parameter list — skip to its matching `>`.
        let balance = 1;
        let j = i + 1;
        for (; j < text.length && balance > 0; j += 1) {
          if (text[j] === '<') balance += 1;
          else if (text[j] === '>' && text[j - 1] !== '=') balance -= 1;
        }
        if (balance !== 0) return null;
        i = j - 1;
      } else if (ch === '>' && depth === 0) {
        return { end: i, selfClosing: text[i - 1] === '/' };
      }
    }
    return null;
  };

  const occurrences: TagOccurrence[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(masked)) !== null) {
    if (match[1] === '/') {
      occurrences.push({
        index: match.index,
        end: match.index,
        isClose: true,
        selfClosing: false,
        name: match[2],
      });
    } else {
      const terminator = findTagTerminator(masked, match.index);
      occurrences.push({
        index: match.index,
        end: terminator?.end ?? match.index,
        isClose: false,
        selfClosing: terminator?.selfClosing ?? false,
        name: match[2],
      });
    }
  }

  // A container's region runs from its opening tag to its matching closing
  // tag: anything written in between — including JSX passed as a prop such
  // as `header={...}` or `renderItem={...}` — renders inside its scroll
  // area. A self-closing container's region is its own tag span (children
  // arrive only through props, so they live inside that span).
  const containerRegions: Array<[number, number]> = [];
  const openContainers: Array<{ name: string; start: number }> = [];
  for (const occ of occurrences) {
    if (!(CONTAINER_TAGS as readonly string[]).includes(occ.name)) continue;
    if (occ.isClose) {
      const openerIndex = openContainers.map((open) => open.name).lastIndexOf(occ.name);
      if (openerIndex !== -1) {
        const opener = openContainers[openerIndex]!;
        containerRegions.push([opener.start, occ.index]);
        openContainers.splice(openerIndex, 1);
      }
    } else if (occ.selfClosing) {
      containerRegions.push([occ.index, occ.end]);
    } else {
      openContainers.push({ name: occ.name, start: occ.index });
    }
  }

  const inContainer = (index: number): boolean =>
    containerRegions.some(([start, end]) => index > start && index < end);

  for (const occ of occurrences) {
    if (occ.isClose) continue;
    if (!(INPUT_TAGS as readonly string[]).includes(occ.name)) continue;
    if (inContainer(occ.index)) continue;
    violations.push({ line: findLine(occ.index), tag: occ.name });
  }

  return violations;
}

describe('every screen input renders inside a keyboard-aware container', () => {
  it('flags a raw Field outside any container (synthetic regression shape)', () => {
    const before = ['<View>', '  <Field label="Email" />', '</View>'].join('\n');
    const found = inputsOutsideContainers(before);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.tag, 'Field');
  });

  it('accepts the same field once a container wraps it', () => {
    for (const container of CONTAINER_TAGS) {
      const after = [`<${container}>`, '  <Field label="Email" />', `</${container}>`].join('\n');
      assert.deepEqual(inputsOutsideContainers(after), [], `<${container}> must cover the field`);
    }
  });

  it('accepts inputs of every kind inside a FormSheet', () => {
    const source = [
      '<FormSheet open title="Filters" onClose={() => {}}>',
      '  <SearchBar value={q} onChangeText={setQ} />',
      '  <DateTimeField label="Start" value={v} onChange={setV} />',
      '  <PasswordField label="PIN" value={p} onChangeText={setP} />',
      '  <TextInput value={raw} onChangeText={setRaw} />',
      '</FormSheet>',
    ].join('\n');
    assert.deepEqual(inputsOutsideContainers(source), []);
  });

  it('ignores tag-like text in comments and strings', () => {
    const source = [
      '// <Field> in a comment is not an input',
      "const note = 'tap <Field> to edit';",
      '<View><Field label="Real" /></View>',
    ].join('\n');
    const found = inputsOutsideContainers(source);
    assert.equal(found.length, 1, 'only the real JSX field is flagged');
  });

  it('survives the masker splitting a template literal at a nested backtick', () => {
    // The shape that broke the scan in the real tree: a JSX attribute whose
    // template literal contains a nested template (`${cond ? `a` : `b`}`).
    const source = [
      '<ListScreen',
      '  data={rows}',
      '  meta={`${row.bus ?? "No bus"} · ${row.from}${row.to ? ` → ${row.to}` : ` → open`}`}',
      '  header={<><SearchBar value={q} onChangeText={setQ} /></>}',
      '/>',
    ].join('\n');
    assert.deepEqual(inputsOutsideContainers(source), []);
  });

  it('no screen in app/** renders a text input outside a keyboard-aware container', () => {
    const failures: string[] = [];
    const files = listFiles('app').filter((path) => path.endsWith('.tsx'));
    assert.ok(files.length > 20, `expected the app tree, found ${files.length} screens`);
    for (const file of files) {
      for (const violation of inputsOutsideContainers(read(file))) {
        failures.push(
          `${file}:${violation.line} — <${violation.tag}> is not inside a ` +
            'KeyboardForm / FormSheet / Screen / ListScreen',
        );
      }
    }
    assert.deepEqual(failures, [], `screen inputs the keyboard can cover:\n${failures.join('\n')}`);
  });
});
