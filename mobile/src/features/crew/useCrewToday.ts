import { useCallback } from 'react';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { unwrapEnvelope } from '../../lib/errors';
import { utcDateOnly } from '../../lib/format';
import { useLoad } from '../../hooks/useLoad';
import { pickCrewTrip } from './crew-trip';

/**
 * Today's-trip loader for the shared DRIVER/CONDUCTOR experience.
 *
 * The API scopes `GET /trips` to the caller's own runs (the server pins
 * `driver_id`/`conductor_id` from the JWT), so the client only asks for
 * today's list and picks the relevant run — active first, then earliest
 * scheduled, else the latest finished one for review.
 *
 * Route and bus labels come from the trip payload itself: the server
 * enriches every `TripResponse` with `route_code` / `route_name` and
 * `registration_number` / `bus_number`. This loader deliberately does NOT
 * fetch `GET /routes` or `GET /buses` — those list endpoints are
 * school-admin only (least privilege: a crew account must not enumerate the
 * school's fleet and routes), and calling them from the crew app produced a
 * repeated 403 on every driver load.
 */
/** The route label of the crew member's trip, straight from the trip payload. */
export interface CrewTodayRoute {
  code: string;
  name: string;
}

/** The bus label of the crew member's trip, straight from the trip payload. */
export interface CrewTodayBus {
  registration_number: string;
  bus_number: string | null;
}

export interface CrewTodayData {
  date: string;
  trips: TripResponse[];
  trip: TripResponse | null;
  route: CrewTodayRoute | null;
  bus: CrewTodayBus | null;
}

export function useCrewToday() {
  const load = useCallback(async (): Promise<CrewTodayData> => {
    const tripsEnvelope = await apiClient.listTrips({ page: 1, limit: 25, date: utcDateOnly() });

    const trips = unwrapEnvelope(tripsEnvelope).items;
    const trip = pickCrewTrip(trips);

    return {
      date: utcDateOnly(),
      trips,
      trip,
      // Labels are resolved server-side on the trip row; fall back to a blank
      // label rather than a second, role-incompatible request.
      route:
        trip && trip.route_name ? { code: trip.route_code ?? '', name: trip.route_name } : null,
      bus:
        trip && trip.registration_number
          ? { registration_number: trip.registration_number, bus_number: trip.bus_number ?? null }
          : null,
    };
  }, []);

  return useLoad<CrewTodayData>(load, []);
}
