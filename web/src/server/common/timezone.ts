/**
 * Calendar-day helpers for tenant-local operations.
 *
 * Trips are persisted as UTC instants, while schools schedule and filter them
 * by the calendar date in their configured IANA timezone. These helpers turn
 * a tenant-local date into the first UTC instant belonging to that date. A
 * binary search over the local date is used instead of assuming every day is
 * 24 hours, so daylight-saving transitions (including a skipped midnight) are
 * handled correctly.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_WINDOW_MS = 36 * 60 * 60 * 1000;

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** `YYYY-MM-DD` as it appears on the calendar in `timeZone`. */
export function dateOnlyInTimeZone(date: Date, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new RangeError('Could not resolve a calendar date in the requested timezone.');
  }
  return `${year}-${month}-${day}`;
}

/**
 * Human `d MMM yyyy, HH:mm` in `timeZone` — the form operator-facing messages
 * quote a departure in, so a dispatcher in another timezone still reads the
 * school's wall clock. Built from `formatToParts` with a numeric month mapped
 * through a fixed name table (ICU builds disagree on abbreviations — "Sept"
 * vs "Sep" — and an operator message must be stable and testable).
 */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const lookup = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const day = lookup('day');
  const monthNumber = Number(lookup('month'));
  const year = lookup('year');
  const hour = lookup('hour');
  const minute = lookup('minute');
  if (
    !day ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    !year ||
    !hour ||
    !minute
  ) {
    throw new RangeError('Could not resolve a date and time in the requested timezone.');
  }
  // `hourCycle` values above 24:00 are impossible with hour12:false, but the
  // '24' hour of midnight appears on some ICU builds — normalise it.
  const normalizedHour = hour === '24' ? '00' : hour.padStart(2, '0');
  return `${day} ${SHORT_MONTHS[monthNumber - 1]} ${year}, ${normalizedHour}:${minute}`;
}

/**
 * First UTC instant whose tenant-local calendar date is `value` or later.
 *
 * For a normal date this is local midnight. If a jurisdiction skips a whole
 * civil date (a historical dateline change), the start and end boundaries for
 * that date are equal, correctly producing an empty range.
 */
export function startOfDateInTimeZone(value: string, timeZone: string): Date {
  const target = parseDateOnly(value);
  // Constructing the formatter up front validates the IANA timezone and keeps
  // failures deterministic rather than allowing a binary search to loop.
  const formatter = formatterFor(timeZone);
  const localDateAt = (instant: number): string => {
    const parts = formatter.formatToParts(new Date(instant));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) {
      throw new RangeError('Could not resolve a calendar date in the requested timezone.');
    }
    return `${year}-${month}-${day}`;
  };

  const nominalUtcMidnight = Date.UTC(target.year, target.month - 1, target.day);
  let low = nominalUtcMidnight - SEARCH_WINDOW_MS;
  let high = nominalUtcMidnight + SEARCH_WINDOW_MS;

  // Current IANA offsets fit inside ±14 hours. Expanding the bracket also
  // keeps the helper safe for historical timezone transitions.
  while (localDateAt(low) >= value) low -= DAY_MS;
  while (localDateAt(high) < value) high += DAY_MS;

  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDateAt(middle) >= value) high = middle;
    else low = middle;
  }
  return new Date(high);
}

/** Adds civil calendar days to a validated `YYYY-MM-DD`, independent of TZ. */
export function addCalendarDays(value: string, days: number): string {
  const { year, month, day } = parseDateOnly(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Throws for malformed dates rather than letting Date normalize them. */
function parseDateOnly(value: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Date must use YYYY-MM-DD format.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError('Date must be a real calendar date.');
  }
  return { year, month, day };
}
