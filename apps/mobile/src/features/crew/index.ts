/**
 * Shared crew feature (DRIVER + CONDUCTOR).
 *
 * Both roles run exactly these screens on one architecture: the API scopes
 * `GET /trips` to the caller's own runs and authorizes both crew roles for
 * attendance, status transitions and GPS emission, so nothing here branches
 * on the role except small labels.
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
