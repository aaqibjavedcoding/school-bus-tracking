import { useEffect } from 'react';
import { feedback } from './crew-feedback.ts';
import { NextStopAnnouncer, type NextStopSnapshot } from './next-stop-announcer.ts';
import type { NextStopKidsSummary } from './next-stop-kids.ts';

/**
 * React glue for the next-stop announcements (batch 3C) — **one announcer for
 * both crew roles**.
 *
 * The driver and the conductor run the same trip screen, so there is exactly
 * one call site and no per-role copy: the role never reaches this module.
 *
 * The announcer is a module-level singleton for the same reason `feedback` is
 * (see `crew-feedback.ts`): it holds *state across renders* — which stops have
 * already been announced — and a per-mount instance would re-announce the
 * current next stop every time the crew member switches tabs and comes back.
 * The trip id inside the snapshot is what scopes it: a new run starts over.
 *
 * Everything else is the dispatcher's job. `feedback.on(...)` gates on the
 * Voice switch, applies the 600 ms floor and latest-wins, resolves the phrase
 * in the active locale and voice mode, and cannot throw — so this hook has no
 * error handling to get wrong.
 */
const announcer = new NextStopAnnouncer();

/** What the trip screen already has; nothing here is fetched again. */
export interface NextStopAnnouncementSource {
  tripId: string | null;
  /** The "kids at next stop" summary — the card's own data, so the two agree. */
  summary: NextStopKidsSummary | null;
  /** False while the manifest slice is in flight (never announce an unknown count as 0). */
  loaded: boolean;
  /** `eta.next_stop` from live tracking; both null without a GPS fix. */
  etaMinutes: number | null;
  distanceMeters: number | null;
}

/**
 * Reports the next stop when it changes and when the bus is nearly there.
 *
 * Runs on every change of the snapshot's *values*: an ETA push arrives every
 * few seconds, and the observation it triggers is a few comparisons that
 * almost always answer "not news". Nothing is spoken, allocated or awaited on
 * the render path.
 */
export function useNextStopAnnouncements(source: NextStopAnnouncementSource): void {
  const { tripId, summary, loaded, etaMinutes, distanceMeters } = source;
  const stopId = summary?.stopId ?? null;
  const stopName = summary?.stopName ?? '';
  const studentCount = summary?.total ?? 0;
  // 0 is the summary's "unknown" fallback (stop missing from the list), not a
  // real position — pass it as unknown so the near line is never a guess.
  const sequenceNumber =
    summary && summary.sequenceNumber >= 1 ? summary.sequenceNumber : null;

  useEffect(() => {
    const snapshot: NextStopSnapshot = {
      tripId,
      stopId,
      stopName,
      studentCount,
      countKnown: loaded,
      etaMinutes,
      distanceMeters,
      sequenceNumber,
    };
    const event = announcer.observe(snapshot);
    // A bare statement, never awaited: an announcement must not be able to
    // slow down or fail the screen that observed it.
    if (event !== null) feedback.on(event);
  }, [tripId, stopId, stopName, studentCount, loaded, etaMinutes, distanceMeters, sequenceNumber]);
}
