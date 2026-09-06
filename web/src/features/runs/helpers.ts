import type {
  ParentChildSummary,
  RunResponse,
  StudentResponse,
  TripResponse,
} from '@school-bus-tracking/shared-types';

/**
 * Pure display/formatting helpers for the runs & shifts UI
 * (`docs/operating-model.md` Phase 3).
 *
 * Everything here is a total function over API projections — no fetching, no
 * JSX — so the pickers across trips dispatch, the student form and the
 * route detail panel share one formatting truth that is fully unit-spec'd.
 */

/** `HH:MM:SS` → `HH:MM`; anything unparseable renders as an empty string. */
export function trimSeconds(time: string | null | undefined): string {
  if (!time) return '';
  const [hh, mm] = time.split(':');
  return hh && mm ? `${hh}:${mm}` : '';
}

/** The run's clock label: its shift window, or the whole-day legacy note. */
export function shiftWindowLabel(
  run: Pick<RunResponse, 'shift_name' | 'shift_start_time' | 'shift_end_time'>,
): string {
  const start = trimSeconds(run.shift_start_time);
  const end = trimSeconds(run.shift_end_time);
  const window = start && end ? `${start}–${end}` : '';
  if (!run.shift_name && !window) return 'All day (no shift)';
  return [run.shift_name, window].filter(Boolean).join(' ');
}

/** One-line description of a run for selects and list rows. */
export function runLabel(run: RunResponse): string {
  const parts = [
    run.code,
    run.route_name ? `${run.route_code ? `${run.route_code} · ` : ''}${run.route_name}` : null,
    run.bus_number ?? run.bus_registration_number ?? 'No bus',
    shiftWindowLabel(run),
  ];
  if (run.is_default) parts.push('default');
  return parts.filter(Boolean).join(' · ');
}

/**
 * Candidate runs for the dispatch picker: active runs only — the API refuses
 * an inactive run, and listing it only manufactures a failed save. Sorted by
 * route code then run code so a route's runs cluster in time-agnostic order.
 */
export function dispatchableRuns(runs: RunResponse[]): RunResponse[] {
  return [...runs]
    .filter((run) => run.is_active)
    .sort((a, b) =>
      `${a.route_code ?? ''}|${a.code}`.localeCompare(`${b.route_code ?? ''}|${b.code}`),
    );
}

/**
 * The runs offered to a student's home stop: only runs of the stop's route,
 * active only, defaults first (a pre-refactor family lands on the familiar
 * single-bus view), then by code. An empty `routeId` (no home stop yet)
 * yields no options — allocation follows the stop, never the other way.
 */
export function runsForHomeStop(runs: RunResponse[], routeId: string | null): RunResponse[] {
  if (!routeId) return [];
  return [...runs]
    .filter((run) => run.is_active && run.route_id === routeId)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.code.localeCompare(b.code));
}

/**
 * Whether the student form must drop a stale run: when the home stop moved to
 * another route, the previously selected run is no longer offered — callers
 * clear `run_id` when this returns `true`.
 */
export function runStaleForRoute(
  run: RunResponse | null | undefined,
  routeId: string | null,
): boolean {
  if (!run) return false;
  return routeId !== null && run.route_id !== routeId;
}

/** The run badge shown next to a dispatched trip. */
export function tripRunBadge(trip: TripResponse): string | null {
  return trip.run_code ?? null;
}

/** Compact student-list run label (`R-01 · Bus 7`), or `null` when unallocated. */
export function studentRunLabel(student: StudentResponse): string | null {
  if (!student.run_code) return null;
  return student.bus_number ? `${student.run_code} · ${student.bus_number}` : student.run_code;
}

/**
 * The parent-facing headline for a child: exact bus + run, falling back to
 * the legacy route view when the school has not modelled runs yet. Never
 * blank — a parent always gets *something* true about today.
 */
export function childRunHeadline(child: ParentChildSummary): string {
  const run = child.run;
  if (run) {
    const bus = [run.bus_number, run.registration_number].filter(Boolean).join(' · ');
    const pieces = [`Run ${run.code}`, bus || 'Bus not assigned', shiftWindowLabel(run)];
    if (!run.is_default) pieces.push(run.route_name ?? '');
    return pieces.filter(Boolean).join(' · ');
  }
  const bus = child.today.bus?.bus_number ?? child.today.bus?.registration_number;
  const route = child.home_stop.route_name ?? child.home_stop.route_code;
  return [bus ?? 'No bus assigned', route].filter(Boolean).join(' · ');
}

/** Shift row label for pickers (`Morning 07:00–11:00`). */
export function shiftLabel(shift: {
  name: string;
  start_time: string;
  end_time: string;
}): string {
  const start = trimSeconds(shift.start_time);
  const end = trimSeconds(shift.end_time);
  return start && end ? `${shift.name} (${start}–${end})` : shift.name;
}

/** `HH:MM`/`HH:MM:SS` → minutes since midnight; `null` when unparseable. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m, sec] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m + (sec === undefined ? 0 : sec / 60);
}

/**
 * Client-side window-overlap preview used by the run editor to warn (not
 * block — the API owns the verdict, service and DB included) when a new run
 * would share a bus with an overlapping shift window. Mirrors §4.1 with the
 * same half-open semantics as `run-conflicts.ts`.
 */
export function windowsOverlapPreview(
  a: { start_time: string | null; end_time: string | null },
  b: { start_time: string | null; end_time: string | null },
): boolean {
  const aStart = timeToMinutes(a.start_time) ?? 0;
  const aEnd = timeToMinutes(a.end_time) ?? 24 * 60;
  const bStart = timeToMinutes(b.start_time) ?? 0;
  const bEnd = timeToMinutes(b.end_time) ?? 24 * 60;
  return aStart < bEnd && bStart < aEnd;
}
