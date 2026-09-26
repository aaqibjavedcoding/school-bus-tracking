/**
 * Pure derivations behind the crew page's next-stop card and stops table.
 *
 * React-free on purpose (pinned together with the URL builders in
 * `navigation.spec.ts`): which stop is next, what state each stop is in and
 * who waits where are exactly the decisions that must never depend on render
 * order or a stale closure.
 *
 * The stop identity is **server-authoritative** where possible: the ETA
 * summary's `next_stop` (progress frontier) wins whenever it is still
 * unserved; the fallback — first stop in route order without an arrival
 * record — only exists for the minutes before the first GPS fix, mirroring
 * mobile's `pickNextStop`.
 */
import {
  TripAttendanceStatus,
  type StopResponse,
  type TripEtaResponse,
  type TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';

/** Names listed on the next-stop card before the "+N more" line. */
export const KID_ROW_WINDOW = 8;

/** Points kept on the driven-path line; older ones fall off the back. */
export const TRAIL_MAX_POINTS = 720;

/** The arrival-record slice these derivations need. */
export interface ArrivalLike {
  stop_id: string;
  skip_reason: string | null;
}

export type CrewStopState = 'arrived' | 'skipped' | 'pending';

/**
 * What the stops table says about one stop. `skipped` wins over `arrived`
 * only in the sense that a skip *is* the stop's arrival record — the server
 * stores one row per stop, so the two never coexist.
 */
export function stopStateOf(
  stopId: string,
  arrivals: readonly ArrivalLike[],
  etaItems?: TripEtaResponse['items'] | null,
): CrewStopState {
  const record = arrivals.find((arrival) => arrival.stop_id === stopId);
  if (record) {
    return record.skip_reason !== null ? 'skipped' : 'arrived';
  }
  // The geofence pipeline can record an arrival the page has not refetched
  // yet — the live ETA summary's `arrived` flag covers that gap.
  const etaItem = etaItems?.find((item) => item.stop_id === stopId);
  return etaItem?.arrived ? 'arrived' : 'pending';
}

/**
 * The stop the driver should head to now, or `null` when every stop is done.
 *
 * Order of trust:
 * 1. the server's `eta.next_stop` while it is still unserved (never behind);
 * 2. otherwise the first stop in route order without an arrival/skip record.
 */
export function deriveNextStop(
  stops: readonly StopResponse[],
  eta: TripEtaResponse | null,
  arrivals: readonly ArrivalLike[],
): StopResponse | null {
  const sorted = [...stops].sort((a, b) => a.sequence_number - b.sequence_number);
  if (sorted.length === 0) {
    return null;
  }
  const served = (stopId: string) => stopStateOf(stopId, arrivals, eta?.items) !== 'pending';

  const serverNextId = eta?.next_stop?.stop_id ?? null;
  if (serverNextId) {
    const serverStop = sorted.find((stop) => stop.id === serverNextId);
    if (serverStop && !served(serverStop.id)) {
      return serverStop;
    }
  }
  return sorted.find((stop) => !served(stop.id)) ?? null;
}

/** 1-based "Stop {position} of {total}" over the route order. */
export function stopCounterOf(
  stops: readonly StopResponse[],
  stopId: string,
): { position: number; total: number } {
  const sorted = [...stops].sort((a, b) => a.sequence_number - b.sequence_number);
  const index = sorted.findIndex((stop) => stop.id === stopId);
  return { position: index >= 0 ? index + 1 : 0, total: sorted.length };
}

export interface StopKidsSummary {
  /** Every assigned kid at this stop — the number the count column states. */
  total: number;
  /** Kids still PENDING (not yet boarded/dropped/absent) — "waiting here". */
  waiting: number;
  /** At most {@link KID_ROW_WINDOW} names of waiting kids, manifest order. */
  waitingNames: string[];
  /** Waiting kids beyond the window, for the "+N more" line. */
  hiddenWaiting: number;
}

/** The manifest slice of one stop — mirrors mobile's `summarizeNextStopKids`. */
export function summarizeStopKids(
  students: readonly TripStudentAttendanceResponse[],
  stopId: string,
): StopKidsSummary {
  const atStop = students.filter((student) => student.stop_id === stopId);
  const waitingKids = atStop.filter((student) => student.status === TripAttendanceStatus.PENDING);
  const names = waitingKids.map((student) => `${student.first_name} ${student.last_name}`.trim());
  return {
    total: atStop.length,
    waiting: waitingKids.length,
    waitingNames: names.slice(0, KID_ROW_WINDOW),
    hiddenWaiting: Math.max(0, names.length - KID_ROW_WINDOW),
  };
}

export interface TrailPoint {
  latitude: number;
  longitude: number;
}

/**
 * Appends a GPS fix to the driven-path line. Pure: returns the same array
 * when nothing changes (duplicate/invalid point) so React state stays stable,
 * and caps the line at {@link TRAIL_MAX_POINTS} so an all-day trip cannot
 * grow memory without bound.
 */
export function appendTrailPoint(
  trail: readonly TrailPoint[],
  point: TrailPoint,
  cap: number = TRAIL_MAX_POINTS,
): readonly TrailPoint[] {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return trail;
  }
  const last = trail[trail.length - 1];
  if (last && last.latitude === point.latitude && last.longitude === point.longitude) {
    return trail;
  }
  const next = [...trail, { latitude: point.latitude, longitude: point.longitude }];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
