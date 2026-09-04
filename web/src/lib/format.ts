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

export function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string {
  return new Date(value).toISOString();
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

/** Formats a price (in major units, e.g. USD) using the browser's locale. Falls back to simple code+number. */
export function formatCurrency(value: number | string, currency: string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return `${currency} 0`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
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
