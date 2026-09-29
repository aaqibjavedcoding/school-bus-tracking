import { useEffect } from 'react';
import type { TripStopSkippedEvent } from '@school-bus-tracking/shared-types';
import { feedback } from './crew-feedback.ts';
import { SkippedStopAnnouncer } from './skip-announcer.ts';

/**
 * React glue for the R2 skip announcements — one announcer for both crew
 * roles, exactly like `useNextStopAnnouncements.ts`.
 *
 * The announcer is a module-level singleton for the same reason `feedback`
 * is: it holds *state across renders* — which stops have already been spoken
 * — and a per-mount instance would re-speak the current skip every time the
 * crew member switches tabs and comes back. The trip id inside the event is
 * what scopes it: a new run starts over.
 *
 * The server already broadcasts `trip:stop:skipped` exactly once per stop;
 * the announcer's memory is the second net (reconnects, remounts, and any
 * future server change must not be able to double-speak a run).
 *
 * Everything else is the dispatcher's job. `feedback.on(...)` gates on the
 * Voice switch, applies the 600 ms floor and latest-wins, resolves the
 * phrase in the active locale and voice mode, and cannot throw — so this
 * hook has no error handling to get wrong.
 */
const announcer = new SkippedStopAnnouncer();

/** What the trip screen already has; nothing here is fetched again. */
export interface SkippedStopAnnouncementSource {
  tripId: string | null;
  /** The latest `trip:stop:skipped` broadcast of this trip (null before any). */
  event: TripStopSkippedEvent | null;
}

/**
 * Speaks "Stop {number} skipped — not served" once per passed stop.
 *
 * Runs only when the broadcast changes: a skip is rare, edge-triggered news,
 * not a level the screen polls.
 */
export function useSkippedStopAnnouncements(source: SkippedStopAnnouncementSource): void {
  const { tripId, event } = source;

  useEffect(() => {
    // The trip scoping lives inside the announcer (the event carries its own
    // trip_id); a null tripId with a stale event must not speak.
    if (tripId === null) return;
    if (event === null || event.trip_id !== tripId) return;
    const feedbackEvent = announcer.observe(event);
    // A bare statement, never awaited: an announcement must not be able to
    // slow down or fail the screen that observed it.
    if (feedbackEvent !== null) feedback.on(feedbackEvent);
  }, [tripId, event]);
}
