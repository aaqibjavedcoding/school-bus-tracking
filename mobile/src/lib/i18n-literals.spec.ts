import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

/**
 * The "grep gate": **no hardcoded English UI copy on the crew surfaces.**
 *
 * A source scanner in the same family as `help-routing.spec.ts` and
 * `theme/legibility.spec.ts` — the repo has no Jest/Vitest, and a filesystem
 * assertion is the only way to stop the next screen from reintroducing a raw
 * `'Loading…'` that no translator will ever see.
 *
 * What counts as a violation:
 *
 * - a raw string literal in a **UI prop** (`label`, `title`, `description`,
 *   `placeholder`, `message`, `accessibilityLabel`, `accessibilityHint`,
 *   `confirmLabel`, `cancelLabel`, `hint`) — these are exactly the strings a
 *   user reads or a screen reader speaks;
 * - raw **JSX text** between tags;
 * - any other literal that looks like **prose** (two or more words).
 *
 * What is deliberately allowed, and why (this list is the audit trail — every
 * entry is a category, not a get-out for one forgotten string):
 *
 * - **icon glyphs, style tokens, layout enums** — `icon="bus"`,
 *   `variant="ghost"`, `size="field"`, `textAlign`, `flexDirection`…;
 * - **route paths and tab route names** — `'/manifest'`, `name="trip"`;
 * - **data and enum values** — `'board'`, `'drop'`, `'attendance'`,
 *   `'trip_status'`, `'email-address'`, `'granted'`;
 * - **symbols and code-like values** — `'—'`, `'·'`, `'✓'`, `'SBT'`, `'SOS'`;
 * - **server-supplied strings** — the API's own error messages and
 *   `EMERGENCY_TYPE_LABELS` are passed through untouched (see
 *   `docs/mobile-ux.md` → "Server-string boundary");
 * - **the dictionary and copy modules themselves** — that is where the English
 *   lives, by design.
 */

const mobileRoot = process.cwd();
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(mobileRoot, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(mobileRoot, relative)).isDirectory()) listFiles(relative, out);
    else out.push(relative);
  }
  return out;
}

/** The crew route group — the acceptance criterion names exactly this glob. */
const CREW_SCREENS = listFiles('app/(crew)').filter((path) => path.endsWith('.tsx'));

/** Crew components, which hold most of the copy the screens render. */
const CREW_COMPONENTS = listFiles('src/features/crew').filter(
  (path) => path.endsWith('.tsx') && !path.endsWith('.spec.ts'),
);

/** Strips block comments, line comments and import/export-from clauses. */
function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

/**
 * Non-copy literals. Matched case-insensitively and as a whole string, so an
 * entry can never accidentally permit a sentence.
 */
const ALLOWED_LITERALS = new Set([
  // Ionicons glyphs used on crew surfaces.
  'bus',
  'bus-outline',
  'people',
  'people-outline',
  'location',
  'location-outline',
  'warning',
  'warning-outline',
  'help-circle',
  'refresh',
  'stop-circle',
  'cloud-upload',
  'cloud-offline',
  'checkmark-circle',
  'close-circle',
  'checkmark-done',
  'navigate',
  'alert-circle',
  'search',
  'time',
  'options',
  'chevron-up',
  'chevron-down',
  'locate',
  'log-in',
  'log-out',
  // Button / badge / chip presentation enums.
  'primary',
  'secondary',
  'danger',
  'ghost',
  'success',
  'warning',
  'info',
  'neutral',
  'sm',
  'md',
  'lg',
  'field',
  'offline',
  'syncing',
  'error',
  'good',
  'weak',
  'stale',
  'online',
  // Routes and tab route names.
  '/trip',
  '/manifest',
  '/stops',
  '/sos',
  '/help',
  'trip',
  'manifest',
  'stops',
  'sos',
  'help',
  // Data, enums, accessibility and input semantics — not copy.
  'board',
  'drop',
  'attendance',
  'trip_status',
  'button',
  'alert',
  'activate',
  'granted',
  'denied',
  'undetermined',
  'unavailable',
  'ALL',
  'PENDING',
  'BOARDED',
  'DROPPED',
  'email-address',
  'password',
  'next',
  'done',
  'submit',
  'none',
  // ── The four GPS support counters — deliberately English ────────────────
  // `help-routing.spec.ts` pins these verbatim on the Help surface: they are
  // read aloud *to the support engineer*, who works in English, and the screen
  // says so ("these numbers are for the support team"). Translating them would
  // break the Phase-2 guard and make the call with support harder. See
  // `docs/mobile-ux.md` → "Server-string boundary".
  'Sent',
  'Rejected',
  'Dropped (offline)',
  'Invalid fix',
  // Symbols, codes and data placeholders.
  '—',
  '·',
  '✓',
  '✕',
  '⏳',
  '✅',
  '❌',
  '…',
  'SBT',
  'SOS',
  'ETA',
  'GPS',
  '',
  ' ',
  ' · ',
  '. ',
  '#ffffff',
  '#f8fafc',
]);

/** Props whose value is user-visible copy. */
const UI_PROPS = [
  'label',
  'title',
  'description',
  'placeholder',
  'message',
  'accessibilityLabel',
  'accessibilityHint',
  'confirmLabel',
  'cancelLabel',
  'holdingLabel',
  'hint',
];

interface Violation {
  file: string;
  kind: string;
  value: string;
}

function scan(file: string): Violation[] {
  const source = stripNoise(read(file));
  const violations: Violation[] = [];

  // 1. Raw literals in user-visible props.
  const propPattern = new RegExp(`\\b(${UI_PROPS.join('|')})=(["'])((?:[^'"\\\\]|\\\\.)*)\\2`, 'g');
  for (const match of source.matchAll(propPattern)) {
    const value = match[3]!;
    if (!isAllowed(value)) violations.push({ file, kind: `${match[1]} prop`, value });
  }

  // 2. Raw JSX text children (">Loading today's trip…<").
  //    `useLoad<StopResponse[]>(…)` also contains a `>` … `<` pair, so a JSX
  //    text node is additionally required to be free of code punctuation.
  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1]!.replace(/&[a-z]+;/gi, ' ').trim();
    if (text.length === 0) continue;
    if (/[;()=]/.test(text)) continue; // an expression, not a text node
    if (!/[A-Za-z]{3,}/.test(text)) continue;
    // A bare identifier (`Promise` from `() => Promise<unknown>`) is a type, not
    // copy. Single-word copy is still caught by rule 1 on its `label`/`title`.
    if (!/\s/.test(text) && /^[A-Za-z][A-Za-z0-9_]*$/.test(text)) continue;
    if (!isAllowed(text)) {
      violations.push({ file, kind: 'JSX text', value: text });
    }
  }

  // 3. Any other prose-looking literal (two or more words, ASCII letters).
  for (const match of source.matchAll(/(["'])((?:[^'"\\\n]|\\.)*?)\1/g)) {
    const value = match[2]!;
    if (!looksLikeProse(value) || isAllowed(value)) continue;
    violations.push({ file, kind: 'prose literal', value });
  }

  return violations;
}

function isAllowed(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (ALLOWED_LITERALS.has(trimmed)) return true;
  // Pure data / code-ish: no spaces and no sentence punctuation.
  if (!/[\s.!?]/.test(trimmed) && !/^[A-Z][a-z]/.test(trimmed)) return true;
  return false;
}

function looksLikeProse(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  // Two or more alphabetic words — a phrase, not an identifier or a code.
  return (trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length >= 2 && /\s/.test(trimmed);
}

describe('grep gate: no hardcoded English UI copy on crew surfaces', () => {
  test('app/(crew)/** renders copy only through t() / crewCopy', () => {
    const violations = CREW_SCREENS.flatMap(scan);
    assert.deepEqual(
      violations,
      [],
      `hardcoded UI copy:\n${violations.map((v) => `  ${v.file} [${v.kind}] "${v.value}"`).join('\n')}`,
    );
  });

  test('crew components render copy only through t() / crewCopy', () => {
    const violations = CREW_COMPONENTS.flatMap(scan);
    assert.deepEqual(
      violations,
      [],
      `hardcoded UI copy:\n${violations.map((v) => `  ${v.file} [${v.kind}] "${v.value}"`).join('\n')}`,
    );
  });

  test('every crew screen subscribes to the locale so a switch re-renders it', () => {
    const unsubscribed = CREW_SCREENS.filter((file) => {
      const source = read(file);
      // A pure redirect/layout shell may render no copy at all.
      const rendersCopy = /\bt\(|crewCopy|LoadingView|EmptyState|ErrorState/.test(source);
      return rendersCopy && !source.includes('useTranslation()');
    });
    assert.deepEqual(
      unsubscribed,
      [],
      `these render copy without useTranslation(), so a language switch would need a restart: ${unsubscribed.join(', ')}`,
    );
  });

  test('the crew layout subscribes too — tab labels are copy', () => {
    const layout = read('app/(crew)/_layout.tsx');
    assert.ok(layout.includes('useTranslation()'), 'tab labels must be re-read on a locale change');
  });

  test('the gate actually scans files (guard against a silently empty glob)', () => {
    assert.ok(
      CREW_SCREENS.length >= 6,
      `expected the crew route group, found ${CREW_SCREENS.length}`,
    );
    assert.ok(
      CREW_COMPONENTS.length >= 8,
      `expected crew components, found ${CREW_COMPONENTS.length}`,
    );
    assert.ok(
      CREW_SCREENS.some((file) => file.endsWith('trip.tsx')),
      'trip.tsx must be in the scanned set',
    );
  });
});
