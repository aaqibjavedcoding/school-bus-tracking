import { useEffect } from 'react';
import type { TripStopArrivedEvent } from '@school-bus-tracking/shared-types';
import { feedback } from './crew-feedback.ts';
import { ArrivedStopAnnouncer } from './arrived-stop-announcer.ts';

/**
 * React glue for server GPS-arrival announcements — one announcer for both
 * crew roles, exactly like `useSkippedStopAnnouncements.ts`.
 *
 * The singleton deliberately survives renders and screen remounts. Its
 * per-trip set is the second idempotency net after the server broadcast:
 * reconnects or a resent latest frame must not say a stop name twice.
 *
 * `ArrivedStopAnnouncer` suppresses the null/null-coordinate manual-mark
 * event. That tap already reported its local `stop.recorded` receipt in
 * `useCrewStopMark.ts`; this hook must never turn it into a second line.
 */
const announcer = new ArrivedStopAnnouncer();

/** What the trip screen already has; nothing is fetched again. */
export interface ArrivedStopAnnouncementSource {
  tripId: string | null;
  /** The latest `trip:stop:arrived` broadcast of this trip (null before any). */
  event: TripStopArrivedEvent | null;
}

/**
 * Reports one server GPS arrival per stop through the shared dispatcher.
 *
 * `feedback.on(...)` keeps the established Voice switch, 600 ms throttle,
 * latest-wins behavior and active locale/voice-mode resolution. It is a bare
 * statement because feedback must never delay or fail the trip screen.
 */
export function useArrivedStopAnnouncements(source: ArrivedStopAnnouncementSource): void {
  const { tripId, event } = source;

  useEffect(() => {
    // A stale room frame from the previous run must neither speak nor reset the
    // current trip's edge memory.
    if (tripId === null) return;
    if (event === null || event.trip_id !== tripId) return;
    const feedbackEvent = announcer.observe(event);
    if (feedbackEvent !== null) feedback.on(feedbackEvent);
  }, [tripId, event]);
}
