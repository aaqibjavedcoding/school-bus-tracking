import { useCallback } from 'react';
import type { BusResponse, RouteResponse, TripResponse } from '@school-bus-tracking/shared-types';
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
 * scheduled, else the latest finished one for review. Routes and buses are
 * loaded once for labels.
 */
export interface CrewTodayData {
  date: string;
  trips: TripResponse[];
  trip: TripResponse | null;
  route: RouteResponse | null;
  bus: BusResponse | null;
  routes: RouteResponse[];
  buses: BusResponse[];
}

export function useCrewToday() {
  const load = useCallback(async (): Promise<CrewTodayData> => {
    const [tripsEnvelope, routesEnvelope, busesEnvelope] = await Promise.all([
      apiClient.listTrips({ page: 1, limit: 25, date: utcDateOnly() }),
      apiClient.listRoutes({ page: 1, limit: 100 }).catch(() => null),
      apiClient.listBuses({ page: 1, limit: 100 }).catch(() => null),
    ]);

    const trips = unwrapEnvelope(tripsEnvelope).items;
    const routes = routesEnvelope ? unwrapEnvelope(routesEnvelope).items : [];
    const buses = busesEnvelope ? unwrapEnvelope(busesEnvelope).items : [];
    const trip = pickCrewTrip(trips);

    return {
      date: utcDateOnly(),
      trips,
      trip,
      route: trip ? (routes.find((route) => route.id === trip.route_id) ?? null) : null,
      bus: trip && trip.bus_id ? (buses.find((bus) => bus.id === trip.bus_id) ?? null) : null,
      routes,
      buses,
    };
  }, []);

  return useLoad<CrewTodayData>(load, []);
}
