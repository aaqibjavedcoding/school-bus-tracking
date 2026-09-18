/**
 * Phase 1 (notification hardening) — run-aware ridership helpers.
 *
 * One route can carry several runs (tiering: the same stops served by
 * different vehicles at different times), so "the child rides this trip" is
 * a run question, not just a route question. These pure helpers encode the
 * single allocation rule every recipient/visibility decision must apply:
 *
 * - the trip's run is its explicit `run_id`, falling back to the route's
 *   default run for legacy `NULL`-run trips, falling back to `null` when the
 *   route has no runs at all;
 * - a student with an explicit `run_id` rides exactly that run;
 * - a student without a `run_id` (unallocated / legacy) rides the route's
 *   default run;
 * - when the trip resolves to `null` (route without runs) every route
 *   student rides — there is nothing to narrow on.
 *
 * `LiveTrackingService.hasLinkedChildOnTrip` (parent observation) and
 * `NotificationsService` (stop-arrival + trip-status recipients) both derive
 * from these helpers, so observation visibility and notification recipients
 * can never drift apart. See `docs/operating-model.md` §6.
 */

/** Normalises a possibly-absent run id to `string | null`. */
export function normalizeRunId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The run a trip executes: explicit when dispatched from a run, otherwise
 * the route's default run (a legacy `NULL`-run dispatch), otherwise `null`
 * when the route has no runs at all.
 */
export function resolveTripRunId(
  tripRunId: string | null | undefined,
  defaultRunId: string | null | undefined,
): string | null {
  return normalizeRunId(tripRunId) ?? normalizeRunId(defaultRunId) ?? null;
}

/**
 * True when a student rides a trip that resolved to `tripRunId` on a route
 * whose default run is `defaultRunId`. Unallocated students ride the default
 * run; on a run-less route (`tripRunId === null`) every student rides.
 */
export function studentRidesTripRun(
  studentRunId: string | null | undefined,
  tripRunId: string | null | undefined,
  defaultRunId: string | null | undefined,
): boolean {
  const trip = normalizeRunId(tripRunId);
  if (trip === null) {
    return true; // route without any runs: nothing to narrow on
  }
  const student = normalizeRunId(studentRunId);
  if (student !== null) {
    return student === trip;
  }
  // Unallocated child → rides the default run.
  const fallback = normalizeRunId(defaultRunId);
  return fallback !== null && trip === fallback;
}
