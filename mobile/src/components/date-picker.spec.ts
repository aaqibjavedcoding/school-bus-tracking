import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { maskCommentsAndStrings } from './scroll-owner.ts';

/**
 * The wiring guard for "no manual date typing anywhere" — one reusable
 * calendar date picker behind every date field in the app.
 *
 * Architecture it pins (see `DatePicker.tsx`, `date-picker-calendar.tsx`,
 * `src/lib/calendar.ts`):
 *
 * - `CalendarPicker` is the single calendar: a modal grid generated from
 *   `monthGrid`, so only real calendar days are tappable and an invalid date
 *   (Feb 30, `2026-13-40`) has no button to press;
 * - `DatePicker` is the single date *field*: a tappable control that opens
 *   `CalendarPicker`; the value stays the API's own `YYYY-MM-DD` (`''` =
 *   unset), so forms send exactly what the shared zod schemas validate;
 * - `DateTimeField`'s date segment opens the same calendar (the time segment
 *   stays a masked `HH:mm` input);
 * - the screens use those three components only — the grep gate below fails
 *   if any screen reintroduces a free-text date `Field`.
 *
 * The pure date math lives in `src/lib/calendar.spec.ts`.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(mobileRoot, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(mobileRoot, relative)).isDirectory()) listFiles(relative, out);
    else out.push(relative);
  }
  return out;
}

describe('one reusable picker behind every date field', () => {
  const field = read('src/components/DatePicker.tsx');
  const calendar = read('src/components/date-picker-calendar.tsx');
  const dateTime = read('src/components/DateTimeField.tsx');

  it('DatePicker opens the shared CalendarPicker and keeps the API date unit', () => {
    assert.ok(field.includes('<CalendarPicker'), 'the field is a trigger for the shared calendar');
    // The control never has a date keyboard: no masked date TextInput inside.
    assert.ok(!/TextInput/.test(maskCommentsAndStrings(field)), 'no text entry in the date field');
    // Value contract: what the calendar confirms (`YYYY-MM-DD`) is what the
    // parent receives, untransformed.
    assert.ok(
      field.includes('onConfirm={(date) => onChange(date)}'),
      'the picked date passes straight through to onChange',
    );
  });

  it('CalendarPicker only offers real calendar days, generated from monthGrid', () => {
    const source = maskCommentsAndStrings(calendar);
    assert.ok(calendar.includes("from '../lib/calendar'"), 'the grid math is the shared lib');
    assert.ok(calendar.includes('monthGrid('), 'cells come from monthGrid');
    // No month table / weekday literals of its own: the header and the
    // weekday row are i18n key lookups, so every locale renders its own
    // names (pinned by i18n-parity.spec.ts).
    assert.ok(calendar.includes('const MONTH_KEYS'), 'months are dictionary keys');
    assert.ok(calendar.includes('const WEEKDAY_KEYS'), 'weekdays are dictionary keys');
    assert.ok(
      calendar.includes('t(MONTH_KEYS[view.month - 1])'),
      'the month header renders through t()',
    );
    assert.ok(calendar.includes('WEEKDAY_KEYS.map'), 'the weekday row renders through t()');
    assert.ok(
      !/\b(January|February|March|April|Monday|Tuesday|Wednesday)\b/.test(source),
      'no full month or weekday names hardcoded',
    );
    // Single tap confirms and hands back the ISO date only.
    assert.ok(calendar.includes('onConfirm(stamp)'), 'a tap confirms the day');
  });

  it('DateTimeField picks its date from the same calendar', () => {
    assert.ok(dateTime.includes('<CalendarPicker'), 'the date segment opens the shared calendar');
  });
});

describe('no screen keeps manual date entry', () => {
  it('no Field or TextInput in app/** still asks for a date by hand', () => {
    const violations: string[] = [];
    const files = listFiles('app').filter((path) => path.endsWith('.tsx'));
    assert.ok(files.length > 20, `expected the app tree, found ${files.length} screens`);
    for (const file of files) {
      const source = maskCommentsAndStrings(read(file));
      // A date format hint in an element's attributes means the user is
      // still expected to type the date — the picker renders its own
      // placeholder, so no screen needs this.
      if (/YYYY-MM-DD/.test(source)) {
        const line = source.slice(0, source.indexOf('YYYY-MM-DD')).split('\n').length;
        violations.push(`${file}:${line} — a date is still entered by hand`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `manual date entry left in the app (use DatePicker):
${violations.join('\n')}`,
    );
  });

  it('every screen that shows a date uses the shared components', () => {
    // Cross-check the flip side: screens with date state import the picker
    // surface from the shared barrel, not a local copy.
    const pickers = ['DatePicker', 'CalendarPicker', 'DateTimeField'];
    const dateScreens = listFiles('app')
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => {
        const source = maskCommentsAndStrings(read(path));
        return /date_of_birth|issue_date|expiry_date|effective_from|date_from|date_to/.test(source);
      });
    assert.ok(dateScreens.length > 3, `expected date-bearing screens, found ${dateScreens.length}`);
    for (const file of dateScreens) {
      const source = read(file);
      assert.ok(
        pickers.some((name) => source.includes(`<${name}`)),
        `${file} carries date state but does not use the shared picker components`,
      );
    }
  });
});
