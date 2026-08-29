import {
  TripAttendanceStatus,
  TripStatus,
  type TripResponse,
  type TripStudentAttendanceResponse,
  type TripStudentManifestSummary,
} from '@school-bus-tracking/shared-types';
import { TRIP_STATUS_TRANSITIONS, isTripOpenForAttendance } from '@school-bus-tracking/validation';

/**
 * Pure crew-trip selectors shared by the DRIVER and CONDUCTOR screens (and
 * unit-tested under node). Everything here works on data the API already
 * returned — no client-side trip lifecycle logic beyond presenting it.
 */

const byStartAsc = (a: TripResponse, b: TripResponse): number =>
  a.scheduled_start_at.localeCompare(b.scheduled_start_at);

/**
 * The crew member's trip of the day from their (server-scoped) trip list.
 *
 * Active runs win (BOARDING, then IN_PROGRESS), then the earliest SCHEDULED
 * run; when everything is already terminal the most recent trip of the day is
 * returned so the crew can review the finished run.
 */
export function pickCrewTrip(items: TripResponse[]): TripResponse | null {
  if (items.length === 0) {
    return null;
  }

  const active = items
    .filter((trip) => trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS)
    .sort(byStartAsc);
  if (active.length > 0) {
    return active[0];
  }

  const scheduled = items.filter((trip) => trip.status === TripStatus.SCHEDULED).sort(byStartAsc);
  if (scheduled.length > 0) {
    return scheduled[0];
  }

  return [...items].sort(byStartAsc).reverse()[0] ?? null;
}

/**
 * Forward lifecycle transitions offered to crew: one step at a time along
 * `SCHEDULED → BOARDING → IN_PROGRESS → COMPLETED`. Cancellation stays a
 * dispatcher action on the web/admin surface, never a one-tap crew button.
 */
export function nextCrewTransitions(status: TripStatus): TripStatus[] {
  return TRIP_STATUS_TRANSITIONS[status].filter((next) => next !== TripStatus.CANCELLED);
}

/** Action label for a forward transition button. */
export function transitionLabel(status: TripStatus): string {
  switch (status) {
    case TripStatus.BOARDING:
      return 'Start boarding';
    case TripStatus.IN_PROGRESS:
      return 'Depart & drive';
    case TripStatus.COMPLETED:
      return 'Complete trip';
    default:
      return status;
  }
}

/** Attendance counts over a manifest slice (same shape as the API summary). */
export function manifestCounts(items: TripStudentAttendanceResponse[]): TripStudentManifestSummary {
  const summary: TripStudentManifestSummary = {
    total: items.length,
    pending: 0,
    boarded: 0,
    dropped: 0,
  };
  for (const item of items) {
    if (item.status === TripAttendanceStatus.BOARDED) summary.boarded += 1;
    else if (item.status === TripAttendanceStatus.DROPPED) summary.dropped += 1;
    else summary.pending += 1;
  }
  return summary;
}

/**
 * Groups the manifest (already ordered by stop sequence server-side) into
 * stop sections so the crew sees who waits at which stop.
 */
export interface ManifestStopGroup {
  stop_id: string;
  stop_name: string;
  stop_sequence_number: number;
  students: TripStudentAttendanceResponse[];
}

export function groupManifestByStop(items: TripStudentAttendanceResponse[]): ManifestStopGroup[] {
  const groups: ManifestStopGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.stop_id === item.stop_id) {
      last.students.push(item);
      continue;
    }
    groups.push({
      stop_id: item.stop_id,
      stop_name: item.stop_name,
      stop_sequence_number: item.stop_sequence_number,
      students: [item],
    });
  }
  return groups;
}

/**
 * True while the trip still accepts attendance changes — the exact shared
 * rule the API enforces (`isTripOpenForAttendance` from
 * `@school-bus-tracking/validation`), re-exported so the UI never drifts.
 */
export const isTripOpen = isTripOpenForAttendance;
