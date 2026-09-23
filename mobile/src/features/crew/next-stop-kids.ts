/**
 * "Kids at next stop" derivation — pure, React-free, pinned by
 * `next-stop-kids.spec.ts`.
 *
 * The conductor's one job at a stop is knowing who gets on or off there. The
 * manifest screen has everyone (and lives behind its own tap); this summary is
 * the *next-stop* slice of it for the trip screen, shared by both roles — the
 * card drops the old `isDriver` gate so the conductor sees the same heads-up
 * the driver does.
 *
 * Windowing follows the panel-data pattern (`KID_ROW_WINDOW`): a stop with 40
 * kids must not push the SOS row three screens down, so the card shows the
 * first 8 names and a "+N more" line, with the true total always stated.
 *
 * The stop identity comes from the **server-authoritative** `next_stop`
 * (`TripEtaResponse.next_stop`, derived from the progress frontier since batch
 * 3A) — the client never guesses which stop is next.
 */
import type {
  TripAttendanceStatus,
  TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import { fullName } from '../../lib/format.ts';

/** Names listed before the "+N more" line (panel-data windowing). */
export const KID_ROW_WINDOW = 8;

export interface NextStopKid {
  studentId: string;
  name: string;
  status: TripAttendanceStatus;
}

export interface NextStopKidsSummary {
  stopId: string;
  stopName: string;
  sequenceNumber: number;
  /** At most `KID_ROW_WINDOW` kids, in manifest order (stop, then name). */
  kids: NextStopKid[];
  /** Every assigned kid at this stop — the number the count line states. */
  total: number;
  /** `total - kids.length`, for the "+N more" line. */
  hiddenCount: number;
}

/**
 * Slices the trip manifest to the next stop. `null` exactly when there is no
 * next stop (the card renders its "no upcoming stop" state). A stop missing
 * from `stops` still summarises from the student rows' own stop fields.
 */
export function summarizeNextStopKids(
  students: readonly TripStudentAttendanceResponse[],
  stops: ReadonlyArray<{ id: string; name: string; sequence_number: number }>,
  nextStopId: string | null,
): NextStopKidsSummary | null {
  if (nextStopId === null) return null;
  const atStop = students.filter((student) => student.stop_id === nextStopId);
  const stop = stops.find((candidate) => candidate.id === nextStopId) ?? null;
  const kids: NextStopKid[] = atStop.map((student) => ({
    studentId: student.student_id,
    name: fullName(student),
    status: student.status,
  }));
  return {
    stopId: nextStopId,
    stopName: stop?.name ?? atStop[0]?.stop_name ?? '',
    sequenceNumber: stop?.sequence_number ?? atStop[0]?.stop_sequence_number ?? 0,
    kids: kids.slice(0, KID_ROW_WINDOW),
    total: kids.length,
    hiddenCount: Math.max(0, kids.length - KID_ROW_WINDOW),
  };
}
