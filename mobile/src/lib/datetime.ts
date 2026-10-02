/**
 * Pure `datetime-local` helpers shared by the mobile forms.
 *
 * They mirror the web app's `toDateTimeLocalValue` / `fromDateTimeLocalValue`
 * so both clients hold the exact same `YYYY-MM-DDTHH:mm` form state and send
 * the API the exact same ISO instant. Kept dependency-free so they can be
 * unit-tested under `node --test`.
 */

const pad = (part: number): string => String(part).padStart(2, '0');

/**
 * `YYYY-MM-DDTHH:mm` for a Date.
 *
 * With a `timeZone` the wall clock is rendered in that IANA zone — the school
 * the schedule belongs to — so the "Now" quick action fills the school's
 * current time even on a device in another timezone. Without one (legacy
 * sessions) the device-local reading is kept.
 */
export function toDateTimeLocalValue(date: Date, timeZone?: string | null): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const get = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find((item) => item.type === type)?.value ?? '';
      const hour = String(Number(get('hour')) % 24).padStart(2, '0');
      return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
    } catch {
      // A stale or unsupported timezone falls back to the device's clock.
    }
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Splits a `YYYY-MM-DDTHH:mm` value into its date and time halves. */
export function splitDateTimeLocal(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}

export function joinDateTimeLocal(date: string, time: string): string {
  if (!date && !time) return '';
  return `${date}T${time}`;
}

/** True when the string is a real calendar date/time in `YYYY-MM-DDTHH:mm`. */
export function isValidDateTimeLocal(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d, hh, mm] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hours = Number(hh);
  const minutes = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hours > 23 || minutes > 59) return false;
  const probe = new Date(year, month - 1, day, hours, minutes);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day &&
    probe.getHours() === hours &&
    probe.getMinutes() === minutes
  );
}

/** Keeps digits only and re-inserts the `-` separators as the user types. */
export function maskDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(
    (part) => part.length > 0,
  );
  return parts.join('-');
}

/** Keeps digits only and re-inserts the `:` separator as the user types. */
export function maskTime(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

/** `YYYY-MM-DDTHH:mm`, optionally with seconds, as typed into a form field. */
const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * UTC instant of a school-local wall-clock value, or `null` when the value or
 * the timezone cannot be used and the caller must fall back.
 *
 * A `datetime-local` field carries no timezone: it is the wall clock the
 * school operates on, not the one on the admin's device. The instant is found
 * by reading the zone's offset around the value (as if it were UTC) and
 * correcting for it twice, so daylight-saving transitions resolve
 * deterministically — an ambiguous hour keeps a real reading, and a skipped
 * hour lands after the transition.
 *
 * This is the exact mirror of the web app's conversion, so both clients send
 * the API identical payloads for the same form value.
 */
function schoolWallClockToUtc(value: string, timeZone: string): Date | null {
  const match = DATE_TIME_LOCAL.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    // A stale or unsupported timezone falls back to the device's clock.
    return null;
  }

  /** Wall clock of `instant` in the school's timezone, to minute precision. */
  const wallClockAt = (instant: number): string => {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((item) => item.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`;
  };

  /** Offset, in ms, to subtract from the zone's wall clock to get UTC. */
  const offsetAt = (instant: number): number => {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((item) => item.type === type)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - instant;
  };

  const target = value.slice(0, 16);
  const wallAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  // First guess from the offset at the value itself, then refine once with
  // the offset at that guess — the two differ exactly across a transition.
  const first = wallAsUtc - offsetAt(wallAsUtc);
  const refined = wallAsUtc - offsetAt(first);

  // An existing wall time renders back exactly; prefer the refined candidate.
  // A skipped wall time (spring forward) renders on neither, so keep the
  // reading after the transition — the closest real instant to the request.
  const candidates = [refined, first];
  for (const candidate of candidates) {
    if (wallClockAt(candidate) === target) return new Date(candidate);
  }
  const afterTransition = candidates.find((candidate) => wallClockAt(candidate) > target);
  return new Date(afterTransition ?? refined);
}

/**
 * ISO-8601 UTC instant from a `YYYY-MM-DDTHH:mm` form value.
 *
 * The value is interpreted in the school's IANA timezone when one is
 * configured, so a trip scheduled for 2 October 07:00 school time lands on
 * 2 October for every role regardless of the admin's device timezone. When no
 * usable timezone is available the historical device-timezone reading is kept
 * (legacy sessions keep working exactly as before).
 */
export function fromDateTimeLocalValue(value: string, timeZone?: string | null): string {
  const zoned = timeZone ? schoolWallClockToUtc(value, timeZone) : null;
  return zoned ? zoned.toISOString() : new Date(value).toISOString();
}
