import type { StopResponse } from '@school-bus-tracking/shared-types';
import type { ConnectionState, LiveFix } from '../tracking/useLiveTripTracking';

export interface MapViewProps {
  fix: LiveFix | null;
  stops?: StopResponse[];
  highlightStopId?: string | null;
  /**
   * Socket state, so the map can label a position "offline" independently of
   * how fresh the GPS is. Defaults to `offline` — the conservative reading for
   * a caller that has not wired it up.
   */
  connection?: ConnectionState;
}
