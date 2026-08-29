/**
 * Shared in-memory test doubles for the live-tracking module specs.
 *
 * The stubs mirror the repository surface `LiveTrackingService` actually
 * uses (`findOne` / `findAll` with tenant-pinned `where`, `create`, and
 * order/limit for the latest and history lookups) so the service logic —
 * authorization, validation, throttling, timestamp ordering — is exercised
 * exactly as in production, without a database.
 */
import { Op } from 'sequelize';
import { RouteAssignmentRole, TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import type { StopArrivalsService } from '../eta/stop-arrivals.service';
import type { LiveTrackingConfig } from './live-tracking.service';

export const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const ROUTE_A = '11111111-1111-4111-8111-11111111aaaa';
export const ROUTE_A2 = '11111111-1111-4111-8111-11111111bbbb';
export const ROUTE_B = '11111111-1111-4111-8111-11111111cccc';

export const STOP_1 = '22222222-2222-4222-8222-222222220001';
export const STOP_2 = '22222222-2222-4222-8222-222222220002';
export const STOP_OTHER_ROUTE = '22222222-2222-4222-8222-222222220003';
export const STOP_OTHER_SCHOOL = '22222222-2222-4222-8222-222222220004';

export const STUDENT_A = '33333333-3333-4333-8333-333333330001';
export const STUDENT_B = '33333333-3333-4333-8333-333333330002';
export const STUDENT_INACTIVE = '33333333-3333-4333-8333-333333330003';
export const STUDENT_OTHER_ROUTE = '33333333-3333-4333-8333-333333330004';
export const STUDENT_OTHER_SCHOOL = '33333333-3333-4333-8333-333333330005';

export const ADMIN_A = '44444444-4444-4444-8444-444444440001';
export const SUPER_ADMIN = '44444444-4444-4444-8444-444444440000';
export const DRIVER_A = '44444444-4444-4444-8444-444444440002';
export const CONDUCTOR_A = '44444444-4444-4444-8444-444444440003';
export const DRIVER_UNRELATED = '44444444-4444-4444-8444-444444440004';
export const DRIVER_ROSTERED = '44444444-4444-4444-8444-444444440005';
export const CONDUCTOR_ROSTERED = '44444444-4444-4444-8444-444444440006';
export const DRIVER_EXPIRED = '44444444-4444-4444-8444-444444440007';
export const DRIVER_OTHER_SCHOOL = '44444444-4444-4444-8444-444444440008';
export const PARENT_A = '44444444-4444-4444-8444-444444440009';
export const PARENT_UNRELATED = '44444444-4444-4444-8444-444444440010';
export const PARENT_INACTIVE_LINK = '44444444-4444-4444-8444-444444440011';
export const PARENT_OTHER_SCHOOL = '44444444-4444-4444-8444-444444440012';

export const TRIP_A = '55555555-5555-4555-8555-555555550001';
export const TRIP_A_SCHEDULED = '55555555-5555-4555-8555-555555550002';
export const TRIP_A_COMPLETED = '55555555-5555-4555-8555-555555550003';
export const TRIP_A_CANCELLED = '55555555-5555-4555-8555-555555550004';
export const TRIP_ROSTERED_CREW = '55555555-5555-4555-8555-555555550005';
export const TRIP_OTHER_ROUTE = '55555555-5555-4555-8555-555555550006';
export const TRIP_OTHER_SCHOOL = '55555555-5555-4555-8555-555555550007';

export const SCHEDULED_START = new Date('2026-09-01T06:30:00.000Z');

export function actorOf(role: UserRole, id: string, schoolId = SCHOOL_A): AuthenticatedRequestUser {
  return { id, school_id: schoolId, role };
}

export interface StubStop {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  sequence_number: number;
}

export interface StubStudent {
  id: string;
  school_id: string;
  home_stop_id: string | null;
  is_active: boolean;
}

export interface StubTrip {
  id: string;
  school_id: string;
  route_id: string;
  bus_id: string | null;
  driver_id: string | null;
  conductor_id: string | null;
  status: TripStatus;
  scheduled_start_at: Date;
}

export interface StubAssignment {
  id: string;
  school_id: string;
  route_id: string;
  user_id: string;
  role: RouteAssignmentRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

export interface StubGuardian {
  id: string;
  school_id: string;
  student_id: string;
  user_id: string;
  is_active: boolean;
}

export interface StubLocation {
  id: string;
  school_id: string;
  trip_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  recorded_at: Date;
  received_at: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export const STOPS: StubStop[] = [
  { id: STOP_1, school_id: SCHOOL_A, route_id: ROUTE_A, name: 'Maple St', sequence_number: 1 },
  { id: STOP_2, school_id: SCHOOL_A, route_id: ROUTE_A, name: 'Oak Ave', sequence_number: 2 },
  {
    id: STOP_OTHER_ROUTE,
    school_id: SCHOOL_A,
    route_id: ROUTE_A2,
    name: 'Birch Rd',
    sequence_number: 1,
  },
  {
    id: STOP_OTHER_SCHOOL,
    school_id: SCHOOL_B,
    route_id: ROUTE_B,
    name: 'Cedar Ln',
    sequence_number: 1,
  },
];

export const STUDENTS: StubStudent[] = [
  { id: STUDENT_A, school_id: SCHOOL_A, home_stop_id: STOP_1, is_active: true },
  { id: STUDENT_B, school_id: SCHOOL_A, home_stop_id: STOP_2, is_active: true },
  { id: STUDENT_INACTIVE, school_id: SCHOOL_A, home_stop_id: STOP_1, is_active: false },
  { id: STUDENT_OTHER_ROUTE, school_id: SCHOOL_A, home_stop_id: STOP_OTHER_ROUTE, is_active: true },
  {
    id: STUDENT_OTHER_SCHOOL,
    school_id: SCHOOL_B,
    home_stop_id: STOP_OTHER_SCHOOL,
    is_active: true,
  },
];

export const ASSIGNMENTS: StubAssignment[] = [
  {
    id: '66666666-6666-4666-8666-666666660001',
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    user_id: DRIVER_ROSTERED,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-08-01',
    effective_to: null,
    is_active: true,
  },
  {
    id: '66666666-6666-4666-8666-666666660002',
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    user_id: CONDUCTOR_ROSTERED,
    role: RouteAssignmentRole.CONDUCTOR,
    effective_from: '2026-08-01',
    effective_to: '2026-12-31',
    is_active: true,
  },
  {
    id: '66666666-6666-4666-8666-666666660003',
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    user_id: DRIVER_EXPIRED,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-01-01',
    effective_to: '2026-08-10',
    is_active: true,
  },
];

export const GUARDIANS: StubGuardian[] = [
  {
    id: '77777777-7777-4777-8777-777777770001',
    school_id: SCHOOL_A,
    student_id: STUDENT_A,
    user_id: PARENT_A,
    is_active: true,
  },
  {
    id: '77777777-7777-4777-8777-777777770002',
    school_id: SCHOOL_A,
    student_id: STUDENT_B,
    user_id: PARENT_A,
    is_active: true,
  },
  {
    id: '77777777-7777-4777-8777-777777770003',
    school_id: SCHOOL_A,
    student_id: STUDENT_OTHER_ROUTE,
    user_id: PARENT_UNRELATED,
    is_active: true,
  },
  {
    id: '77777777-7777-4777-8777-777777770004',
    school_id: SCHOOL_A,
    student_id: STUDENT_B,
    user_id: PARENT_INACTIVE_LINK,
    is_active: false,
  },
  {
    id: '77777777-7777-4777-8777-777777770005',
    school_id: SCHOOL_A,
    student_id: STUDENT_INACTIVE,
    user_id: PARENT_A,
    is_active: true,
  },
  {
    id: '77777777-7777-4777-8777-777777770006',
    school_id: SCHOOL_B,
    student_id: STUDENT_OTHER_SCHOOL,
    user_id: PARENT_OTHER_SCHOOL,
    is_active: true,
  },
];

export function makeTrip(overrides: Partial<StubTrip> = {}): StubTrip {
  return {
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: '88888888-8888-4888-8888-888888880001',
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: SCHEDULED_START,
    ...overrides,
  };
}

export const DEFAULT_TEST_CONFIG: LiveTrackingConfig = {
  gpsMinIntervalMs: 0,
  maxFutureSkewMs: 5 * 60 * 1000,
  maxPastSkewMs: 24 * 60 * 60 * 1000,
};

type Where = Record<PropertyKey, unknown>;

/** Matches plain equality plus the `Op.in` / `Op.gte` / `Op.lte` operators. */
export function matchesWhere(record: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (
      expected !== null &&
      typeof expected === 'object' &&
      !(expected instanceof Date) &&
      !Array.isArray(expected)
    ) {
      const operators = expected as Record<symbol | string, unknown>;
      if (operators[Op.in] !== undefined) {
        return (operators[Op.in] as unknown[]).includes(actual);
      }
      const compare = (value: unknown, bound: unknown): number => {
        const a = value instanceof Date ? value.getTime() : (value as number | string);
        const b = bound instanceof Date ? bound.getTime() : (bound as number | string);
        if (a === b) return 0;
        return (a as number | string) < (b as number | string) ? -1 : 1;
      };
      let matched = true;
      if (operators[Op.gte] !== undefined) {
        matched = matched && compare(actual, operators[Op.gte]) >= 0;
      }
      if (operators[Op.lte] !== undefined) {
        matched = matched && compare(actual, operators[Op.lte]) <= 0;
      }
      return matched;
    }
    return actual === expected;
  });
}

type OrderSpec = Array<[string, 'ASC' | 'DESC']>;

/** Stable multi-key sort honoring the requested direction per key. */
export function applyOrder<T extends Record<string, unknown>>(rows: T[], order: OrderSpec): T[] {
  const sorted = [...rows];
  for (const [key, direction] of [...order].reverse()) {
    sorted.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Compare by primitive value: two distinct Date objects with the same
      // time are "equal" even though `===` says otherwise.
      const avKey = av instanceof Date ? av.getTime() : av;
      const bvKey = bv instanceof Date ? bv.getTime() : bv;
      if (avKey === bvKey) return 0;
      const compared = (avKey as number | string) < (bvKey as number | string) ? -1 : 1;
      return direction === 'ASC' ? compared : -compared;
    });
  }
  return sorted;
}

export interface LocationStore {
  rows: StubLocation[];
  createPayloads: Array<Record<string, unknown>>;
}

/**
 * In-memory `trip_locations` repository with the query surface the service
 * uses: `findOne` / `findAll` with `where`, `order` and `limit`, plus
 * `create` (the persisted payload is captured for assertions).
 */
export function makeLocationStore(seed: StubLocation[] = []): LocationStore & {
  repo: Record<string, unknown>;
} {
  const rows: StubLocation[] = [...seed];
  const createPayloads: Array<Record<string, unknown>> = [];
  let counter = 0;

  const repo = {
    findOne: async (query: { where: Where; order?: OrderSpec; limit?: number }) => {
      const matched = rows.filter((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, query.where),
      );
      const ordered = query.order
        ? applyOrder(matched as unknown as Array<Record<string, unknown>>, query.order)
        : matched;
      const limited = query.limit !== undefined ? ordered.slice(0, query.limit) : ordered;
      return (limited[0] ?? null) as unknown as import('../../database/models').TripLocation;
    },
    findAll: async (query: { where: Where; order?: OrderSpec; limit?: number }) => {
      const matched = rows.filter((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, query.where),
      );
      const ordered = query.order
        ? applyOrder(matched as unknown as Array<Record<string, unknown>>, query.order)
        : matched;
      return (query.limit !== undefined
        ? ordered.slice(0, query.limit)
        : ordered) as unknown as import('../../database/models').TripLocation[];
    },
    create: async (payload: Record<string, unknown>) => {
      createPayloads.push({ ...payload });
      const row: StubLocation = {
        id: `loc-${String(++counter).padStart(2, '0')}`,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        ...(payload as unknown as Omit<
          StubLocation,
          'id' | 'created_at' | 'updated_at' | 'deleted_at'
        >),
      };
      rows.push(row);
      return row as unknown as import('../../database/models').TripLocation;
    },
  };

  return { rows, createPayloads, repo };
}

/**
 * A no-op stop-arrivals double for the tracking pipeline tests: accepts every
 * evaluation call, records nothing and never throws. The Task 22 arrival
 * behavior itself is covered by the eta module specs.
 */
export function makeNoopArrivalsStub(): StopArrivalsService {
  return {
    onAcceptedFix: async () => null,
    resetForTrip: () => undefined,
  } as unknown as StopArrivalsService;
}

/** A location fix with explicit recorded/received times. */
export function makeLocation(overrides: Partial<StubLocation> = {}): StubLocation {
  return {
    id: '88888888-8888-4888-8888-888888880002',
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    latitude: 51.5,
    longitude: -0.1,
    accuracy: 10,
    speed: 25,
    heading: 90,
    recorded_at: new Date('2026-09-01T06:31:00.000Z'),
    received_at: new Date('2026-09-01T06:31:01.000Z'),
    created_at: new Date('2026-09-01T06:31:01.000Z'),
    updated_at: new Date('2026-09-01T06:31:01.000Z'),
    deleted_at: null,
    ...overrides,
  };
}

export interface BroadcastCapture {
  emitted: Array<{ room: string; event: string; payload: unknown }>;
  fn: (room: string, event: string, payload: unknown) => void;
}

/** Captures every room-scoped emit performed by the service. */
export function makeBroadcastCapture(): BroadcastCapture {
  const emitted: BroadcastCapture['emitted'] = [];
  const fn = (room: string, event: string, payload: unknown) => {
    emitted.push({ room, event, payload });
  };
  return { emitted, fn };
}

/** Valid socket payload for one GPS fix of a trip. */
export function locationPayload(
  tripId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    trip_id: tripId,
    latitude: 51.5,
    longitude: -0.1,
    accuracy: 12,
    speed: 24.5,
    heading: 88,
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}
