import type { ParentChildRunSummary } from '@school-bus-tracking/shared-types';

/**
 * Parent-facing one-liner for the child's run (bus sign copy):
 * `Run R-02 · 07:15–08:05 · Bus 7 · Priya M`.
 *
 * Pure + exported for the unit spec; mirrors the web app's
 * `childRunHeadline` but stays on mobile's terser "one line, no wrapping"
 * card style. `null` when the child has no run at all — the caller then
 * renders the legacy stop/route line.
 */
export function runSummaryLine(run: ParentChildRunSummary | null | undefined): string | null {
  if (!run) return null;
  const pieces = [`Run ${run.code}`];
  const window = shiftWindow(run);
  if (window) pieces.push(window);
  const bus = run.bus_number ?? run.registration_number;
  if (bus) pieces.push(bus);
  if (run.driver_name) pieces.push(run.driver_name);
  return pieces.join(' · ');
}

/** `HH:MM–HH:MM` from the run's shift window, or null when unshifted. */
export function shiftWindow(run: Pick<ParentChildRunSummary, 'shift_start_time' | 'shift_end_time'>): string | null {
  const start = trimToMinutes(run.shift_start_time);
  const end = trimToMinutes(run.shift_end_time);
  return start && end ? `${start}–${end}` : null;
}

function trimToMinutes(time: string | null): string | null {
  if (!time) return null;
  const [hour, minute] = time.split(':');
  return hour !== undefined && minute !== undefined ? `${hour}:${minute}` : null;
}
