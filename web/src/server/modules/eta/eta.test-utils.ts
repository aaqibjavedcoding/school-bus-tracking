/**
 * Shared in-memory test doubles for the Task 22 eta module specs.
 *
 * The stubs mirror the repository surfaces `EtaService` and
 * `StopArrivalsService` actually use (tenant-pinned `findAll` / `findOne` /
 * `create`) so the geofence, ETA and duplicate-protection logic is exercised
 * exactly as in production, without a database. The generic
 * `matchesWhere` / `applyOrder` helpers are re-used from the live-tracking
 * suite.
 */
import { TripStatus } from '@school-bus-tracking/shared-types';
import { getTripTrackingState } from '@school-bus-tracking/validation';
import { TripEtaResponse, TripLocationResponse } from '@school-bus-tracking/shared-types';
import type { Stop, Trip, TripStopArrival } from '../../database/models';
import type { StopArrivalNotificationInput } from '../notifications/notifications.service';
import type { EtaConfig, EtaLocationFix, TripEtaComputeInput } from './eta.service';
import { EtaService } from './eta.service';
import { StopArrivalsService } from './stop-arrivals.service';
import { applyOrder, matchesWhere } from '../live-tracking/live-tracking.test-utils';

export const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const ROUTE_A = '11111111-1111-4111-8111-11111111aaaa';
export const ROUTE_B = '11111111-1111-4111-8111-11111111bbbb';

export const TRIP_A = '55555555-5555-4555-8555-555555550001';
export const TRIP_COMPLETED = '55555555-5555-4555-8555-555555550002';
export const TRIP_CANCELLED = '55555555-5555-4555-8555-555555550003';
export const TRIP_OTHER_SCHOOL = '55555555-5555-4555-8555-555555550004';

export const STOP_1 = '22222222-2222-4222-8222-222222220001';
export const STOP_2 = '22222222-2222-4222-8222-222222220002';
export const STOP_3 = '22222222-2222-4222-8222-222222220003';
export const STOP_OTHER_ROUTE = '22222222-2222-4222-8222-222222220004';
export const STOP_OTHER_SCHOOL = '22222222-2222-4222-8222-222222220005';
export const STOP_NO_COORDS = '22222222-2222-4222-8222-222222220006';

export const DEFAULT_ETA_CONFIG: EtaConfig = {
  fallbackSpeedKmh: 25,
  minSpeedKmh: 5,
  maxSpeedKmh: 90,
};

/**
 * A short east-west corridor around 40.70°N: each stop sits ~840 m from the
 * next, with a 100 m geofence radius.
 */
export interface StubStop {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  sequence_number: number;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
  is_active: boolean;
}

export function makeStop(overrides: Partial<StubStop> = {}): StubStop {
  return {
    id: STOP_1,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    name: 'Green Park Stop',
    sequence_number: 1,
    latitude: 40.7,
    longitude: -74.0,
    geofence_radius_meters: 100,
    is_active: true,
    ...overrides,
  };
}

export const DEFAULT_STOPS: StubStop[] = [
  makeStop({ id: STOP_1, name: 'Green Park Stop', sequence_number: 1 }),
  makeStop({ id: STOP_2, name: 'Oak Ave', sequence_number: 2, longitude: -73.99 }),
  makeStop({ id: STOP_3, name: 'Maple St', sequence_number: 3, longitude: -73.98 }),
];

export interface StubTrip {
  id: string;
  school_id: string;
  route_id: string;
  status: TripStatus;
  scheduled_start_at: Date;
}

export function makeTrip(overrides: Partial<StubTrip> = {}): StubTrip {
  return {
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: new Date('2026-09-01T06:30:00.000Z'),
    ...overrides,
  };
}

export interface StubArrival {
  id: string;
  school_id: string;
  trip_id: string;
  stop_id: string;
  arrived_at: Date;
  latitude: number;
  longitude: number;
  distance_meters: number;
  created_at: Date;
  updated_at: Date;
}

export function makeArrival(overrides: Partial<StubArrival> = {}): StubArrival {
  return {
    id: '99999999-9999-4999-8999-999999990001',
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    stop_id: STOP_1,
    arrived_at: new Date('2026-09-01T06:40:00.000Z'),
    latitude: 40.7003,
    longitude: -73.9997,
    distance_meters: 41,
    created_at: new Date('2026-09-01T06:40:00.000Z'),
    updated_at: new Date('2026-09-01T06:40:00.000Z'),
    ...overrides,
  };
}

/** One GPS fix; structurally satisfies `EtaLocationFix`. */
export interface StubFix extends EtaLocationFix {
  created_at?: Date;
}

export function makeFix(overrides: Partial<StubFix> = {}): StubFix {
  return {
    id: '88888888-8888-4888-8888-888888880001',
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    latitude: 40.7003,
    longitude: -73.9997,
    accuracy: 10,
    speed: 25,
    heading: 90,
    recorded_at: new Date('2026-09-01T06:41:00.000Z'),
    received_at: new Date('2026-09-01T06:41:01.000Z'),
    ...overrides,
  };
}

type Where = Record<PropertyKey, unknown>;
type OrderSpec = Array<[string, 'ASC' | 'DESC']>;

/** In-memory `stops` repository with the tenant-pinned query surface used by the services. */
export function makeStopsRepo(rows: StubStop[]) {
  const queries: Where[] = [];
  return {
    queries,
    repo: {
      findAll: async (query: { where: Where; order?: OrderSpec }) => {
        queries.push(query.where);
        const matched = rows.filter((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, query.where),
        );
        const ordered = query.order
          ? applyOrder(matched as unknown as Array<Record<string, unknown>>, query.order)
          : matched;
        return ordered as unknown as Stop[];
      },
    },
  };
}

export interface ArrivalsStoreOptions {
  /** When set, `create` throws it (simulates the unique-index race). */
  createError?: Error;
}

/** In-memory `trip_stop_arrivals` repository with create capture. */
export function makeArrivalsRepo(rows: StubArrival[], options: ArrivalsStoreOptions = {}) {
  const store = [...rows];
  const created: Array<Record<string, unknown>> = [];
  let counter = 0;
  return {
    rows: store,
    created,
    repo: {
      findAll: async (query: { where: Where; order?: OrderSpec }) => {
        const matched = store.filter((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, query.where),
        );
        const ordered = query.order
          ? applyOrder(matched as unknown as Array<Record<string, unknown>>, query.order)
          : matched;
        return ordered as unknown as TripStopArrival[];
      },
      findOne: async (query: { where: Where }) =>
        (store.find((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, query.where),
        ) ?? null) as unknown as TripStopArrival,
      create: async (payload: Record<string, unknown>) => {
        if (options.createError) {
          throw options.createError;
        }
        created.push({ ...payload });
        counter += 1;
        const row: StubArrival = {
          id: `arrival-${counter}`,
          arrived_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
          ...(payload as unknown as Omit<
            StubArrival,
            'id' | 'arrived_at' | 'created_at' | 'updated_at'
          >),
        };
        store.push(row);
        return row as unknown as TripStopArrival;
      },
    },
  };
}

/** Builds a real `EtaService` over the given in-memory repositories. */
export function makeEtaService(
  stops: StubStop[],
  arrivals: StubArrival[],
  config: EtaConfig = DEFAULT_ETA_CONFIG,
): EtaService {
  const stopsStore = makeStopsRepo(stops);
  const arrivalsStore = makeArrivalsRepo(arrivals);
  return new EtaService(
    stopsStore.repo as unknown as typeof Stop,
    arrivalsStore.repo as unknown as typeof TripStopArrival,
    config,
  );
}

/** Minimal valid ETA response for harness stubs. */
export function minimalEtaResponse(
  trip: Pick<StubTrip, 'id' | 'school_id' | 'status'>,
  latest: EtaLocationFix | null,
): TripEtaResponse {
  const location: TripLocationResponse | null = latest
    ? {
        id: latest.id,
        school_id: latest.school_id,
        trip_id: latest.trip_id,
        latitude: latest.latitude,
        longitude: latest.longitude,
        accuracy: latest.accuracy,
        speed: latest.speed,
        heading: latest.heading,
        recorded_at: new Date(latest.recorded_at).toISOString(),
        received_at: new Date(latest.received_at).toISOString(),
      }
    : null;
  return {
    trip_id: trip.id,
    school_id: trip.school_id,
    trip_status: trip.status,
    tracking_state: getTripTrackingState(trip.status),
    latest: location,
    speed_kmh: latest ? 25 : null,
    speed_source: latest ? 'fallback' : null,
    current_stop: null,
    next_stop: null,
    items: [],
    eta_available: latest !== null,
  };
}

export interface ArrivalsHarness {
  service: StopArrivalsService;
  stopsRows: StubStop[];
  arrivals: ReturnType<typeof makeArrivalsRepo>;
  arrivalNotifications: StopArrivalNotificationInput[];
  etaCalls: TripEtaComputeInput[];
  broadcasts: Array<{ room: string; event: string; payload: unknown }>;
}

/** Builds a real `StopArrivalsService` with in-memory repos and captured doubles. */
export function makeArrivalsHarness(
  options: {
    stops?: StubStop[];
    arrivals?: StubArrival[];
    createError?: Error;
    eta?: (input: TripEtaComputeInput) => Promise<TripEtaResponse>;
  } = {},
): ArrivalsHarness {
  const stopsRows = options.stops ?? DEFAULT_STOPS;
  const stopsStore = makeStopsRepo(stopsRows);
  const arrivals = makeArrivalsRepo(options.arrivals ?? [], { createError: options.createError });
  const arrivalNotifications: StopArrivalNotificationInput[] = [];
  const etaCalls: TripEtaComputeInput[] = [];
  const broadcasts: ArrivalsHarness['broadcasts'] = [];

  const eta = {
    computeTripEta: async (input: TripEtaComputeInput): Promise<TripEtaResponse> => {
      etaCalls.push(input);
      if (options.eta) {
        return options.eta(input);
      }
      return minimalEtaResponse(input.trip, input.latest);
    },
  } as unknown as EtaService;

  const notifications = {
    notifyStopArrival: async (input: StopArrivalNotificationInput): Promise<void> => {
      arrivalNotifications.push(input);
    },
  } as never;

  const service = new StopArrivalsService(
    stopsStore.repo as unknown as typeof Stop,
    arrivals.repo as unknown as typeof TripStopArrival,
    eta,
    notifications,
  );
  service.attachBroadcaster((room, event, payload) => {
    broadcasts.push({ room, event, payload });
  });

  return { service, stopsRows, arrivals, arrivalNotifications, etaCalls, broadcasts };
}

/** A stub trip row cast to the ORM type the services accept. */
export function asTrip(stub: StubTrip): Trip {
  return stub as unknown as Trip;
}
