import type { TripStopArrivedEvent } from '@school-bus-tracking/shared-types';
import type { CrewFeedbackEvent } from './crew-voice.ts';

/**
 * Server-arrival announcement policy — pure, React-free and native-free.
 *
 * The arrival engine is the authority on when a GPS-equipped bus reached a
 * stop. This policy turns that broadcast into one crew-feedback fact per stop
 * per trip; `crew-voice.ts` chooses the active locale/voice-mode phrase and
 * `crew-feedback.ts` owns the Voice switch, 600 ms floor and latest-wins
 * dispatch. Keeping the edge memory here makes reconnects and re-renders
 * harmless without making the client infer arrivals from GPS itself.
 *
 * Manual crew marks intentionally do not pass through. Their broadcast has
 * both coordinates set to `null`, and `useCrewStopMark.ts` has already spoken
 * the local `stop.recorded` receipt after the API confirms it. Speaking this
 * event too would double-confirm one tap and would also open the manifest out
 * from under a crew member who has already chosen their workflow.
 *
 * `TripStopArrivedEvent` has no manifest count. The emitted event therefore
 * carries `studentCount: 0` as an explicit "unknown" value. The voice layer
 * treats that count as optional and says the stop-name fact only; it never
 * invents a manifest count or fetches a stale one solely to make speech.
 */
export class ArrivedStopAnnouncer {
  private tripId: string | null = null;
  /** GPS-arrival stops already reported for the current trip. */
  private readonly announcedStopIds = new Set<string>();

  /**
   * Return the server GPS-arrival fact that is new to the crew, or `null`.
   *
   * The method is deliberately tolerant of payloads crossing a socket
   * boundary: an invalid trip, stop or name is never allowed to make feedback
   * throw. A new trip resets the per-trip set so a later run on the same route
   * can announce the same stop id again.
   */
  observe(event: TripStopArrivedEvent | null): CrewFeedbackEvent | null {
    if (event === null) return null;
    if (typeof event.trip_id !== 'string' || event.trip_id.trim().length === 0) return null;

    if (event.trip_id !== this.tripId) {
      this.reset();
      this.tripId = event.trip_id;
    }

    // The shared event contract explicitly reserves null/null coordinates for
    // crew-marked arrivals. Their local receipt is already `stop.recorded`.
    if (event.latitude === null && event.longitude === null) return null;

    if (typeof event.stop_id !== 'string' || event.stop_id.trim().length === 0) return null;
    if (this.announcedStopIds.has(event.stop_id)) return null;

    const stopName = typeof event.stop_name === 'string' ? event.stop_name.trim() : '';
    if (stopName.length === 0) return null;

    this.announcedStopIds.add(event.stop_id);
    return { type: 'stop.arrived', stopName, studentCount: 0 };
  }

  /** Forget the run's edge memory (new trip, logout or explicit teardown). */
  reset(): void {
    this.tripId = null;
    this.announcedStopIds.clear();
  }
}
