/**
 * School-timezone wall-clock helpers for the scheduling forms.
 *
 * A `#/trips` dispatcher types a *school-local* wall time ("the bus leaves at
 * 07:30 school time"), but `new Date(value)` interprets a `datetime-local`
 * string in the **device** timezone. Whenever the two differ — a laptop still
 * on UTC, an admin working from another region — the trip silently lands in a
 * different school-local day: dispatched "for today", stored as yesterday,
 * and invisible on the driver's "today" screen. These helpers interpret and
 * render the wall clock in the **school's** IANA timezone instead, falling
 * back to the device behaviour (`fromDateTimeLocalValue`/`toDateTimeLocalValue`
 * in `lib/format`) when no usable timezone is known.
 */

const pad = (part: number): string => String(part).padStart(2, '0');

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
 * **school's** clock. When the device timezone already matches the school's,
 * the result is identical to `fromDateTimeLocalValue` — so nothing changes
 * for on-site staff; only out-of-timezone devices are corrected.
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
 * mirror of {@link fromSchoolDateTimeLocalValue}, used to pre-fill scheduling
 * fields (e.g. "now, at the school").
 */
export function toSchoolDateTimeLocalValue(date: Date, timeZone?: string | null): string {
  if (!isUsableTimeZone(timeZone)) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  try {
    const wall = wallPartsInTimeZone(date.getTime(), timeZone);
    return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
  } catch {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}
