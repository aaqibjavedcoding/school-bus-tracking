import { GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS } from '@school-bus-tracking/shared-types';

/**
 * The map's honest answer to "is this position live?"
 *
 * ### Why this exists
 *
 * `ConnectionState` (`live` / `reconnecting` / `offline`) describes the
 * **socket**, and `ConnectionIndicator` already renders it. It is not, and
 * must never be read as, a statement about the GPS: a socket can be perfectly
 * connected to a room that has not received a fix in ten minutes, because the
 * crew's phone went into a basement, ran out of battery, or the headless task
 * stopped. Conflating the two is exactly the failure mode
 * `docs/mobile-tracking-reliability.md` §"Honest status reporting" removed from
 * the crew side, and the observer side has to hold the same line.
 *
 * So the map shows **two independent facts**:
 *
 * 1. the socket state, via the existing `ConnectionIndicator`;
 * 2. GPS freshness, derived here from the age of the newest fix the server
 *    actually delivered.
 *
 * ### Reused, not reinvented
 *
 * The windows come from `@school-bus-tracking/shared-types`
 * (`GPS_LIVE_WINDOW_MS` = 30 s, `GPS_STALE_WINDOW_MS` = 120 s), which both this
 * app and the web console import, so there is exactly one definition of "live"
 * in the product. The crew controller imports the *same* constants, so the
 * observer and the driver can never disagree about the same bus — and neither is
 * wired to the other's module: delivery freshness, local-fix freshness and
 * observer freshness stay three separate concepts (see `tracking-status.ts`).
 * The 50 m accuracy line matches `gpsSignalTier` in `src/lib/geo.ts`, which
 * already calls that "weak".
 */

/** Age at which a delivered fix stops being "live" and becomes "stale". */
export const LIVE_WINDOW_MS = GPS_LIVE_WINDOW_MS;
/** Age at which a delivered fix stops being "stale" and becomes "outdated". */
export const STALE_WINDOW_MS = GPS_STALE_WINDOW_MS;

/**
 * Accuracy radius beyond which the map must stop implying a precise position.
 * Same line `gpsSignalTier` uses for "weak"; the marker is still drawn, but the
 * uncertainty is stated and an accuracy circle is offered instead of silence.
 */
export const ACCURACY_APPROXIMATE_METERS = 50;

/**
 * Largest accuracy radius worth drawing as a circle.
 *
 * A 5 km circle on a 280 dp map is a solid orange screen, not information. Past
 * this the uncertainty is communicated in words instead.
 */
export const ACCURACY_CIRCLE_MAX_METERS = 500;

export type GpsFreshness = 'live' | 'stale' | 'outdated';

export type LocationState =
  /** No fix at all for this trip. */
  | 'no-location'
  /** A fix exists and is inside the live window. */
  | 'live'
  /** A fix exists but nothing recent — show it, labelled as last known. */
  | 'stale'
  /** A fix exists and is old enough that "last known" needs a timestamp. */
  | 'outdated';

export interface TrackingPresentationInput {
  /** `received_at` age of the newest delivered fix, in ms. `null` if none. */
  fixAgeMs: number | null;
  /** Device-reported accuracy radius in metres, or `null` if not reported. */
  accuracyMeters: number | null;
  /** True when the socket is currently disconnected. */
  socketOffline: boolean;
}

export interface TrackingPresentation {
  state: LocationState;
  freshness: GpsFreshness | null;
  /**
   * The only flag that may drive travel animation. A stale position is frozen
   * and labelled — a marker that keeps sliding while the label says "last
   * known" is the exact lie this module exists to prevent.
   */
  animate: boolean;
  /** True when the position must be labelled "last known". */
  lastKnown: boolean;
  /** True when the copy must not claim a precise road position. */
  approximate: boolean;
  /**
   * True when speed and direction may be described as current. Reporting
   * "34 km/h" next to a four-minute-old fix describes a moment that has passed.
   */
  mayReportLiveMotion: boolean;
  /** Radius to draw as an uncertainty circle, or `null` to draw none. */
  accuracyCircleMeters: number | null;
  /** True when the socket is down — the label says so independently of GPS. */
  socketOffline: boolean;
}

/** Freshness bucket for a fix age, using the app-wide windows. */
export function gpsFreshness(fixAgeMs: number | null): GpsFreshness | null {
  if (fixAgeMs === null || !Number.isFinite(fixAgeMs)) return null;
  if (fixAgeMs <= LIVE_WINDOW_MS) return 'live';
  if (fixAgeMs <= STALE_WINDOW_MS) return 'stale';
  return 'outdated';
}

/**
 * Derives everything the map needs to say about a position from facts only.
 *
 * Note what is *not* an input: the socket state does not soften or sharpen the
 * freshness verdict. A disconnected socket with a 5 s-old fix is `live` GPS
 * over an offline socket, and the two labels say exactly that.
 */
export function deriveTrackingPresentation(input: TrackingPresentationInput): TrackingPresentation {
  const freshness = gpsFreshness(input.fixAgeMs);
  const accuracy =
    typeof input.accuracyMeters === 'number' &&
    Number.isFinite(input.accuracyMeters) &&
    input.accuracyMeters >= 0
      ? input.accuracyMeters
      : null;

  if (freshness === null) {
    return {
      state: 'no-location',
      freshness: null,
      animate: false,
      lastKnown: false,
      approximate: false,
      mayReportLiveMotion: false,
      accuracyCircleMeters: null,
      socketOffline: input.socketOffline,
    };
  }

  const live = freshness === 'live';
  return {
    state: freshness,
    freshness,
    animate: live,
    lastKnown: !live,
    approximate: accuracy !== null && accuracy > ACCURACY_APPROXIMATE_METERS,
    mayReportLiveMotion: live,
    accuracyCircleMeters:
      accuracy !== null &&
      accuracy > ACCURACY_APPROXIMATE_METERS &&
      accuracy <= ACCURACY_CIRCLE_MAX_METERS
        ? accuracy
        : null,
    socketOffline: input.socketOffline,
  };
}
