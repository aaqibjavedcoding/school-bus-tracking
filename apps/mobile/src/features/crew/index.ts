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
export { TripStatusActions } from './TripStatusActions';
export { ManifestList } from './ManifestList';
export { CREW_LOCATION_TASK, stopCrewLocationTask, pushCrewDeviceFix } from './location-task';
export { SosPanel } from './SosPanel';
export type { SosPanelProps } from './SosPanel';
export { TripNavigationCard } from './TripNavigationCard';
export type { TripNavigationCardProps } from './TripNavigationCard';
export { navigationTargetOf, pickNextStop } from './navigation-stop';
