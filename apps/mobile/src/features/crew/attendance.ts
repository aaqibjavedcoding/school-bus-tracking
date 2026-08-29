import {
  TripAttendanceStatus,
  type TripStudentAttendanceResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import type { ApiClient } from '@school-bus-tracking/api-client';
import { ApiClientError } from '@school-bus-tracking/api-client';

/**
 * Crew attendance actions (Task 23 §D — Student Boarding).
 *
 * The backend owns the attendance state machine (PENDING → BOARDED → DROPPED,
 * server clocks, crew authorisation, 409 on duplicates). This module is pure
 * transport + result interpretation:
 *
 * - offline first: while the OS reports no connectivity the request is not
 *   even attempted and the caller is told *clearly* that nothing was recorded
 *   (no silent pretend-success — Task 23 §I);
 * - a successful call returns the server's authoritative row, which the UI
 *   merges into its local manifest copy;
 * - a 409 (duplicate/illegal transition, usually a double-tap or a peer
 *   device acting first) is mapped to a readable message and triggers a
 *   manifest refresh so the UI converges on server truth;
 * - the API endpoints are body-less on purpose; no ids/timestamps/actors are
 *   ever sent from the phone.
 */

export type AttendanceAction = 'board' | 'drop';

export interface AttendanceAttemptResult {
  ok: boolean;
  kind: 'recorded' | 'offline' | 'conflict' | 'error';
  row?: TripStudentAttendanceResponse;
  message?: string;
}

export async function performAttendanceAction(input: {
  api: ApiClient;
  tripId: string;
  studentId: string;
  action: AttendanceAction;
  online: boolean;
}): Promise<AttendanceAttemptResult> {
  const { api, tripId, studentId, action, online } = input;

  if (!online) {
    return {
      ok: false,
      kind: 'offline',
      message:
        'You are offline — nothing was recorded. Reconnect and tap again. (Duplicate protection: the server never saw this action.)',
    };
  }

  try {
    const envelope =
      action === 'board'
        ? await api.boardTripStudent(tripId, studentId)
        : await api.dropTripStudent(tripId, studentId);
    if (!envelope.data) {
      return { ok: false, kind: 'error', message: 'The server did not confirm the action.' };
    }
    return { ok: true, kind: 'recorded', row: envelope.data };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 409) {
      return {
        ok: false,
        kind: 'conflict',
        message:
          'The server rejected this action (already recorded or out of order). The list was refreshed — no duplicate exists.',
      };
    }
    if (error instanceof ApiClientError && error.status === 0) {
      return {
        ok: false,
        kind: 'offline',
        message:
          'The network dropped while sending. Nothing was recorded unless the list refresh shows it.',
      };
    }
    return {
      ok: false,
      kind: 'error',
      message: error instanceof Error ? error.message : 'Attendance update failed.',
    };
  }
}

/**
 * Merge one server-returned attendance row into a manifest copy and recompute
 * the displayed counts. This is presentation arithmetic over data the API
 * already owns — it grants nothing and authorises nothing.
 */
export function mergeAttendanceRow(
  manifest: TripStudentManifestResponse,
  row: TripStudentAttendanceResponse,
): TripStudentManifestResponse {
  const items = manifest.items.map((item) => (item.student_id === row.student_id ? row : item));
  return { ...manifest, items, summary: summarizeManifest(items) };
}

export function summarizeManifest(
  items: TripStudentAttendanceResponse[],
): TripStudentManifestResponse['summary'] {
  const count = (status: TripAttendanceStatus): number =>
    items.filter((item) => item.status === status).length;
  return {
    total: items.length,
    pending: count(TripAttendanceStatus.PENDING),
    boarded: count(TripAttendanceStatus.BOARDED),
    dropped: count(TripAttendanceStatus.DROPPED),
  };
}

/** Group consecutive rows per boarding stop (route order is server-guaranteed). */
export interface ManifestStopGroup {
  stop_id: string;
  stop_name: string;
  sequence: number;
  items: TripStudentAttendanceResponse[];
}

export function groupManifestByStop(items: TripStudentAttendanceResponse[]): ManifestStopGroup[] {
  const groups: ManifestStopGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.stop_id === item.stop_id) {
      last.items.push(item);
    } else {
      groups.push({
        stop_id: item.stop_id,
        stop_name: item.stop_name,
        sequence: item.stop_sequence_number,
        items: [item],
      });
    }
  }
  return groups;
}

/**
 * ── Task 24/25 extension point (deliberate, unused in Task 23) ──────────
 *
 * An offline attendance queue will enqueue `AttendanceAttemptInput` records
 * here when `online === false`, replaying them on reconnect with an
 * idempotency key and reconciling through the same 409 path. It is *not*
 * implemented now: silently buffering attendance risks duplicate/illegal
 * records, and Task 23 forbids pretending actions succeeded.
 */
export interface OfflineAttendanceQueue {
  enqueue(record: {
    tripId: string;
    studentId: string;
    action: AttendanceAction;
    attemptedAt: string;
  }): void;
  drain(): Promise<void>;
}
