import type { CrewFeedbackEvent } from './crew-voice.ts';

/**
 * Next-stop announcement policy (batch 3C) — pure, React-free, native-free.
 *
 * Decides **when** the bus should say where it is going. What it says is
 * `crew-voice.ts` (`voice.stop.next` / `voice.stop.approaching`, in the active
 * locale and the active voice mode), and saying it is `crew-feedback.ts`.
 * This module only turns a stream of snapshots into at most one event per
 * fact — the same pure-policy/native-seam split the rest of the feedback
 * layer uses, so the whole behaviour is table-testable under `node --test`.
 *
 * ### Two triggers, one sentence each
 *
 * - **the next stop changed** — the server's progress frontier moved
 *   (`eta.next_stop.stop_id`, authoritative since batch 3A; the client never
 *   guesses which stop is next);
 * - **the bus is nearly there** — the same stop, said again when the ETA or
 *   the distance crosses a threshold, because "next stop" announced eight
 *   minutes ago is not the thing a conductor needs with the doors about to
 *   open.
 *
 * If a stop is *already* close when it first becomes next, only the
 * "approaching" line is spoken: hearing "Next stop: X" immediately followed by
 * "Approaching X" says one thing twice.
 *
 * ### Why it never repeats itself
 *
 * Both triggers are edge-based, not level-based: a fact is announced when it
 * becomes true, then remembered. An ETA push arrives every few seconds and the
 * distance changes on each one, so a level-triggered announcer would talk
 * continuously. The memory is two stop ids — one per fact, per stop — and it
 * is dropped when the trip changes, so a second run on the same route still
 * announces its first stop.
 *
 * ### What it will not announce
 *
 * - a stop whose **count is still loading**. "Next stop: X, 0 students" for
 *   "we have not asked yet" is a lie a conductor acts on, so the snapshot says
 *   `countKnown: false` until the manifest slice settles and the announcement
 *   simply waits for the next observation;
 * - a stop with **no name**. An unnamed stop cannot be announced usefully, and
 *   the sentence would be "Next stop: , 5 students".
 *
 * Timing is deliberately not this module's job: the dispatcher's
 * `VoiceThrottle` already owns the 600 ms floor and latest-wins, so a
 * next-stop line can never talk over a boarding burst and never queues behind
 * one.
 */

/** Minutes of ETA at which "next stop" becomes "approaching". */
export const APPROACHING_ETA_MINUTES = 2;

/**
 * Metres at which it does, whether or not the ETA produced minutes.
 *
 * Two triggers on purpose: `eta_minutes` is null without a GPS fix and is
 * rounded *up* to whole minutes, so a stop 350 m away can read as "1 minute"
 * or as nothing at all. Distance is the signal that survives both.
 */
export const APPROACHING_DISTANCE_M = 400;

/**
 * Ceiling on a spoken count.
 *
 * A bus stop has tens of children, never thousands — this exists so a corrupt
 * payload cannot become a six-digit number, which `isSpeakable` would (rightly)
 * reject and silently drop the whole announcement.
 */
export const MAX_SPOKEN_STUDENTS = 999;

/** The only two events this announcer can produce. */
export type NextStopAnnouncementEvent = Extract<
  CrewFeedbackEvent,
  { type: 'stop.next' } | { type: 'stop.approaching' }
>;

/** One observation of the trip's next stop, from server-authoritative data. */
export interface NextStopSnapshot {
  /** The run being observed; a change starts its announcements over. */
  tripId: string | null;
  /** `eta.next_stop.stop_id` — the server's frontier, never a client guess. */
  stopId: string | null;
  stopName: string;
  /** Children assigned to this stop, as the "kids at next stop" card counts them. */
  studentCount: number;
  /** False while that count is in flight — see the module doc. */
  countKnown: boolean;
  etaMinutes: number | null;
  distanceMeters: number | null;
}

/** Is the bus close enough that the crew should hear it again? */
export function isApproaching(snapshot: NextStopSnapshot): boolean {
  const { etaMinutes, distanceMeters } = snapshot;
  if (etaMinutes !== null && etaMinutes >= 0 && etaMinutes <= APPROACHING_ETA_MINUTES) return true;
  return distanceMeters !== null && distanceMeters >= 0 && distanceMeters <= APPROACHING_DISTANCE_M;
}

/** A count safe to put on a speaker: whole, non-negative, capped. */
export function spokenStudentCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.trunc(count), MAX_SPOKEN_STUDENTS);
}

/**
 * The edge-triggered state machine. Two remembered stop ids, no timers, no
 * clock — every input is a snapshot, so a whole run can be replayed in a spec.
 */
export class NextStopAnnouncer {
  private tripId: string | null = null;
  /** The stop "next stop" was already said for. */
  private announcedStopId: string | null = null;
  /** The stop "approaching" was already said for. */
  private approachingStopId: string | null = null;

  /**
   * The event to report, or `null` when this observation is not news.
   * Never throws: an announcement is reporting, and reporting must not be able
   * to break the screen that triggered it.
   */
  observe(snapshot: NextStopSnapshot): NextStopAnnouncementEvent | null {
    if (snapshot.tripId !== this.tripId) {
      this.reset();
      this.tripId = snapshot.tripId;
    }

    const stopId = snapshot.stopId;
    if (stopId === null || snapshot.tripId === null) return null;
    if (!snapshot.countKnown) return null;
    const stopName = snapshot.stopName.trim();
    if (stopName.length === 0) return null;

    const approaching = isApproaching(snapshot);

    if (stopId !== this.announcedStopId) {
      this.announcedStopId = stopId;
      // Close already: say the urgent line and remember both facts, so the
      // same stop is not announced twice within a second.
      if (approaching) this.approachingStopId = stopId;
      return announcement(approaching ? 'stop.approaching' : 'stop.next', stopName, snapshot);
    }

    if (approaching && this.approachingStopId !== stopId) {
      this.approachingStopId = stopId;
      return announcement('stop.approaching', stopName, snapshot);
    }

    return null;
  }

  /** Forget everything (trip change, logout, screen teardown of a run). */
  reset(): void {
    this.tripId = null;
    this.announcedStopId = null;
    this.approachingStopId = null;
  }
}

function announcement(
  type: NextStopAnnouncementEvent['type'],
  stopName: string,
  snapshot: NextStopSnapshot,
): NextStopAnnouncementEvent {
  // The payload is a stop name and an aggregate count. There is no student
  // field in it, so `SPOKEN_STUDENT_FIELDS` ("first_name" only) still holds
  // for every event the voice layer can express.
  return { type, stopName, studentCount: spokenStudentCount(snapshot.studentCount) };
}
