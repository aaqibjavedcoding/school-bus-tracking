export { EtaService } from './eta.service';
export type { EtaConfig, EtaLocationFix, TripEtaComputeInput } from './eta.service';
export { StopArrivalsService } from './stop-arrivals.service';
export type { EtaRoomBroadcaster, RecordedStopArrival } from './stop-arrivals.service';
export {
  ETA_ARRIVALS_REPOSITORY,
  ETA_CONFIG,
  ETA_STOPS_REPOSITORY,
  ETA_TRIP_NOT_FOUND_MESSAGE,
} from './eta.constants';
export {
  EARTH_RADIUS_METERS,
  cumulativeStopDistancesMeters,
  effectiveSpeedKmh,
  etaMinutesForDistance,
  haversineMeters,
  sanitizeSpeedKmh,
  toRadians,
} from './geo.util';
