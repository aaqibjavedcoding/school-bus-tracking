import {
  TripEtaResponse,
  TripLocationResponse,
  TripStopEta,
} from '@school-bus-tracking/shared-types';
import { getTripTrackingState } from '@school-bus-tracking/validation';
import { Stop, Trip, TripStopArrival } from '../../database/models';
import { ETA_ARRIVALS_REPOSITORY, ETA_CONFIG, ETA_STOPS_REPOSITORY } from './eta.constants';
import {
  cumulativeStopDistancesMeters,
  effectiveSpeedKmh,
  etaMinutesForDistance,
  sanitizeSpeedKmh,
} from './geo.util';

/** Environment-backed tuning of the ETA calculation (see `config/`). */
export interface EtaConfig {
  /** Speed (km/h) assumed when the device reports no usable speed. */
  fallbackSpeedKmh: number;
  /** Lower clamp of the effective speed (km/h). */
  minSpeedKmh: number;
  /** Upper clamp of the effective speed (km/h). */
  maxSpeedKmh: number;
}

/**
 * The structural shape of one GPS fix the ETA is computed from — both the
 * ORM row (`TripLocation`) and the public projection
 * (`TripLocationResponse`) satisfy it, so callers can pass either.
 */
export interface EtaLocationFix {
  id: string;
  school_id: string;
  trip_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  recorded_at: Date | string;
  received_at: Date | string;
}

/** Inputs of one ETA computation; stops/arrivals may be preloaded by callers. */
export interface TripEtaComputeInput {
  /** The already-authorized trip (tenant resolution happened upstream). */
  trip: Pick<Trip, 'id' | 'school_id' | 'route_id' | 'status'>;
  /** Latest accepted GPS fix of the trip, or `null` while it has never moved. */
  latest: EtaLocationFix | null;
  /** Ordered route stops (preloaded by the arrival pipeline to avoid a re-read). */
  stops?: Stop[];
  /** Existing arrival rows of the trip (preloaded by the arrival pipeline). */
  arrivals?: TripStopArrival[];
}

/**
 * Task 22 — approximate, GPS-based ETA for the upcoming stops of a trip.
 *
 * The ETA is deliberately simple and honest:
 *
 * - distance = Haversine straight-line metres along the ordered stop
 *   polyline (bus → next stop → following stops) — **not** road routing;
 * - speed = the device speed when it is positive, otherwise the configured
 *   fallback, clamped to an operational band;
 * - ETA = distance ÷ speed, rounded up to whole minutes.
 *
 * Without a GPS fix the service returns `eta_available: false` and never
 * fabricates a distance or an ETA. The service performs no authorization
 * itself: it is always fed a trip that the caller (controller, arrival
 * pipeline, parent portal) has already resolved inside the caller's tenant.
 */
export class EtaService {
  constructor(
    private readonly stops: typeof Stop,
    private readonly arrivals: typeof TripStopArrival,
    private readonly config: EtaConfig,
  ) {}

  /** Computes the full ETA/progress response for an already-authorized trip. */
  async computeTripEta(input: TripEtaComputeInput): Promise<TripEtaResponse> {
    const { trip, latest } = input;
    const stops = input.stops ?? (await this.loadRouteStops(trip));
    const arrivals = input.arrivals ?? (await this.loadArrivals(trip));

    const arrivalStopIds = new Set(arrivals.map((arrival) => arrival.stop_id));

    // Current stop: the highest-sequence stop that already recorded an
    // arrival. Next stop: the first not-yet-reached stop in route order.
    let currentStop: Stop | null = null;
    let nextStop: Stop | null = null;
    for (const stop of stops) {
      if (arrivalStopIds.has(stop.id)) {
        currentStop = stop;
      } else if (nextStop === null) {
        nextStop = stop;
      }
    }

    const speed = latest !== null ? effectiveSpeedKmh(latest.speed, this.config) : null;
    const speedSource: TripEtaResponse['speed_source'] =
      latest === null ? null : sanitizeSpeedKmh(latest.speed) !== null ? 'gps' : 'fallback';

    // Straight-line polyline distances from the bus through the unarrived
    // stops (in route order); arrived stops carry no distance/ETA.
    const unarrivedStops = stops.filter((stop) => !arrivalStopIds.has(stop.id));
    const distances =
      latest !== null
        ? cumulativeStopDistancesMeters(
            { latitude: latest.latitude, longitude: latest.longitude },
            unarrivedStops,
          )
        : unarrivedStops.map(() => null);

    const distanceByStopId = new Map<string, number | null>();
    unarrivedStops.forEach((stop, index) => distanceByStopId.set(stop.id, distances[index]));

    const items: TripStopEta[] = stops.map((stop) => {
      const arrived = arrivalStopIds.has(stop.id);
      const distance = arrived ? null : (distanceByStopId.get(stop.id) ?? null);
      const etaMinutes =
        !arrived && distance !== null && speed !== null
          ? etaMinutesForDistance(distance, speed)
          : null;
      return {
        stop_id: stop.id,
        stop_name: stop.name,
        sequence_number: stop.sequence_number,
        distance_meters: arrived ? null : roundMeters(distance),
        eta_minutes: etaMinutes,
        arrived,
      };
    });

    const currentStopId = currentStop?.id ?? null;
    const nextStopId = nextStop?.id ?? null;

    return {
      trip_id: trip.id,
      school_id: trip.school_id,
      trip_status: trip.status,
      tracking_state: getTripTrackingState(trip.status),
      latest: latest !== null ? toLocationResponse(latest) : null,
      speed_kmh: speed,
      speed_source: speedSource,
      current_stop: currentStopId
        ? (items.find((item) => item.stop_id === currentStopId) ?? null)
        : null,
      next_stop: nextStopId ? (items.find((item) => item.stop_id === nextStopId) ?? null) : null,
      items,
      eta_available: latest !== null,
    };
  }

  /** Ordered stops of the trip's route inside the trip's tenant. */
  private async loadRouteStops(
    trip: Pick<Trip, 'id' | 'school_id' | 'route_id' | 'status'>,
  ): Promise<Stop[]> {
    return this.stops.findAll({
      where: { school_id: trip.school_id, route_id: trip.route_id },
      order: [['sequence_number', 'ASC']],
    });
  }

  /** Existing arrival rows of the trip inside the trip's tenant. */
  private async loadArrivals(
    trip: Pick<Trip, 'id' | 'school_id' | 'route_id' | 'status'>,
  ): Promise<TripStopArrival[]> {
    return this.arrivals.findAll({
      where: { school_id: trip.school_id, trip_id: trip.id },
      order: [['arrived_at', 'ASC']],
    });
  }
}

/** Meters are surfaced as whole metres; null stays null (never invented). */
function roundMeters(distance: number | null): number | null {
  return distance === null ? null : Math.round(distance);
}

/** Explicit projection — ORM internals never leak into a response. */
export function toLocationResponse(location: EtaLocationFix): TripLocationResponse {
  const toIso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return {
    id: location.id,
    school_id: location.school_id,
    trip_id: location.trip_id,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy ?? null,
    speed: location.speed ?? null,
    heading: location.heading ?? null,
    recorded_at: toIso(location.recorded_at),
    received_at: toIso(location.received_at),
  };
}
