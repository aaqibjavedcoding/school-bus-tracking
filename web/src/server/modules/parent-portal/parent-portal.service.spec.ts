import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '../../framework';
import {
  TripAttendanceStatus,
  TripStatus,
  UserRole,
  type TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
import { EtaService } from '../eta/eta.service';
import { TripAttendanceService } from '../trip-attendance/trip-attendance.service';
import { PARENT_PORTAL_CHILD_NOT_FOUND_MESSAGE } from './parent-portal.constants';
import { ParentPortalService } from './parent-portal.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PARENT_A = '01010101-0101-4101-8101-010101010101';
const STUDENT_A = '03030303-0303-4303-8303-030303030301';
const STUDENT_B = '03030303-0303-4303-8303-030303030302';
const STOP_A = '04040404-0404-4404-8404-040404040401';
const ROUTE_A = '05050505-0505-4505-8505-050505050501';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const CONDUCTOR_A = '08080808-0808-4808-8808-080808080801';
const TRIP_A = '09090909-0909-4909-8909-090909090901';

const parentA: AuthenticatedRequestUser = {
  id: PARENT_A,
  school_id: SCHOOL_A,
  role: UserRole.PARENT,
};

interface StubRow {
  [key: string]: unknown;
}

function makeStudent(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: STUDENT_A,
    school_id: SCHOOL_A,
    admission_number: 'S-1001',
    first_name: 'Alex',
    last_name: 'Rivera',
    date_of_birth: null,
    gender: null,
    grade_level: 'Grade 5',
    home_stop_id: STOP_A,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    medical_notes: null,
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeLink(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
    school_id: SCHOOL_A,
    student_id: STUDENT_A,
    user_id: PARENT_A,
    relationship: 'Mother',
    can_pick_up: true,
    is_primary: true,
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeStop(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: STOP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    name: 'Maple St & 5th Ave',
    address: null,
    latitude: 40.71,
    longitude: -74.0,
    geofence_radius_meters: 100,
    sequence_number: 2,
    estimated_arrival_time: '07:10',
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRoute(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: ROUTE_A,
    school_id: SCHOOL_A,
    name: 'North Loop',
    code: 'NL',
    description: null,
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeBus(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: BUS_A,
    school_id: SCHOOL_A,
    registration_number: 'ABC-123',
    bus_number: 'Bus 7',
    capacity: 40,
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTrip(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: BUS_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: new Date('2026-08-28T06:30:00.000Z'),
    scheduled_end_at: new Date('2026-08-28T07:30:00.000Z'),
    actual_start_at: new Date('2026-08-28T06:32:00.000Z'),
    actual_end_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: new Date('2026-08-27T00:00:00.000Z'),
    updated_at: new Date('2026-08-28T06:32:00.000Z'),
    ...overrides,
  };
}

function makeUser(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    first_name: 'Dana',
    last_name: 'Nguyen',
    email: 'dana@school.test',
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeSchool(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: SCHOOL_A,
    name: 'Demo High',
    code: 'demo-high',
    is_active: true,
    ...overrides,
  };
}

function makeAttendance(
  overrides: Partial<TripStudentAttendanceResponse> = {},
): TripStudentAttendanceResponse {
  return {
    id: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01',
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    student_id: STUDENT_A,
    admission_number: 'S-1001',
    first_name: 'Alex',
    last_name: 'Rivera',
    grade_level: 'Grade 5',
    stop_id: STOP_A,
    stop_name: 'Maple St & 5th Ave',
    stop_sequence_number: 2,
    status: TripAttendanceStatus.BOARDED,
    boarded_at: '2026-08-28T06:32:00.000Z',
    boarded_by: DRIVER_A,
    dropped_at: null,
    dropped_by: null,
    created_at: '2026-08-28T06:32:00.000Z',
    updated_at: '2026-08-28T06:32:00.000Z',
    ...overrides,
  };
}

interface RepoStubs {
  guardians: { findAll: unknown[]; findOne: StubRow | null };
  runs?: { findAll: StubRow[]; findOne: StubRow | null };
  runCrew?: StubRow[];
  shifts?: StubRow[];
  students: { findAll: StubRow[]; findOne: StubRow | null };
  stops: { findAll: StubRow[]; findOne: StubRow | null };
  routes: { findAll: StubRow[]; findOne: StubRow | null };
  buses: { findAll: StubRow[]; findOne: StubRow | null };
  trips: { findAll: StubRow[]; findOne: StubRow | null };
  users: { findAll: StubRow[]; findOne: StubRow | null };
  schools: { findOne: StubRow | null };
}

function createService(
  stubs: RepoStubs,
  trackingOpts?: { latest?: unknown },
  attendance?: TripStudentAttendanceResponse | null,
  etaResult: unknown = null,
): ParentPortalService {
  const repo = (findAll: unknown[], findOne: StubRow | null) => ({
    findAll: async () => findAll,
    findOne: async () => findOne,
  });

  // Mimics the tenant-scoped lookup: a row is only returned when its
  // school_id matches the where clause supplied by the service.
  const scopedFindOne =
    (row: StubRow | null) =>
    async (query: { where?: Record<string, unknown> }): Promise<StubRow | null> => {
      const schoolId = query?.where?.school_id;
      if (!row) return null;
      if (schoolId !== undefined && row.school_id !== schoolId) return null;
      const studentId = query?.where?.student_id;
      if (studentId !== undefined && row.student_id !== studentId) return null;
      return row;
    };

  const guardians = {
    findAll: async () => stubs.guardians.findAll,
    findOne: scopedFindOne(stubs.guardians.findOne),
  };
  const students = repo(stubs.students.findAll, stubs.students.findOne);
  const stops = repo(stubs.stops.findAll, stubs.stops.findOne);
  const routes = repo(stubs.routes.findAll, stubs.routes.findOne);
  const buses = repo(stubs.buses.findAll, stubs.buses.findOne);
  const trips = {
    findAll: async () => stubs.trips.findAll,
    findOne: async () => stubs.trips.findOne,
  };
  const users = repo(stubs.users.findAll, stubs.users.findOne);
  const schools = { findOne: async () => stubs.schools.findOne };

  const liveTracking = {
    getLatestLocationResponse: async () => trackingOpts?.latest ?? null,
  } as unknown as LiveTrackingService;

  const tripAttendance = {
    getStudent: async () => attendance ?? null,
  } as unknown as TripAttendanceService;

  // Task 22: the parent portal re-uses the ETA service; the stub returns
  // the given result (null unless a test overrides it).
  const eta = { computeTripEta: async () => etaResult } as unknown as EtaService;

  const runRows = stubs.runs?.findAll ?? [];
  const crewRows = stubs.runCrew ?? [];
  const shiftRows = stubs.shifts ?? [];
  return new ParentPortalService(
    guardians as never,
    students as never,
    stops as never,
    routes as never,
    buses as never,
    trips as never,
    users as never,
    schools as never,
    liveTracking,
    tripAttendance,
    eta,
    // Run fixtures default to empty: legacy tests keep exercising the
    // route-level fallback unchanged.
    {
      findOne: async () => stubs.runs?.findOne ?? null,
      findAll: async () => runRows,
    } as never,
    { findAll: async () => crewRows } as never,
    { findAll: async () => shiftRows } as never,
  );
}

function defaultStubs(overrides: Partial<RepoStubs> = {}): RepoStubs {
  return {
    guardians: { findAll: [makeLink()], findOne: makeLink() },
    students: { findAll: [makeStudent()], findOne: makeStudent() },
    stops: { findAll: [makeStop()], findOne: makeStop() },
    routes: { findAll: [makeRoute()], findOne: makeRoute() },
    buses: { findAll: [makeBus()], findOne: makeBus() },
    trips: { findAll: [makeTrip()], findOne: makeTrip() },
    users: { findAll: [makeUser()], findOne: makeUser() },
    schools: { findOne: makeSchool() },
    ...overrides,
  };
}

describe('ParentPortalService', () => {
  it('lists only the authenticated parent’s children with today’s trip and attendance', async () => {
    const service = createService(defaultStubs(), {}, makeAttendance());
    const result = await service.listChildren(parentA);

    assert.equal(result.count, 1);
    const child = result.items[0];
    assert.equal(child.id, STUDENT_A);
    assert.equal(child.first_name, 'Alex');
    assert.equal(child.relationship, 'Mother');
    assert.equal(child.home_stop.route_code, 'NL');
    assert.equal(child.home_stop.name, 'Maple St & 5th Ave');
    assert.equal(child.today.trip?.status, TripStatus.IN_PROGRESS);
    assert.equal(child.today.bus?.registration_number, 'ABC-123');
    assert.equal(child.today.attendance?.status, TripAttendanceStatus.BOARDED);
  });

  it('returns an empty list when the parent has no linked children', async () => {
    const service = createService(defaultStubs({ guardians: { findAll: [], findOne: null } }));
    const result = await service.listChildren(parentA);
    assert.deepEqual(result, { items: [], count: 0 });
  });

  it('does not expose children the parent is not linked to (404)', async () => {
    const service = createService(defaultStubs({ guardians: { findAll: [], findOne: null } }));
    await assert.rejects(
      () => service.getChild(parentA, STUDENT_B),
      (error: unknown) =>
        error instanceof NotFoundException &&
        error.message === PARENT_PORTAL_CHILD_NOT_FOUND_MESSAGE,
    );
  });

  it('does not expose a child linked to the parent in another school (404)', async () => {
    // The link exists but belongs to a different tenant; the tenant-scoped
    // lookup must not find it.
    const crossTenantLink = makeLink({ school_id: SCHOOL_B });
    const service = createService(
      defaultStubs({ guardians: { findAll: [], findOne: crossTenantLink } }),
    );
    await assert.rejects(
      () => service.getChild(parentA, STUDENT_A),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it('returns a cancelled/scheduled/no-trip day as trip null', async () => {
    const service = createService(defaultStubs({ trips: { findAll: [], findOne: null } }));
    const child = (await service.listChildren(parentA)).items[0];
    assert.equal(child.today.trip, null);
    assert.equal(child.today.attendance, null);
  });

  it('returns child detail with crew of today’s trip', async () => {
    const service = createService(defaultStubs(), {}, makeAttendance());
    const detail = await service.getChild(parentA, STUDENT_A);
    assert.equal(detail.driver?.first_name, 'Dana');
    assert.equal(detail.conductor, null);
  });

  it('returns today endpoint with ordered route stops', async () => {
    const service = createService(defaultStubs(), {}, makeAttendance());
    const today = await service.getChildToday(parentA, STUDENT_A);
    assert.equal(today.child.today.trip?.id, TRIP_A);
    assert.equal(today.stops[0].name, 'Maple St & 5th Ave');
  });

  it('returns the latest verified location when one exists', async () => {
    const service = createService(
      defaultStubs(),
      { latest: { id: 'loc-1', latitude: 40.7, longitude: -74.0 } },
      makeAttendance(),
    );
    const tracking = await service.getChildTracking(parentA, STUDENT_A);
    assert.equal(tracking.trip?.id, TRIP_A);
    assert.equal(tracking.latest?.latitude, 40.7);
  });

  it('attaches the approximate ETA of the trip (Task 22)', async () => {
    const etaResult = { trip_id: TRIP_A, school_id: SCHOOL_A, eta_available: false };
    const service = createService(defaultStubs(), {}, makeAttendance(), etaResult);
    const tracking = await service.getChildTracking(parentA, STUDENT_A);
    assert.equal(tracking.eta?.trip_id, TRIP_A);
    assert.equal(tracking.eta?.eta_available, false);
  });

  it('returns null location when no GPS exists (never fabricated)', async () => {
    const service = createService(defaultStubs(), {}, makeAttendance());
    const tracking = await service.getChildTracking(parentA, STUDENT_A);
    assert.equal(tracking.latest, null);
  });

  it('returns a dashboard with parent profile, school and child count', async () => {
    const service = createService(defaultStubs(), {}, makeAttendance());
    const dashboard = await service.getDashboard(parentA);
    assert.equal(dashboard.parent.role, UserRole.PARENT);
    assert.equal(dashboard.parent.first_name, 'Dana'); // user stub firstName
    assert.equal(dashboard.school?.name, 'Demo High');
    assert.equal(dashboard.count, 1);
  });

  it('stays read-only: no write endpoints exist on the service', () => {
    const proto = Object.getOwnPropertyNames(ParentPortalService.prototype);
    const write = proto.filter((name) =>
      /\b(create|update|board|drop|delete|remove|link)\b/.test(name),
    );
    assert.deepEqual(write, []);
  });
});


// ---------------------------------------------------------------------------
// Phase 3 — the child's run is the source of truth
// ---------------------------------------------------------------------------

const RUN_DEFAULT = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c01';
const RUN_TIER = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c02';
const BUS_TIER = '06060606-0606-4606-8606-060606060602';
const SHIFT_MORN = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d01';
const TRIP_TIER = '09090909-0909-4909-8909-090909090902';

function makeRun(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: RUN_DEFAULT,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    shift_id: SHIFT_MORN,
    bus_id: BUS_A,
    code: 'NL-1',
    is_default: true,
    is_active: true,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function runFixtures() {
  return {
    runs: {
      findAll: [
        makeRun(),
        makeRun({ id: RUN_TIER, code: 'NL-2', is_default: false, bus_id: BUS_TIER }),
      ],
      findOne: makeRun(),
    },
    runCrew: [
      {
        id: 'crew-1',
        school_id: SCHOOL_A,
        run_id: RUN_DEFAULT,
        user_id: DRIVER_A,
        role: 'DRIVER',
        effective_from: '2026-08-01',
        effective_to: null,
        is_active: true,
      },
    ],
    shifts: [
      {
        id: SHIFT_MORN,
        school_id: SCHOOL_A,
        name: 'Morning',
        start_time: '07:00:00',
        end_time: '11:00:00',
        is_active: true,
      },
    ],
  };
}

describe('ParentPortalService — run visibility', () => {
  it('exposes the run block and keeps the legacy trip visible (zero change)', async () => {
    const service = createService(defaultStubs(runFixtures()));
    const { items } = await service.listChildren(parentA);
    const run = items[0].run;
    assert.ok(run);
    assert.equal(run.id, RUN_DEFAULT);
    assert.equal(run.is_default, true);
    assert.equal(run.code, 'NL-1');
    assert.equal(run.bus_number, 'Bus 7');
    assert.equal(run.registration_number, 'ABC-123');
    assert.equal(run.driver_name, 'Dana Nguyen');
    assert.equal(run.shift_name, 'Morning');
    assert.equal(run.shift_start_time, '07:00:00');
    // The legacy run-less trip belongs to the default run → still today's trip.
    assert.equal(items[0].today.trip?.id, TRIP_A);
  });

  it('runs today only trips of the allocated run', async () => {
    const service = createService(
      defaultStubs({
        ...runFixtures(),
        students: {
          findAll: [makeStudent({ run_id: RUN_TIER })],
          findOne: makeStudent({ run_id: RUN_TIER }),
        },
        buses: {
          findAll: [
            makeBus(),
            makeBus({ id: BUS_TIER, registration_number: 'XYZ-999', bus_number: 'Bus 9' }),
          ],
          findOne: makeBus(),
        },
        trips: {
          findAll: [
            makeTrip(),
            makeTrip({ id: TRIP_TIER, run_id: RUN_TIER, status: TripStatus.IN_PROGRESS }),
          ],
          findOne: makeTrip({ id: TRIP_TIER, run_id: RUN_TIER }),
        },
      }),
    );
    const { items } = await service.listChildren(parentA);
    const child = items[0];
    assert.equal(child.run?.id, RUN_TIER);
    assert.equal(child.run?.is_default, false);
    assert.equal(child.run?.bus_number, 'Bus 9');
    assert.equal(child.run?.registration_number, 'XYZ-999');
    // The default run's legacy trip must NOT leak into the tiered run's day.
    assert.equal(child.today.trip?.id, TRIP_TIER);
  });

  it('shows the run bus even on a day without a dispatched trip', async () => {
    const service = createService(
      defaultStubs({
        ...runFixtures(),
        trips: { findAll: [], findOne: null },
      }),
    );
    const { items } = await service.listChildren(parentA);
    const child = items[0];
    assert.equal(child.today.trip, null);
    // The resolved (default) run still answers "which bus" — the pre-refactor
    // view had nothing to show on a rest day.
    assert.equal(child.run?.id, RUN_DEFAULT);
    assert.equal(child.today.bus?.bus_number, 'Bus 7');
    assert.equal(child.today.bus?.registration_number, 'ABC-123');
  });

  it('falls back to the standing run crew for the child detail', async () => {
    const service = createService(
      defaultStubs({
        ...runFixtures(),
        trips: { findAll: [], findOne: null },
      }),
    );
    const detail = await service.getChild(parentA, STUDENT_A);
    assert.equal(detail.today.trip, null);
    // The default run's rostered driver surfaces even with no trip at all.
    assert.equal(detail.driver?.first_name, 'Dana');
    assert.equal(detail.conductor, null);
    assert.equal(detail.run?.id, RUN_DEFAULT);
    assert.equal(detail.run?.driver_name, 'Dana Nguyen');
  });
});
