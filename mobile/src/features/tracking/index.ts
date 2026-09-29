export { useLiveTripTracking } from './useLiveTripTracking';
export type { ConnectionState, LiveFix } from './useLiveTripTracking';
export { ConnectionIndicator } from './ConnectionIndicator';
export { EtaSummaryCard, StopsEtaList } from './EtaViews';
// R2 stops-list honesty: what the run actually did at each stop.
export {
  crewSkipReasonByStopId,
  deriveStopServiceStates,
  skippedStopNoteForCard,
  SKIPPED_NOTE_NEXT_STOP_WINDOW,
} from './stop-service-state';
export type { StopServiceState, SkippedStopNote } from './stop-service-state';
