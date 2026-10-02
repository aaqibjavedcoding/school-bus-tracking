import {
  RouteAssignmentRole,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
  type TripTrackingState,
} from '@school-bus-tracking/shared-types';

export function utcDateOnly(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar day in the school's timezone (or the device timezone as fallback). */
export function schoolDateOnly(timeZone?: string | null, date = new Date()): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      // A stale or unsupported timezone falls back to the device's calendar.
    }
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

export function formatSpeedKmh(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value)} km/h`;
}

/** Human distance: "650 m" below a kilometre, otherwise "1.2 km". */
export function formatDistanceMeters(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value < 1000) return `${Math.max(0, Math.round(value))} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

/** Approximate ETA label: "~3 minutes" (or "~1 minute"); null when unknown. */
export function formatEtaMinutes(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `~${value} ${value === 1 ? 'minute' : 'minutes'}`;
}

export function fullName(person: { first_name: string; last_name: string }): string {
  return `${person.first_name} ${person.last_name}`.trim();
}

/** Stable user-facing stop identifier; UUIDs remain the persisted/API identity. */
export function stopCode(routeCode: string, sequenceNumber: number): string {
  return `${routeCode}-${String(sequenceNumber).padStart(3, '0')}`;
}

/**
 * Platform display currency for this India-focused deployment (ISO 4217).
 *
 * Prices stay *per record*: every plan and subscription carries its own
 * `currency` code and is rendered with it. This constant is only used where
 * the UI has to pick something before any record exists — the "Create plan"
 * form default, and a missing/blank currency on a row — so a rupee is never
 * swapped for a dollar and no amount is ever converted.
 */
export const PLATFORM_CURRENCY = 'INR';

/**
 * Formats a price in the record's own currency, in major units.
 *
 * Rupee amounts use `en-IN` so they get Indian digit grouping
 * (`₹1,99,900.00`, not `₹199,900.00`); every other currency keeps the
 * browser's locale, which is what the console has always done. Falls back to
 * `CODE 12.00` when the runtime has no data for that currency code.
 */
export function formatCurrency(value: number | string, currency?: string | null): string {
  const code = (currency ?? '').trim().toUpperCase() || PLATFORM_CURRENCY;
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return `${code} 0`;
  try {
    return new Intl.NumberFormat(code === PLATFORM_CURRENCY ? 'en-IN' : undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${code} ${num.toFixed(2)}`;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'No GPS yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const delta = Date.now() - date.getTime();
  if (delta < 5_000) return 'Just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return formatDateTime(value);
}

export function initials(person: { first_name: string; last_name: string }): string {
  return `${person.first_name.charAt(0)}${person.last_name.charAt(0)}`.toUpperCase();
}

export function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case TripStatus.SCHEDULED:
      return 'Scheduled';
    case TripStatus.BOARDING:
      return 'Boarding';
    case TripStatus.IN_PROGRESS:
      return 'In Progress';
    case TripStatus.COMPLETED:
      return 'Completed';
    case TripStatus.CANCELLED:
      return 'Cancelled';
    default:
      return status;
  }
}

export function attendanceStatusLabel(status: TripAttendanceStatus): string {
  switch (status) {
    case TripAttendanceStatus.PENDING:
      return 'Waiting';
    case TripAttendanceStatus.BOARDED:
      return 'On board';
    case TripAttendanceStatus.DROPPED:
      return 'Dropped off';
    default:
      return status;
  }
}

/** Parent-facing boarding label: PENDING → "Not boarded", BOARDED → "Boarded". */
export function boardingStatusLabel(status: TripAttendanceStatus | null | undefined): string {
  switch (status) {
    case TripAttendanceStatus.BOARDED:
      return 'Boarded';
    case TripAttendanceStatus.DROPPED:
      return 'Dropped';
    case TripAttendanceStatus.PENDING:
    case null:
    case undefined:
      return 'Not boarded';
    default:
      return 'Not boarded';
  }
}

/** Tone used for the parent-facing boarding badge. */
export function boardingStatusTone(
  status: TripAttendanceStatus | null | undefined,
): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case TripAttendanceStatus.BOARDED:
      return 'info';
    case TripAttendanceStatus.DROPPED:
      return 'success';
    default:
      return 'neutral';
  }
}

export function roleLabel(role: UserRole | RouteAssignmentRole): string {
  switch (role) {
    case UserRole.SCHOOL_ADMIN:
      return 'School admin';
    case UserRole.SUPER_ADMIN:
      return 'Platform admin';
    case UserRole.DRIVER:
      return 'Driver';
    case UserRole.CONDUCTOR:
      return 'Conductor';
    case UserRole.PARENT:
      return 'Parent';
    default:
      return role;
  }
}

export function trackingStateLabel(state: TripTrackingState | null | undefined): string {
  switch (state) {
    case 'active':
      return 'Tracking active';
    case 'stopped':
      return 'Tracking stopped';
    case 'unavailable':
      return 'Not tracking yet';
    default:
      return 'Unknown';
  }
}

export function tripStatusTone(
  status: TripStatus,
): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case TripStatus.SCHEDULED:
      return 'neutral';
    case TripStatus.BOARDING:
      return 'warning';
    case TripStatus.IN_PROGRESS:
      return 'info';
    case TripStatus.COMPLETED:
      return 'success';
    case TripStatus.CANCELLED:
      return 'danger';
    default:
      return 'neutral';
  }
}

export function attendanceTone(
  status: TripAttendanceStatus,
): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case TripAttendanceStatus.PENDING:
      return 'neutral';
    case TripAttendanceStatus.BOARDED:
      return 'info';
    case TripAttendanceStatus.DROPPED:
      return 'success';
    default:
      return 'neutral';
  }
}
