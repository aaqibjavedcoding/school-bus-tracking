import {
  RouteAssignmentRole,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
  type TripTrackingState,
} from '@school-bus-tracking/shared-types';

/**
 * Formatting helpers for the mobile app.
 *
 * Everything renders device-local times with manual formatting (no
 * `toLocaleString`) so output is deterministic across Hermes/JSC and testable
 * under `node --test`. The only exception is `utcDateOnly`, which mirrors the
 * web helper: the API's `date` trip filter is defined on UTC calendar days.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
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

const pad = (part: number): string => String(part).padStart(2, '0');

/** UTC calendar day (`YYYY-MM-DD`) — the unit the trips `date` filter uses. */
export function utcDateOnly(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * ISO-8601 UTC instant from a `YYYY-MM-DDTHH:mm` local value — the exact
 * mirror of the web `fromDateTimeLocalValue`, so both clients send the API
 * identical payloads.
 */
export function fromDateTimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

/** Device-local time, e.g. "4:05 PM" (deterministic 12-hour clock). */
export function formatTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const suffix = hours24 < 12 ? 'AM' : 'PM';
  return `${hours12}:${pad(date.getMinutes())} ${suffix}`;
}

/** Device-local date, e.g. "Fri, Aug 29". */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Device-local date + time, e.g. "Fri, Aug 29 · 4:05 PM". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const time = formatTime(value);
  const day = formatDate(value);
  return time === '—' || day === '—' ? '—' : `${day} · ${time}`;
}

/** Coarse relative age of a timestamp: "Just now", "12s ago", "3m ago", … */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return 'No GPS yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const delta = now - date.getTime();
  if (delta < 5_000) return 'Just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return formatDateTime(value);
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

/** Approximate ETA label: "~3 minutes"; null when unknown (never invented). */
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

/** Parent-facing boarding label: PENDING/null → "Not boarded". */
export function boardingStatusLabel(status: TripAttendanceStatus | null | undefined): string {
  switch (status) {
    case TripAttendanceStatus.BOARDED:
      return 'Boarded';
    case TripAttendanceStatus.DROPPED:
      return 'Dropped';
    default:
      return 'Not boarded';
  }
}

/** Tone for status badges, shared by every screen that renders one. */
export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export function tripStatusTone(status: TripStatus): Tone {
  switch (status) {
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

export function attendanceTone(status: TripAttendanceStatus | null | undefined): Tone {
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
    case UserRole.SUPER_ADMIN:
      return 'Platform admin';
    case UserRole.SCHOOL_ADMIN:
      return 'School admin';
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
