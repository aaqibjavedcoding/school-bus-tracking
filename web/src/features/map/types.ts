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
   * Called when the map's health notice changes.
   *
   * A message string is the text to surface; `null` means "whatever was wrong
   * has cleared, drop the notice". The map decides *whether* something is
   * worth surfacing (see `map-error-policy.ts`): a single 404 tile or a
   * request aborted by a pan never reaches this callback, and a sustained
   * style outage reports "Map tiles unavailable — retrying…" before it ever
   * reports the flat "Map failed to load".
   *
   * Callers must handle `null` — that is the automatic recovery path, and it
   * is what stops a transient blip from pinning a red badge to the screen
   * until someone taps "Retry map".
   */
  onMapError?: (message: string | null) => void;
}
