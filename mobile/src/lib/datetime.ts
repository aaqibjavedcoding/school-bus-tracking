/**
 * Pure `datetime-local` helpers shared by the mobile forms.
 *
 * They mirror the web app's `toDateTimeLocalValue` / `fromDateTimeLocalValue`
 * so both clients hold the exact same `YYYY-MM-DDTHH:mm` form state and send
 * the API the exact same ISO instant. Kept dependency-free so they can be
 * unit-tested under `node --test`.
 */

const pad = (part: number): string => String(part).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` for a Date in device-local time. */
export function toDateTimeLocalValue(date: Date): string {
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

/** ISO-8601 UTC instant from a local `YYYY-MM-DDTHH:mm` value. */
export function fromDateTimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

/**
 * School-timezone wall-clock helpers.
 *
 * The dispatcher types a *school-local* wall time ("the bus leaves at 07:30
 * school time"), but `new Date(value)` interprets a `YYYY-MM-DDTHH:mm` string
 * in the **device** timezone. When the two differ — a phone still on UTC, an
 * admin travelling — the trip silently lands in another school-local day:
 * scheduled "for today", stored as yesterday, and invisible on the driver's
 * "today" screen. Interpreting the wall clock in the **school's** IANA
 * timezone removes the whole bug class; the device behaviour above remains
 * the fallback when no usable school timezone is known.
 */

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock fields of `instant` in `timeZone`. Throws for bad IANA names. */
function wallPartsInTimeZone(instant: number, timeZone: string): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type)?.value;
    return part === undefined ? Number.NaN : Number(part);
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24, // some engines report midnight as hour 24
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` at `instant`, in ms: wall-clock-as-UTC minus UTC. */
function timeZoneOffsetMs(instant: number, timeZone: string): number {
  const wall = wallPartsInTimeZone(instant, timeZone);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - instant
  );
}

function isUsableTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * ISO-8601 UTC instant for a `YYYY-MM-DDTHH:mm` wall time read on the
 * **school's** clock — identical to {@link fromDateTimeLocalValue} when the
 * device already sits in the school timezone, so on-site staff see no change.
 */
export function fromSchoolDateTimeLocalValue(value: string, timeZone?: string | null): string {
  if (!isUsableTimeZone(timeZone)) {
    return new Date(value).toISOString();
  }
  try {
    const [datePart, timePart = '00:00'] = value.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour = 0, minute = 0] = timePart.split(':').map(Number);
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    // Guess the instant with the offset at the wall time, then refine once —
    // the offset at the guessed instant can differ across a DST transition.
    let instant = wallAsUtc - timeZoneOffsetMs(wallAsUtc, timeZone);
    instant = wallAsUtc - timeZoneOffsetMs(instant, timeZone);
    return new Date(instant).toISOString();
  } catch {
    // Malformed input keeps the legacy device interpretation; the shared
    // Zod schema and the server reject genuinely invalid values anyway.
    return new Date(value).toISOString();
  }
}

/**
 * `YYYY-MM-DDTHH:mm` wall time of `date` on the **school's** clock — the
 * mirror of {@link fromSchoolDateTimeLocalValue}, used by the "Now" shortcut.
 */
export function toSchoolDateTimeLocalValue(date: Date, timeZone?: string | null): string {
  if (!isUsableTimeZone(timeZone)) {
    return toDateTimeLocalValue(date);
  }
  try {
    const wall = wallPartsInTimeZone(date.getTime(), timeZone);
    return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
  } catch {
    return toDateTimeLocalValue(date);
  }
}

/**
 * Shifts a wall-clock `YYYY-MM-DDTHH:mm` value by `minutes` staying inside
 * the wall-clock domain (UTC arithmetic on the naive fields), so the "+30
 * min"/"+1 hour" shortcuts never depend on any timezone at all.
 */
export function shiftDateTimeLocalValue(value: string, minutes: number): string {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0] = timePart.split(':').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute) + minutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
