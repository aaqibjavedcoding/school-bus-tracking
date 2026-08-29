import { TripAttendanceStatus, TripStatus } from '@school-bus-tracking/shared-types';

/** Presentation-only helpers. No business rules live here. */

export function fullName(first?: string | null, last?: string | null): string {
  return (
    [first, last]
      .filter((part) => Boolean(part && part.trim()))
      .join(' ')
      .trim() || 'Unknown'
  );
}

/** Today in UTC `YYYY-MM-DD` — the exact format `GET /trips?date=` expects. */
export function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${formatDateLabel(iso)} ${formatTime(iso)}`;
}

/** Whole minutes → `12 min`, `1 h 05 min`; null-safe because the API never invents an ETA. */
export function formatEtaMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return 'ETA unavailable';
  if (minutes < 1) return 'arriving';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

export function formatDistanceMeters(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatSpeedKmh(speed: number | null | undefined): string {
  if (speed === null || speed === undefined) return '—';
  return `${Math.round(speed)} km/h`;
}

export function formatAccuracy(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  return `±${Math.round(meters)} m`;
}

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  [TripStatus.SCHEDULED]: 'Scheduled',
  [TripStatus.BOARDING]: 'Boarding',
  [TripStatus.IN_PROGRESS]: 'In progress',
  [TripStatus.COMPLETED]: 'Completed',
  [TripStatus.CANCELLED]: 'Cancelled',
};

export function attendanceStatusLabelFor(status: string): string {
  const labels: Record<string, string> = {
    [TripAttendanceStatus.PENDING]: 'Waiting',
    [TripAttendanceStatus.BOARDED]: 'On board',
    [TripAttendanceStatus.DROPPED]: 'Dropped off',
  };
  return labels[status] ?? status;
}

export const ATTENDANCE_STATUS_LABELS: Record<TripAttendanceStatus, string> = {
  [TripAttendanceStatus.PENDING]: 'Waiting',
  [TripAttendanceStatus.BOARDED]: 'On board',
  [TripAttendanceStatus.DROPPED]: 'Dropped off',
};

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function tripStatusTone(status: TripStatus): BadgeTone {
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

export function attendanceStatusTone(status: TripAttendanceStatus): BadgeTone {
  switch (status) {
    case TripAttendanceStatus.PENDING:
      return 'neutral';
    case TripAttendanceStatus.BOARDED:
      return 'success';
    case TripAttendanceStatus.DROPPED:
      return 'info';
    default:
      return 'neutral';
  }
}

/** Compact one-line summary of an accepted GPS fix for driver status rows. */
/** Anything position-shaped: the live socket fix, the REST latest fix, … */
export interface FixLike {
  latitude: number;
  longitude: number;
  speed?: number | null;
  recorded_at: string;
}

export function formatFixLine(fix: FixLike | null): string {
  if (!fix) return 'No position yet';
  return `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)} · ${formatSpeedKmh(fix.speed)} · ${formatTime(fix.recorded_at)}`;
}
