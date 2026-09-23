/**
 * Pure calendar maths behind the reusable date picker
 * (`src/components/DatePicker.tsx` and the date segment of
 * `src/components/DateTimeField.tsx`).
 *
 * Deliberately free of React and React Native imports so the rules — real
 * dates only, month-grid geometry, month arithmetic — are unit-tested in
 * plain Node exactly like the other `src/lib` helpers.
 *
 * Everything works on **calendar days** (`YYYY-MM-DD`), the same unit the API
 * expects. The picker can only hand back a day the calendar has, which is
 * what makes "invalid dates impossible": there is no text entry path.
 */

/** One real calendar day. `month` is 1-based (1 = January). */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Number of days in `month` of `year` (leap-year aware).
 * Returns 0 for an out-of-range month so callers can treat it as "no grid".
 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return 0;
  }
  // The last day of the previous month, read in UTC so the device timezone
  // can never shift the boundary (daylight saving, +14h offsets…).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a real calendar day (2026-02-30 is not one). */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1900 || year > 2100) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** Parses `YYYY-MM-DD` into a real calendar day, or `null` for any other string. */
export function parseDateOnly(value: string): CalendarDate | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isRealDate(year, month, day) ? { year, month, day } : null;
}

/** True when the string is a real calendar day in `YYYY-MM-DD`. */
export function isValidDateOnly(value: string): boolean {
  return parseDateOnly(value) !== null;
}

/** `YYYY-MM-DD` for a calendar day (the exact unit the API validates). */
export function formatDateOnly(date: CalendarDate): string {
  return (
    `${String(date.year).padStart(4, '0')}` +
    `-${String(date.month).padStart(2, '0')}` +
    `-${String(date.day).padStart(2, '0')}`
  );
}

/**
 * Weekday of the first of the month, `0` = Sunday … `6` = Saturday.
 * UTC-based so the answer is the same on every device.
 */
export function firstDayWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/**
 * The fixed 6×7 = 42-cell grid for one month. `null` marks a cell that
 * belongs to the neighbouring month, so the layout is stable across months
 * (no jumping row count) and only real days of `month` are selectable.
 */
export function monthGrid(year: number, month: number): Array<CalendarDate | null> {
  const cells: Array<CalendarDate | null> = Array.from({ length: 42 }, () => null);
  if (daysInMonth(year, month) === 0) return cells;
  const start = firstDayWeekday(year, month);
  const count = daysInMonth(year, month);
  for (let index = 0; index < count; index += 1) {
    cells[start + index] = { year, month, day: index + 1 };
  }
  return cells;
}

/** Adds `delta` months (may be negative), carrying the year over. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/**
 * True when `month` of `year` contains at least one day inside the inclusive
 * `[minDate, maxDate]` window (either bound `null` = unbounded on that side).
 * Powers the calendar's month picker: a month with no selectable day is
 * offered disabled, never tappable.
 */
export function monthOverlapsRange(
  year: number,
  month: number,
  minDate: string | null,
  maxDate: string | null,
): boolean {
  const lastDay = daysInMonth(year, month);
  if (lastDay === 0) return false;
  if (minDate && compareDateOnly(formatDateOnly({ year, month, day: lastDay }), minDate) < 0) {
    return false;
  }
  if (maxDate && compareDateOnly(formatDateOnly({ year, month, day: 1 }), maxDate) > 0) {
    return false;
  }
  return true;
}

/** True when `year` contains at least one day inside the inclusive window. */
export function yearOverlapsRange(
  year: number,
  minDate: string | null,
  maxDate: string | null,
): boolean {
  if (!Number.isInteger(year)) return false;
  if (minDate && compareDateOnly(formatDateOnly({ year, month: 12, day: 31 }), minDate) < 0) {
    return false;
  }
  if (maxDate && compareDateOnly(formatDateOnly({ year, month: 1, day: 1 }), maxDate) > 0) {
    return false;
  }
  return true;
}

/**
 * Order two `YYYY-MM-DD` strings as calendar days (-1 / 0 / 1).
 * Returns 0 when either side is not a real date — unparseable values are
 * never ordered, they are simply not comparable.
 */
export function compareDateOnly(a: string, b: string): number {
  const left = parseDateOnly(a);
  const right = parseDateOnly(b);
  if (!left || !right) return 0;
  const byYear = left.year - right.year;
  if (byYear !== 0) return byYear < 0 ? -1 : 1;
  const byMonth = left.month - right.month;
  if (byMonth !== 0) return byMonth < 0 ? -1 : 1;
  const byDay = left.day - right.day;
  return byDay < 0 ? -1 : byDay > 0 ? 1 : 0;
}
