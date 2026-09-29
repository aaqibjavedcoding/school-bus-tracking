import type { TripStopSkippedEvent } from '@school-bus-tracking/shared-types';
import type { CrewFeedbackEvent } from './crew-voice.ts';

/**
 * Skipped-stop announcement policy (deep-fix R2) — pure, React-free,
 * native-free.
 *
 * Decides **when** the crew hears that the run passed a stop without serving
 * it. What it says is `crew-voice.ts` (`voice.stop.passed`, in the active
 * locale and voice mode — "Stop 2 skipped — not served"), and saying it is
 * `crew-feedback.ts`. This module only turns the stream of server
 * `trip:stop:skipped` broadcasts into at most one spoken line per stop — the
 * same pure-policy/native-seam split the next-stop announcer uses
 * (`next-stop-announcer.ts`), so the whole behaviour is table-testable under
 * `node --test`.
 *
 * ### Why the server is the only source
 *
 * The client never infers a skip from ETA gaps: "no arrival row and the
 * frontier is beyond it" is exactly the server's derivation
 * (`stopsPassedByFrontier`), and a client-side copy would drift the moment
 * the server rule moves. The server also guarantees the two properties this
 * announcer relies on:
 *
 * - **exactly once per stop** — the server keeps a per-trip announced set, so
 *   a replayed frontier advance never re-broadcasts. This module keeps its
 *   own memory anyway (defence in depth): the socket reconnects, the screen
 *   remounts and a future server change must not be able to make the crew
 *   hear the same skip twice from one run.
 * - **never for the crew's own skip mark** — a stop the crew skipped has an
 *   arrival row, so it is not "unarrived" and is never broadcast. The
 *   crew's own tap already speaks `stop.skipped` locally; without this
 *   server-side rule the same action would speak twice.
 *
 * ### Why it is edge-triggered, not level-triggered
 *
 * The hook re-runs on every render of the trip screen with the latest event;
 * without memory the same broadcast would re-speak on each one. One stop id
 * set per trip is the whole state, dropped when the trip changes so a second
 * run on the same route still speaks.
 */
export class SkippedStopAnnouncer {
  private tripId: string | null = null;
  /** Stops already spoken for the current trip. */
  private readonly announcedStopIds = new Set<string>();

  /**
   * The feedback event to report for this broadcast, or `null` when it is
   * not news (already spoken, no trip, or a corrupt payload with no usable
   * sequence number — the phrase layer would drop a numberless line, so it
   * is dropped here where a spec can see it).
   *
   * Never throws: an announcement is reporting, and reporting must not be
   * able to break the screen that triggered it.
   */
  observe(event: TripStopSkippedEvent | null): CrewFeedbackEvent | null {
    if (event === null) return null;
    if (typeof event.trip_id !== 'string' || event.trip_id.length === 0) return null;

    if (event.trip_id !== this.tripId) {
      this.reset();
      this.tripId = event.trip_id;
    }

    if (this.announcedStopIds.has(event.stop_id)) return null;
    this.announcedStopIds.add(event.stop_id);

    // A numberless line ("Stop  skipped") is dropped here, where a spec can
    // see it, rather than in the phrase layer: the haptic would otherwise
    // buzz for a line nobody can hear or read.
    if (!Number.isInteger(event.sequence_number) || event.sequence_number < 1) return null;
    return { type: 'stop.passed', sequenceNumber: event.sequence_number };
  }

  /** Forget everything (trip change, logout, screen teardown of a run). */
  reset(): void {
    this.tripId = null;
    this.announcedStopIds.clear();
  }
}
