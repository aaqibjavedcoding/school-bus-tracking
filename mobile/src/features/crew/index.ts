/**
 * Shared crew feature (DRIVER + CONDUCTOR).
 *
 * Both roles run exactly these screens on one architecture: the API scopes
 * `GET /trips` to the caller's own runs and authorizes both crew roles for
 * attendance, status transitions and GPS emission, so nothing here branches
 * on the role except small labels.
 *
 * Task 44 adds the two role-flavoured panels — `SosPanel` (identical for
 * both: an emergency is an emergency) and `TripNavigationCard` (driver-only,
 * because it is about driving) — plus the pure stop-selection helpers they
 * rest on.
 */
export {
  pickCrewTrip,
  nextCrewTransitions,
  transitionLabel,
  manifestCounts,
  groupManifestByStop,
  isTripOpen,
} from './crew-trip';
export type { ManifestStopGroup } from './crew-trip';
export { useCrewToday } from './useCrewToday';
export type { CrewTodayData } from './useCrewToday';
export { useCrewLocationSharing, isTripShareable } from './useCrewLocationSharing';
export type { CrewLocationSharing, PermissionState } from './useCrewLocationSharing';
export { transitionActionMeta, attendanceActionMeta } from './crew-action-meta';
export type { CrewActionMeta, CrewActionTone, CrewActionIcon } from './crew-action-meta';
export { TripStatusActions } from './TripStatusActions';
export { ManifestList } from './ManifestList';
export { StatusCard } from './StatusCard';
export { GpsShareStrip } from './GpsShareStrip';
export { GpsSharePanel } from './GpsSharePanel';
export { HoldToConfirmButton } from './HoldToConfirmButton';
export { SosPanel, SosQuickPanel, SosStatusLine, useCrewSos } from './SosPanel';
export type { SosPanelProps } from './SosPanel';
export { TripNavigationCard } from './TripNavigationCard';
export type { TripNavigationCardProps } from './TripNavigationCard';
export { navigationTargetOf, pickNextStop } from './navigation-stop';
export { tripStatusStyle, primaryTripAction } from './trip-status-style';
export { crewCopy } from './crew-copy';
/**
 * Phase 3b — voice + haptics. `feedback.on(...)` is the ONLY entry point a
 * surface needs: it reports what happened and the dispatcher decides how it
 * is expressed (see `crew-feedback.ts`).
 */
export { feedback, defaultSoundSettings } from './crew-feedback';
export type { SoundSettings } from './crew-feedback';
export type { CrewFeedbackEvent } from './crew-voice';
export { FeedbackProvider, useSoundSettings } from './FeedbackProvider';
export { SoundSettingsCard } from './SoundSettingsCard';
