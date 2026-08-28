import type { StopResponse } from '@school-bus-tracking/shared-types';
import type { LiveFix } from '../tracking/useLiveTripTracking';

export interface MapViewProps {
  fix: LiveFix | null;
  stops?: StopResponse[];
  highlightStopId?: string | null;
}
