import type { StopResponse } from '@school-bus-tracking/shared-types';
import type { ConnectionState, LiveFix } from '../tracking/useLiveTripTracking';

/** One point of the driven-path line, oldest first. */
export interface MapTrailPoint {
  latitude: number;
  longitude: number;
}

/**
 * Opt-in camera buttons (crew console). When present, a "Fit route" button
 * is always visible and the existing follow control uses `followBusLabel`.
 * Callers that omit this keep the exact previous behaviour and wording.
 */
export interface MapCameraControls {
  fitRouteLabel: string;
  followBusLabel: string;
}

export interface MapViewProps {
  fix: LiveFix | null;
  stops?: StopResponse[];
  highlightStopId?: string | null;
  /**
   * The stop the bus should head to now — rendered enlarged (`.stop-marker.next`).
   * Separate from `highlightStopId` on purpose: parent pages highlight a
   * child's home stop (green `current`), the crew page highlights the route's
   * next stop; the two must not fight over one prop.
   */
  nextStopId?: string | null;
  /**
   * GPS breadcrumb of the path the bus has actually driven, oldest first.
   * Rendered as its own (green) line so it can never be confused with the
   * straight planned line between stops. Omitted = no trail layer at all.
   */
  trail?: readonly MapTrailPoint[];
  /** Opt-in "Fit route" / "Follow bus" buttons; omitted = previous behaviour. */
  controls?: MapCameraControls;
  /**
   * Socket state, so the map can label a position "offline" independently of
   * how fresh the GPS is. Defaults to `offline` — the conservative reading for
   * a caller that has not wired it up.
   */
  connection?: ConnectionState;
  /**
   * Called when the map's failure **verdict** changes — `null` means "nothing
   * is wrong (any more)".
   *
   * Deliberately not "called on every error": MapLibre raises `error` for a
   * single 404 tile and for any request aborted by a pan, and wiring those
   * straight to a red badge is what made a working map claim it had failed.
   * `map-error-policy.ts` owns the decision; the caller only renders what it
   * is handed, and clears the badge on its own when this reports `null`.
   */
  onMapError?: (report: MapErrorReport | null) => void;
}

/** What the surface should say about the map right now. */
export interface MapErrorReport {
  /** Ready-to-render copy — softened while the map is still retrying. */
  message: string;
  /** True only once the map has genuinely given up (render it red). */
  terminal: boolean;
  /**
   * Untranslated engine codes (`style:404`, `tile:openmaptiles`, …), oldest
   * first, so a field screenshot can name what failed even though the copy
   * stays calm.
   */
  codes: readonly string[];
}
