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
