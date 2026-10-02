import { useCallback } from 'react';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { unwrapEnvelope } from '../../lib/errors';
import { schoolDateOnly } from '../../lib/format';
import { addCalendarDays } from '../../lib/datetime';
import { useLoad } from '../../hooks/useLoad';
import { mergeTripUpdate, pickCrewTrip, selectCrewTripsForDay } from './crew-trip';

/**
 * Today's-trip loader for the shared DRIVER/CONDUCTOR experience.
 *
 * The API scopes `GET /trips` to the caller's own runs (the server pins
 * `driver_id`/`conductor_id` from the JWT), so the client asks for a
 * two-school-day window — today plus tomorrow — and picks the relevant run:
 * today's active run first, then today's earliest scheduled one, else the
 * latest finished one for review. When today holds nothing at all, the
 * earliest SCHEDULED trip of the window (typically tomorrow morning's run,
 * dispatched the evening before) is picked so the crew sees their next trip
 * instead of a dead screen. See `selectCrewTripsForDay` for the exact rule.
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

/**
 * Derives the screen data from today's (server-scoped) trip list — the one
 * place that picks the trip of the day and reads its labels, shared by the
 * network load and the optimistic update after a lifecycle tap.
 */
export function buildCrewTodayData(date: string, trips: TripResponse[]): CrewTodayData {
  const trip = pickCrewTrip(trips);
  return {
    date,
    trips,
    trip,
    // Labels are resolved server-side on the trip row; fall back to a blank
    // label rather than a second, role-incompatible request.
    route: trip && trip.route_name ? { code: trip.route_code ?? '', name: trip.route_name } : null,
    bus:
      trip && trip.registration_number
        ? { registration_number: trip.registration_number, bus_number: trip.bus_number ?? null }
        : null,
  };
}

export function useCrewToday(timeZone?: string | null) {
  const load = useCallback(async (): Promise<CrewTodayData> => {
    const date = schoolDateOnly(timeZone);
    // Two school-local days in one query: `date_from`/`date_to` are inclusive
    // school-local calendar days on the server, so this window covers trips
    // filed under tomorrow without ever hiding one filed under today.
    const tripsEnvelope = await apiClient.listTrips({
      page: 1,
      limit: 25,
      date_from: date,
      date_to: addCalendarDays(date, 1),
    });
    const window = unwrapEnvelope(tripsEnvelope).items;
    return buildCrewTodayData(date, selectCrewTripsForDay(date, window, timeZone));
  }, [timeZone]);

  const state = useLoad<CrewTodayData>(load, [timeZone]);
  const { setData } = state;

  /**
   * Reflects a **server-confirmed** trip row (the response of the crew's own
   * `PATCH /trips/:id/status`) into the loaded data at once, so the status card
   * and the GPS lifecycle see the confirmed status without waiting for the
   * list to reload. Callers still `reload()` afterwards to reconcile with the
   * server; a screen that has not loaded yet has nothing to update.
   */
  const applyTrip = useCallback(
    (applied: TripResponse) => {
      setData((current) =>
        current
          ? buildCrewTodayData(current.date, mergeTripUpdate(current.trips, applied))
          : current,
      );
    },
    [setData],
  );

  return { ...state, applyTrip };
}
