import type {
  TripEtaResponse,
  TripStopArrivalResponse,
  TripStopSkippedEvent,
} from '@school-bus-tracking/shared-types';

/**
 * Per-stop service state for the crew's stops list (deep-fix R2) — pure,
 * React-free, native-free.
 *
 * ### The honesty problem this solves
 *
 * Before R2 a stop the run passed without serving showed up in the stops
 * list as an ordinary upcoming stop forever — "waiting for GPS", then
 * nothing — while the school's parents were already calling. The list now
 * says what actually happened, in the only vocabulary the data supports:
 *
 * - **served** — an arrival row without a `skip_reason` (geofence or a
 *   crew "Arrived" mark): the bus stopped there;
 * - **crew-skipped** — an arrival row WITH a `skip_reason`: a person decided
 *   to skip it, and the reason is school record;
 * - **skipped** — NO row at all, and the progress frontier is already beyond
 *   it: the run passed it without serving (the R2 defect — the same
 *   derivation the server broadcasts `trip:stop:skipped` from);
 * - **upcoming** — everything else.
 *
 * ### Why derivation, not a stored flag
 *
 * "Skipped" is not a fact anyone writes down; it is the absence of a row
 * under a frontier that has moved on. Deriving it here (from the live ETA +
 * the arrival rows) means the list can never disagree with the record it is
 * derived from, needs no new server field, and stays correct on a screen
 * opened mid-run. This is presentation-only: nothing here feeds back into
 * tracking, marking, or the frontier (the same display-never-feeds-back
 * invariant the arrival-zone indicator follows).
 *
 * The inputs are the exact responses the screens already hold — nothing is
 * fetched for this — so the whole behaviour is table-testable under
 * `node --test`.
 */

/** What the run actually did at one stop. */
export type StopServiceState = 'served' | 'crew-skipped' | 'skipped' | 'upcoming';

/**
 * The service state of every stop in the ETA summary.
 *
 * An unknown eta yields an empty map (every stop then renders exactly as it
 * did before R2 — the derivation is additive, never a new failure mode).
 */
export function deriveStopServiceStates(
  eta: TripEtaResponse | null,
  arrivals?: readonly TripStopArrivalResponse[] | null,
): Map<string, StopServiceState> {
  const states = new Map<string, StopServiceState>();
  if (!eta) return states;

  const rowByStopId = new Map<string, TripStopArrivalResponse>();
  for (const row of arrivals ?? []) {
    if (!rowByStopId.has(row.stop_id)) rowByStopId.set(row.stop_id, row);
  }

  // The frontier: the highest sequence the run has reached (reached —
  // current_stop is "the most recently reached stop", and a crew skip is a
  // row, so it counts). Null before the first arrival: nothing can be
  // "passed" yet.
  const frontier = eta.current_stop?.sequence_number ?? 0;

  for (const stop of eta.items) {
    const row = rowByStopId.get(stop.stop_id);
    if (row && row.skip_reason !== null) {
      states.set(stop.stop_id, 'crew-skipped');
    } else if (row || stop.arrived) {
      states.set(stop.stop_id, 'served');
    } else if (stop.sequence_number < frontier) {
      states.set(stop.stop_id, 'skipped');
    } else {
      states.set(stop.stop_id, 'upcoming');
    }
  }
  return states;
}

/**
 * How far past a skip the run may be for the navigation card to keep
 * reminding the crew about it, in stop positions.
 *
 * The voice line covers the moment the skip is detected; the card note is
 * the reminder for the window where acting on it (doubling back, calling the
 * school) is still a live decision. Once the run is further along it is
 * history, and history lives in the stops list — the note must not linger
 * next to "Stop 7 of 8" all afternoon because stop 2 was passed at 07:00.
 */
export const SKIPPED_NOTE_NEXT_STOP_WINDOW = 2;

/** The note to render on the navigation card, if any. */
export interface SkippedStopNote {
  /** The passed stop's position on the route (what the voice line says too). */
  sequenceNumber: number;
  stopName: string;
}

/**
 * The last skip broadcast, reduced to a card note.
 *
 * Shown only while the run's next stop is still within
 * {@link SKIPPED_NOTE_NEXT_STOP_WINDOW} positions after the skipped stop —
 * derived purely from the event and the current ETA, so it needs no timers
 * or dismissal state: the ETA stream that follows the bus retires the note
 * on its own. A note without a next stop (end of the run) or without a
 * usable sequence number is dropped: a line that says "Stop  skipped" is
 * worse than no line.
 */
export function skippedStopNoteForCard(
  event: TripStopSkippedEvent | null,
  nextStopSequence: number | null,
  window: number = SKIPPED_NOTE_NEXT_STOP_WINDOW,
): SkippedStopNote | null {
  if (event === null) return null;
  const sequenceNumber = event.sequence_number;
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) return null;
  if (nextStopSequence === null || !Number.isInteger(nextStopSequence)) return null;
  if (nextStopSequence - sequenceNumber > window) return null;
  return { sequenceNumber, stopName: event.stop_name };
}

/**
 * The crew's own skip reasons, by stop id (first row wins — a stop is marked
 * once per trip; the guard is only there so a replayed sync cannot flip the
 * reason mid-screen).
 *
 * Separate from {@link deriveStopServiceStates} on purpose: the state machine
 * answers "what happened", this answers "and why did a person choose it" —
 * the two have different consumers (the badge vs the reason line) and the
 * state map stays a plain enum a spec can deepEqual.
 */
export function crewSkipReasonByStopId(
  arrivals?: readonly TripStopArrivalResponse[] | null,
): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const row of arrivals ?? []) {
    if (row.skip_reason !== null && !reasons.has(row.stop_id)) {
      reasons.set(row.stop_id, row.skip_reason);
    }
  }
  return reasons;
}
