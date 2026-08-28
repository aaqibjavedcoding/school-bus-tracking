import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  RouteAssignmentRole,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripStudentAttendance,
} from '../../database/models';
import type { AuthenticatedRequestUser } from '../../common/guards';
import { ListTripStudentsQueryDto } from './dto/list-trip-students-query.dto';
import { TripAttendanceService } from './trip-attendance.service';
import {
  TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE,
  TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE,
  TRIP_ATTENDANCE_NOT_BOARDED_MESSAGE,
  TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
  TRIP_ATTENDANCE_TRIP_CLOSED_MESSAGE,
  TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
} from './trip-attendance.constants';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ROUTE_A = '11111111-1111-4111-8111-11111111aaaa';
const ROUTE_A2 = '11111111-1111-4111-8111-11111111bbbb';
const ROUTE_B = '11111111-1111-4111-8111-11111111cccc';

const STOP_1 = '22222222-2222-4222-8222-222222220001';
const STOP_2 = '22222222-2222-4222-8222-222222220002';
const STOP_OTHER_ROUTE = '22222222-2222-4222-8222-222222220003';
const STOP_OTHER_SCHOOL = '22222222-2222-4222-8222-222222220004';

const STUDENT_EARLY = '33333333-3333-4333-8333-333333330001';
const STUDENT_LATE = '33333333-3333-4333-8333-333333330002';
const STUDENT_SECOND_STOP = '33333333-3333-4333-8333-333333330003';
const STUDENT_INACTIVE = '33333333-3333-4333-8333-333333330004';
const STUDENT_OTHER_ROUTE = '33333333-3333-4333-8333-333333330005';
const STUDENT_OTHER_SCHOOL = '33333333-3333-4333-8333-333333330006';
const STUDENT_NO_STOP = '33333333-3333-4333-8333-333333330007';

const ADMIN_A = '44444444-4444-4444-8444-444444440001';
const DRIVER_A = '44444444-4444-4444-8444-444444440002';
const CONDUCTOR_A = '44444444-4444-4444-8444-444444440003';
const DRIVER_ROSTERED = '44444444-4444-4444-8444-444444440004';
const CONDUCTOR_ROSTERED = '44444444-4444-4444-8444-444444440005';
const DRIVER_UNRELATED = '44444444-4444-4444-8444-444444440006';
const DRIVER_EXPIRED = '44444444-4444-4444-8444-444444440007';
const PARENT_A = '44444444-4444-4444-8444-444444440008';
const PARENT_UNRELATED = '44444444-4444-4444-8444-444444440009';

const TRIP_A = '55555555-5555-4555-8555-555555550001';
const TRIP_OTHER_ROUTE = '55555555-5555-4555-8555-555555550002';
const TRIP_COMPLETED = '55555555-5555-4555-8555-555555550003';
const TRIP_CANCELLED = '55555555-5555-4555-8555-555555550004';
const TRIP_OTHER_SCHOOL = '55555555-5555-4555-8555-555555550005';

const SCHEDULED_START = new Date('2026-09-01T06:30:00.000Z');

interface StubStop {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  sequence_number: number;
}

interface StubStudent {
  id: string;
  school_id: string;
  home_stop_id: string | null;
  admission_number: string;
  first_name: string;
  last_name: string;
  grade_level: string | null;
  is_active: boolean;
}

interface StubTrip {
  id: string;
  school_id: string;
  route_id: string;
  driver_id: string | null;
  conductor_id: string | null;
  status: TripStatus;
  scheduled_start_at: Date;
}

interface StubAssignment {
  id: string;
  school_id: string;
  route_id: string;
  user_id: string;
  role: RouteAssignmentRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

interface StubGuardian {
  id: string;
  school_id: string;
  student_id: string;
  user_id: string;
  is_active: boolean;
}

interface StubAttendance {
  id: string;
  school_id: string;
  trip_id: string;
  student_id: string;
  stop_id: string | null;
  status: TripAttendanceStatus;
  boarded_at: Date | null;
  boarded_by: string | null;
  dropped_at: Date | null;
  dropped_by: string | null;
  created_at: Date;
  updated_at: Date;
  update: (values: Record<string, unknown>, options?: unknown) => Promise<StubAttendance>;
}

const STOPS: StubStop[] = [
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

const STUDENTS: StubStudent[] = [
  {
    id: STUDENT_LATE,
    school_id: SCHOOL_A,
    home_stop_id: STOP_1,
    admission_number: 'A-102',
    first_name: 'Wei',
    last_name: 'Zhang',
    grade_level: 'Grade 5',
    is_active: true,
  },
  {
    id: STUDENT_EARLY,
    school_id: SCHOOL_A,
    home_stop_id: STOP_1,
    admission_number: 'A-101',
    first_name: 'Bob',
    last_name: 'Adams',
    grade_level: 'Grade 4',
    is_active: true,
  },
  {
    id: STUDENT_SECOND_STOP,
    school_id: SCHOOL_A,
    home_stop_id: STOP_2,
    admission_number: 'A-103',
    first_name: 'Amy',
    last_name: 'Baker',
    grade_level: null,
    is_active: true,
  },
  {
    id: STUDENT_INACTIVE,
    school_id: SCHOOL_A,
    home_stop_id: STOP_1,
    admission_number: 'A-104',
    first_name: 'Iris',
    last_name: 'Inactive',
    grade_level: null,
    is_active: false,
  },
  {
    id: STUDENT_OTHER_ROUTE,
    school_id: SCHOOL_A,
    home_stop_id: STOP_OTHER_ROUTE,
    admission_number: 'A-105',
    first_name: 'Otto',
    last_name: 'Route',
    grade_level: null,
    is_active: true,
  },
  {
    id: STUDENT_OTHER_SCHOOL,
    school_id: SCHOOL_B,
    home_stop_id: STOP_OTHER_SCHOOL,
    admission_number: 'B-101',
    first_name: 'Bea',
    last_name: 'Other',
    grade_level: null,
    is_active: true,
  },
  {
    id: STUDENT_NO_STOP,
    school_id: SCHOOL_A,
    home_stop_id: null,
    admission_number: 'A-106',
    first_name: 'Noah',
    last_name: 'Nostop',
    grade_level: null,
    is_active: true,
  },
];

const TRIPS: StubTrip[] = [
  {
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: SCHEDULED_START,
  },
  {
    id: TRIP_OTHER_ROUTE,
    school_id: SCHOOL_A,
    route_id: ROUTE_A2,
    driver_id: DRIVER_A,
    conductor_id: null,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: SCHEDULED_START,
  },
  {
    id: TRIP_COMPLETED,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.COMPLETED,
    scheduled_start_at: SCHEDULED_START,
  },
  {
    id: TRIP_CANCELLED,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.CANCELLED,
    scheduled_start_at: SCHEDULED_START,
  },
  {
    id: TRIP_OTHER_SCHOOL,
    school_id: SCHOOL_B,
    route_id: ROUTE_B,
    driver_id: DRIVER_A,
    conductor_id: null,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: SCHEDULED_START,
  },
];

const ASSIGNMENTS: StubAssignment[] = [
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
  {
    id: '66666666-6666-4666-8666-666666660004',
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    user_id: DRIVER_UNRELATED,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-08-01',
    effective_to: null,
    is_active: false,
  },
];

const GUARDIANS: StubGuardian[] = [
  {
    id: '77777777-7777-4777-8777-777777770001',
    school_id: SCHOOL_A,
    student_id: STUDENT_EARLY,
    user_id: PARENT_A,
    is_active: true,
  },
  {
    id: '77777777-7777-4777-8777-777777770002',
    school_id: SCHOOL_A,
    student_id: STUDENT_SECOND_STOP,
    user_id: PARENT_A,
    is_active: false,
  },
  {
    id: '77777777-7777-4777-8777-777777770003',
    school_id: SCHOOL_A,
    student_id: STUDENT_OTHER_ROUTE,
    user_id: PARENT_UNRELATED,
    is_active: true,
  },
];

function actorOf(role: UserRole, id: string, schoolId = SCHOOL_A): AuthenticatedRequestUser {
  return { id, school_id: schoolId, role };
}

const ADMIN = actorOf(UserRole.SCHOOL_ADMIN, ADMIN_A);
const DRIVER = actorOf(UserRole.DRIVER, DRIVER_A);
const CONDUCTOR = actorOf(UserRole.CONDUCTOR, CONDUCTOR_A);
const PARENT = actorOf(UserRole.PARENT, PARENT_A);

/** Matches plain equality plus the `Op.in` operator used by the manifest. */
function matchesWhere(record: Record<string, unknown>, where: Record<PropertyKey, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected !== null && typeof expected === 'object') {
      const values = (expected as Record<symbol, unknown[]>)[Op.in];
      return Array.isArray(values) ? values.includes(actual) : actual === expected;
    }
    return actual === expected;
  });
}

interface Capture {
  attendanceFindAllWheres: Array<Record<PropertyKey, unknown>>;
  attendanceFindOneOptions: Array<Record<string, unknown>>;
  createPayloads: Array<Record<string, unknown>>;
  createOptions: Array<Record<string, unknown> | undefined>;
  stopFindAllWheres: Array<Record<PropertyKey, unknown>>;
  studentFindAllWheres: Array<Record<PropertyKey, unknown>>;
  guardianFindAllWheres: Array<Record<PropertyKey, unknown>>;
  assignmentFindAllWheres: Array<Record<PropertyKey, unknown>>;
  tripFindOneWheres: Array<Record<PropertyKey, unknown>>;
  transactions: number;
}

function emptyCapture(): Capture {
  return {
    attendanceFindAllWheres: [],
    attendanceFindOneOptions: [],
    createPayloads: [],
    createOptions: [],
    stopFindAllWheres: [],
    studentFindAllWheres: [],
    guardianFindAllWheres: [],
    assignmentFindAllWheres: [],
    tripFindOneWheres: [],
    transactions: 0,
  };
}

function makeAttendanceRow(overrides: Partial<StubAttendance> = {}): StubAttendance {
  const row: StubAttendance = {
    id: '88888888-8888-4888-8888-888888880001',
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    student_id: STUDENT_EARLY,
    stop_id: STOP_1,
    status: TripAttendanceStatus.BOARDED,
    boarded_at: new Date('2026-09-01T06:31:00.000Z'),
    boarded_by: DRIVER_A,
    dropped_at: null,
    dropped_by: null,
    created_at: new Date('2026-09-01T06:31:00.000Z'),
    updated_at: new Date('2026-09-01T06:31:00.000Z'),
    update: async (values) => {
      Object.assign(row, values, { updated_at: new Date() });
      return row;
    },
  };
  Object.assign(row, overrides);
  return row;
}

function makeRepositories(
  attendanceRows: StubAttendance[] = [],
  capture: Capture = emptyCapture(),
  options: { withSequelize?: boolean; createError?: Error } = {},
) {
  const rows = [...attendanceRows];
  const withSequelize = options.withSequelize !== false;

  const attendanceRepo = {
    sequelize: withSequelize
      ? {
          transaction: async <T>(work: (transaction: unknown) => Promise<T>): Promise<T> => {
            capture.transactions += 1;
            return work({ id: 'stub-transaction' });
          },
        }
      : undefined,
    findAll: async (query: { where: Record<PropertyKey, unknown> }) => {
      capture.attendanceFindAllWheres.push(query.where);
      return rows.filter((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, query.where),
      ) as unknown as TripStudentAttendance[];
    },
    findOne: async (query: Record<string, unknown>) => {
      capture.attendanceFindOneOptions.push(query);
      const where = query.where as Record<PropertyKey, unknown>;
      return (rows.find((row) => matchesWhere(row as unknown as Record<string, unknown>, where)) ??
        null) as unknown as TripStudentAttendance;
    },
    create: async (payload: Record<string, unknown>, createOptions?: Record<string, unknown>) => {
      capture.createPayloads.push(payload);
      capture.createOptions.push(createOptions);
      if (options.createError) {
        throw options.createError;
      }
      const row = makeAttendanceRow({
        id: `created-${rows.length + 1}`,
        school_id: payload.school_id as string,
        trip_id: payload.trip_id as string,
        student_id: payload.student_id as string,
        stop_id: payload.stop_id as string | null,
        status: payload.status as TripAttendanceStatus,
        boarded_at: payload.boarded_at as Date | null,
        boarded_by: payload.boarded_by as string | null,
        dropped_at: payload.dropped_at as Date | null,
        dropped_by: payload.dropped_by as string | null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      rows.push(row);
      return row as unknown as TripStudentAttendance;
    },
  } as unknown as typeof TripStudentAttendance;

  const tripRepo = {
    findOne: async (query: { where: Record<PropertyKey, unknown> }) => {
      capture.tripFindOneWheres.push(query.where);
      return (TRIPS.find((trip) =>
        matchesWhere(trip as unknown as Record<string, unknown>, query.where),
      ) ?? null) as unknown as Trip;
    },
  } as unknown as typeof Trip;

  const stopRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) => {
      capture.stopFindAllWheres.push(query.where);
      return STOPS.filter((stop) =>
        matchesWhere(stop as unknown as Record<string, unknown>, query.where),
      ) as unknown as Stop[];
    },
    findOne: async (query: { where: Record<PropertyKey, unknown> }) => {
      return (STOPS.find((stop) =>
        matchesWhere(stop as unknown as Record<string, unknown>, query.where),
      ) ?? null) as unknown as Stop;
    },
  } as unknown as typeof Stop;

  const studentRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) => {
      capture.studentFindAllWheres.push(query.where);
      return STUDENTS.filter((student) =>
        matchesWhere(student as unknown as Record<string, unknown>, query.where),
      ) as unknown as Student[];
    },
    findOne: async (query: { where: Record<PropertyKey, unknown> }) => {
      return (STUDENTS.find((student) =>
        matchesWhere(student as unknown as Record<string, unknown>, query.where),
      ) ?? null) as unknown as Student;
    },
  } as unknown as typeof Student;

  const guardianRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) => {
      capture.guardianFindAllWheres.push(query.where);
      return GUARDIANS.filter((guardian) =>
        matchesWhere(guardian as unknown as Record<string, unknown>, query.where),
      ) as unknown as StudentGuardian[];
    },
  } as unknown as typeof StudentGuardian;

  const assignmentRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) => {
      capture.assignmentFindAllWheres.push(query.where);
      return ASSIGNMENTS.filter((assignment) =>
        matchesWhere(assignment as unknown as Record<string, unknown>, query.where),
      ) as unknown as RouteAssignment[];
    },
  } as unknown as typeof RouteAssignment;

  return {
    rows,
    capture,
    service: new TripAttendanceService(
      attendanceRepo,
      tripRepo,
      stopRepo,
      studentRepo,
      guardianRepo,
      assignmentRepo,
    ),
  };
}

function query(overrides: Partial<ListTripStudentsQueryDto> = {}): ListTripStudentsQueryDto {
  return Object.assign(new ListTripStudentsQueryDto(), overrides);
}

async function rejectsWith(
  promise: Promise<unknown>,
  type: new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  await assert.rejects(promise, (error: Error) => {
    assert.ok(error instanceof type, `expected ${type.name}, received ${error.constructor.name}`);
    assert.equal(error.message, message);
    return true;
  });
}

describe('TripAttendanceService manifest', () => {
  it('derives the manifest from the route stops and orders it by stop sequence', async () => {
    const { service, capture } = makeRepositories();
    const manifest = await service.getManifest(ADMIN, TRIP_A, query());

    assert.deepEqual(
      manifest.items.map((item) => item.student_id),
      [STUDENT_EARLY, STUDENT_LATE, STUDENT_SECOND_STOP],
    );
    assert.deepEqual(
      manifest.items.map((item) => item.stop_sequence_number),
      [1, 1, 2],
    );
    assert.deepEqual(
      manifest.items.map((item) => item.stop_name),
      ['Maple St', 'Maple St', 'Oak Ave'],
    );
    assert.equal(manifest.trip_id, TRIP_A);
    assert.equal(manifest.school_id, SCHOOL_A);
    assert.equal(manifest.route_id, ROUTE_A);
    assert.equal(manifest.trip_status, TripStatus.IN_PROGRESS);

    // Tenant isolation on every query the manifest is built from.
    for (const where of [
      ...capture.stopFindAllWheres,
      ...capture.studentFindAllWheres,
      ...capture.attendanceFindAllWheres,
      ...capture.tripFindOneWheres,
    ]) {
      assert.equal(where.school_id, SCHOOL_A);
    }
  });

  it('excludes inactive students, students of other routes and other tenants', async () => {
    const { service } = makeRepositories();
    const manifest = await service.getManifest(ADMIN, TRIP_A, query());
    const ids = manifest.items.map((item) => item.student_id);

    assert.ok(!ids.includes(STUDENT_INACTIVE));
    assert.ok(!ids.includes(STUDENT_OTHER_ROUTE));
    assert.ok(!ids.includes(STUDENT_OTHER_SCHOOL));
    assert.ok(!ids.includes(STUDENT_NO_STOP));
  });

  it('reports every manifest entry as PENDING until an event is recorded', async () => {
    const { service } = makeRepositories();
    const manifest = await service.getManifest(ADMIN, TRIP_A, query());

    assert.deepEqual(manifest.summary, { total: 3, pending: 3, boarded: 0, dropped: 0 });
    for (const item of manifest.items) {
      assert.equal(item.status, TripAttendanceStatus.PENDING);
      assert.equal(item.id, null);
      assert.equal(item.boarded_at, null);
      assert.equal(item.boarded_by, null);
      assert.equal(item.dropped_at, null);
      assert.equal(item.dropped_by, null);
    }
  });

  it('merges stored attendance rows and summarises them', async () => {
    const { service } = makeRepositories([
      makeAttendanceRow({ student_id: STUDENT_EARLY, status: TripAttendanceStatus.BOARDED }),
      makeAttendanceRow({
        id: '88888888-8888-4888-8888-888888880002',
        student_id: STUDENT_SECOND_STOP,
        stop_id: STOP_2,
        status: TripAttendanceStatus.DROPPED,
        dropped_at: new Date('2026-09-01T07:10:00.000Z'),
        dropped_by: CONDUCTOR_A,
      }),
      // Row of another trip — must not bleed into this manifest.
      makeAttendanceRow({
        id: '88888888-8888-4888-8888-888888880003',
        trip_id: TRIP_COMPLETED,
        student_id: STUDENT_LATE,
      }),
    ]);

    const manifest = await service.getManifest(ADMIN, TRIP_A, query());
    assert.deepEqual(manifest.summary, { total: 3, pending: 1, boarded: 1, dropped: 1 });
    assert.deepEqual(
      manifest.items.map((item) => item.status),
      [TripAttendanceStatus.BOARDED, TripAttendanceStatus.PENDING, TripAttendanceStatus.DROPPED],
    );
    assert.equal(manifest.items[0].boarded_by, DRIVER_A);
    assert.equal(manifest.items[2].dropped_at, '2026-09-01T07:10:00.000Z');
  });

  it('filters by attendance status while keeping the summary over the full manifest', async () => {
    const { service } = makeRepositories([
      makeAttendanceRow({ student_id: STUDENT_EARLY, status: TripAttendanceStatus.BOARDED }),
    ]);

    const manifest = await service.getManifest(
      ADMIN,
      TRIP_A,
      query({ status: TripAttendanceStatus.BOARDED }),
    );
    assert.deepEqual(
      manifest.items.map((item) => item.student_id),
      [STUDENT_EARLY],
    );
    assert.deepEqual(manifest.summary, { total: 3, pending: 2, boarded: 1, dropped: 0 });
  });

  it('filters by stop and yields nothing for a stop outside the trip route', async () => {
    const { service } = makeRepositories();

    const atStopOne = await service.getManifest(ADMIN, TRIP_A, query({ stop_id: STOP_1 }));
    assert.deepEqual(
      atStopOne.items.map((item) => item.student_id),
      [STUDENT_EARLY, STUDENT_LATE],
    );

    const foreign = await service.getManifest(ADMIN, TRIP_A, query({ stop_id: STOP_OTHER_SCHOOL }));
    assert.deepEqual(foreign.items, []);
    assert.equal(foreign.summary.total, 0);
  });
});

describe('TripAttendanceService authorization', () => {
  it('lets the dispatched driver and conductor read their own trip', async () => {
    const { service } = makeRepositories();
    assert.equal((await service.getManifest(DRIVER, TRIP_A, query())).items.length, 3);
    assert.equal((await service.getManifest(CONDUCTOR, TRIP_A, query())).items.length, 3);
  });

  it('lets crew rostered on the route through their active assignment operate', async () => {
    const { service, capture } = makeRepositories();
    const rosteredDriver = actorOf(UserRole.DRIVER, DRIVER_ROSTERED);
    const rosteredConductor = actorOf(UserRole.CONDUCTOR, CONDUCTOR_ROSTERED);

    assert.equal((await service.getManifest(rosteredDriver, TRIP_A, query())).items.length, 3);
    assert.equal((await service.getManifest(rosteredConductor, TRIP_A, query())).items.length, 3);

    for (const where of capture.assignmentFindAllWheres) {
      assert.equal(where.school_id, SCHOOL_A);
      assert.equal(where.route_id, ROUTE_A);
      assert.equal(where.is_active, true);
    }
    assert.deepEqual(
      capture.assignmentFindAllWheres.map((where) => where.role),
      [RouteAssignmentRole.DRIVER, RouteAssignmentRole.CONDUCTOR],
    );
  });

  it('hides the trip from crew without an effective assignment', async () => {
    const { service } = makeRepositories();

    for (const actor of [
      actorOf(UserRole.DRIVER, DRIVER_UNRELATED),
      actorOf(UserRole.DRIVER, DRIVER_EXPIRED),
      actorOf(UserRole.CONDUCTOR, DRIVER_ROSTERED),
    ]) {
      await rejectsWith(
        service.getManifest(actor, TRIP_A, query()),
        NotFoundException,
        TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
      );
    }
  });

  it('hides trips of another tenant behind the same generic 404', async () => {
    const { service } = makeRepositories();

    await rejectsWith(
      service.getManifest(ADMIN, TRIP_OTHER_SCHOOL, query()),
      NotFoundException,
      TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
    );
    await rejectsWith(
      service.getManifest(actorOf(UserRole.SCHOOL_ADMIN, ADMIN_A, SCHOOL_B), TRIP_A, query()),
      NotFoundException,
      TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
    );
    await rejectsWith(
      service.board(actorOf(UserRole.DRIVER, DRIVER_A, SCHOOL_B), TRIP_A, STUDENT_EARLY),
      NotFoundException,
      TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
    );
  });

  it('shows a parent only their actively linked children', async () => {
    const { service, capture } = makeRepositories([
      makeAttendanceRow({ student_id: STUDENT_EARLY }),
    ]);

    const manifest = await service.getManifest(PARENT, TRIP_A, query());
    assert.deepEqual(
      manifest.items.map((item) => item.student_id),
      [STUDENT_EARLY],
    );
    assert.deepEqual(manifest.summary, { total: 1, pending: 0, boarded: 1, dropped: 0 });
    assert.deepEqual(capture.guardianFindAllWheres, [
      { school_id: SCHOOL_A, user_id: PARENT_A, is_active: true },
    ]);
  });

  it('does not reveal a trip to a parent with no child on it', async () => {
    const { service } = makeRepositories();
    await rejectsWith(
      service.getManifest(actorOf(UserRole.PARENT, PARENT_UNRELATED), TRIP_A, query()),
      NotFoundException,
      TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
    );
  });

  it('lets a parent read their own child and hides everybody else’s', async () => {
    const { service } = makeRepositories([makeAttendanceRow({ student_id: STUDENT_EARLY })]);

    const own = await service.getStudent(PARENT, TRIP_A, STUDENT_EARLY);
    assert.equal(own.student_id, STUDENT_EARLY);
    assert.equal(own.status, TripAttendanceStatus.BOARDED);

    for (const studentId of [STUDENT_LATE, STUDENT_SECOND_STOP]) {
      await rejectsWith(
        service.getStudent(PARENT, TRIP_A, studentId),
        NotFoundException,
        TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
      );
    }
  });

  it('lets a school admin read a single pending manifest entry', async () => {
    const { service } = makeRepositories();
    const entry = await service.getStudent(ADMIN, TRIP_A, STUDENT_LATE);

    assert.equal(entry.id, null);
    assert.equal(entry.status, TripAttendanceStatus.PENDING);
    assert.equal(entry.stop_id, STOP_1);
    assert.equal(entry.admission_number, 'A-102');
    assert.equal(entry.created_at, null);
  });
});

describe('TripAttendanceService boarding', () => {
  it('boards a student with a server timestamp and the JWT subject', async () => {
    const { service, capture, rows } = makeRepositories();
    const before = Date.now();
    const result = await service.board(DRIVER, TRIP_A, STUDENT_EARLY);
    const after = Date.now();

    assert.equal(result.status, TripAttendanceStatus.BOARDED);
    assert.equal(result.student_id, STUDENT_EARLY);
    assert.equal(result.boarded_by, DRIVER_A);
    assert.equal(result.dropped_at, null);
    assert.ok(result.boarded_at !== null);
    const boardedAt = Date.parse(result.boarded_at as string);
    assert.ok(boardedAt >= before && boardedAt <= after, 'boarded_at must come from the server');

    assert.equal(capture.createPayloads.length, 1);
    assert.equal(capture.createPayloads[0].school_id, SCHOOL_A);
    assert.equal(capture.createPayloads[0].trip_id, TRIP_A);
    assert.equal(capture.createPayloads[0].student_id, STUDENT_EARLY);
    assert.equal(capture.createPayloads[0].stop_id, STOP_1);
    assert.equal(capture.transactions, 1);
    assert.ok(capture.createOptions[0]?.transaction, 'the insert must join the transaction');
    assert.equal(rows.length, 1);
  });

  it('lets the conductor and the school admin board as well', async () => {
    for (const actor of [CONDUCTOR, ADMIN]) {
      const { service } = makeRepositories();
      const result = await service.board(actor, TRIP_A, STUDENT_LATE);
      assert.equal(result.status, TripAttendanceStatus.BOARDED);
      assert.equal(result.boarded_by, actor.id);
    }
  });

  it('rejects boarding the same student twice', async () => {
    const { service } = makeRepositories([
      makeAttendanceRow({ student_id: STUDENT_EARLY, status: TripAttendanceStatus.BOARDED }),
    ]);
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE,
    );
  });

  it('rejects re-boarding a student that already left the bus', async () => {
    const { service } = makeRepositories([
      makeAttendanceRow({
        student_id: STUDENT_EARLY,
        status: TripAttendanceStatus.DROPPED,
        dropped_at: new Date('2026-09-01T07:00:00.000Z'),
        dropped_by: DRIVER_A,
      }),
    ]);
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE,
    );
  });

  it('translates a concurrent insert (unique index) into the duplicate conflict', async () => {
    const { service } = makeRepositories([], emptyCapture(), {
      createError: new UniqueConstraintError({}),
    });
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE,
    );
  });

  it('promotes an existing PENDING row instead of inserting a second one', async () => {
    const pending = makeAttendanceRow({
      student_id: STUDENT_EARLY,
      status: TripAttendanceStatus.PENDING,
      boarded_at: null,
      boarded_by: null,
    });
    const { service, capture, rows } = makeRepositories([pending]);

    const result = await service.board(CONDUCTOR, TRIP_A, STUDENT_EARLY);
    assert.equal(result.status, TripAttendanceStatus.BOARDED);
    assert.equal(result.boarded_by, CONDUCTOR_A);
    assert.equal(capture.createPayloads.length, 0);
    assert.equal(rows.length, 1);
    assert.equal(pending.status, TripAttendanceStatus.BOARDED);
  });

  it('refuses a student that is not on this trip', async () => {
    const { service } = makeRepositories();

    // Wrong route: the student's stop belongs to another route of the school.
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_OTHER_ROUTE),
      NotFoundException,
      TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
    );
    // Wrong trip: the same student on a trip of a different route.
    await rejectsWith(
      service.board(DRIVER, TRIP_OTHER_ROUTE, STUDENT_EARLY),
      NotFoundException,
      TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
    );
    // Another tenant's student.
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_OTHER_SCHOOL),
      NotFoundException,
      TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
    );
    // Inactive student and a student without an allocated stop.
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_INACTIVE),
      NotFoundException,
      TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
    );
    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_NO_STOP),
      NotFoundException,
      TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
    );
  });

  it('refuses to record attendance on a completed or cancelled trip', async () => {
    for (const tripId of [TRIP_COMPLETED, TRIP_CANCELLED]) {
      const { service, capture } = makeRepositories();
      await rejectsWith(
        service.board(DRIVER, tripId, STUDENT_EARLY),
        ConflictException,
        TRIP_ATTENDANCE_TRIP_CLOSED_MESSAGE,
      );
      assert.equal(capture.createPayloads.length, 0);
      assert.equal(capture.transactions, 0);
    }
  });

  it('fails loudly when no Sequelize instance backs the repository', async () => {
    const { service } = makeRepositories([], emptyCapture(), { withSequelize: false });
    await assert.rejects(
      service.board(DRIVER, TRIP_A, STUDENT_EARLY),
      InternalServerErrorException,
    );
  });
});

describe('TripAttendanceService drop off', () => {
  it('drops a boarded student with a server timestamp and the JWT subject', async () => {
    const boarded = makeAttendanceRow({
      student_id: STUDENT_EARLY,
      boarded_at: new Date(Date.now() - 60_000),
    });
    const updateOptions: Array<Record<string, unknown> | undefined> = [];
    const storedUpdate = boarded.update;
    boarded.update = async (values, options) => {
      updateOptions.push(options as Record<string, unknown> | undefined);
      return storedUpdate(values, options);
    };
    const { service, capture } = makeRepositories([boarded]);

    const before = Date.now();
    const result = await service.drop(CONDUCTOR, TRIP_A, STUDENT_EARLY);
    const after = Date.now();

    assert.equal(result.status, TripAttendanceStatus.DROPPED);
    assert.equal(result.dropped_by, CONDUCTOR_A);
    assert.equal(result.boarded_by, DRIVER_A, 'the boarding audit must stay untouched');
    assert.ok(result.dropped_at !== null);
    const droppedAt = Date.parse(result.dropped_at as string);
    assert.ok(droppedAt >= before && droppedAt <= after);
    assert.ok(droppedAt >= Date.parse(result.boarded_at as string));
    assert.equal(capture.transactions, 1);
    assert.equal(updateOptions.length, 1);
    assert.ok(updateOptions[0]?.transaction, 'the update must join the transaction');
  });

  it('rejects dropping a student that never boarded', async () => {
    const { service } = makeRepositories();
    await rejectsWith(
      service.drop(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_NOT_BOARDED_MESSAGE,
    );

    const { service: pendingService } = makeRepositories([
      makeAttendanceRow({
        student_id: STUDENT_EARLY,
        status: TripAttendanceStatus.PENDING,
        boarded_at: null,
        boarded_by: null,
      }),
    ]);
    await rejectsWith(
      pendingService.drop(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_NOT_BOARDED_MESSAGE,
    );
  });

  it('rejects dropping the same student twice', async () => {
    const { service } = makeRepositories([
      makeAttendanceRow({
        student_id: STUDENT_EARLY,
        status: TripAttendanceStatus.DROPPED,
        dropped_at: new Date('2026-09-01T07:00:00.000Z'),
        dropped_by: DRIVER_A,
      }),
    ]);
    await rejectsWith(
      service.drop(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE,
    );
  });

  it('refuses to drop on a completed or cancelled trip', async () => {
    for (const tripId of [TRIP_COMPLETED, TRIP_CANCELLED]) {
      const { service } = makeRepositories([
        makeAttendanceRow({ trip_id: tripId, student_id: STUDENT_EARLY }),
      ]);
      await rejectsWith(
        service.drop(ADMIN, tripId, STUDENT_EARLY),
        ConflictException,
        TRIP_ATTENDANCE_TRIP_CLOSED_MESSAGE,
      );
    }
  });

  it('keeps the full board → drop lifecycle consistent', async () => {
    const { service } = makeRepositories();

    const boarded = await service.board(DRIVER, TRIP_A, STUDENT_EARLY);
    assert.equal(boarded.status, TripAttendanceStatus.BOARDED);

    const manifestAfterBoarding = await service.getManifest(DRIVER, TRIP_A, query());
    assert.deepEqual(manifestAfterBoarding.summary, {
      total: 3,
      pending: 2,
      boarded: 1,
      dropped: 0,
    });

    const dropped = await service.drop(DRIVER, TRIP_A, STUDENT_EARLY);
    assert.equal(dropped.status, TripAttendanceStatus.DROPPED);
    assert.equal(dropped.id, boarded.id);

    const manifestAfterDrop = await service.getManifest(DRIVER, TRIP_A, query());
    assert.deepEqual(manifestAfterDrop.summary, { total: 3, pending: 2, boarded: 0, dropped: 1 });

    await rejectsWith(
      service.board(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE,
    );
    await rejectsWith(
      service.drop(DRIVER, TRIP_A, STUDENT_EARLY),
      ConflictException,
      TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE,
    );
  });

  it('scopes every attendance lookup and write to the JWT tenant and trip', async () => {
    const { service, capture } = makeRepositories([
      makeAttendanceRow({ student_id: STUDENT_EARLY }),
    ]);
    await service.drop(DRIVER, TRIP_A, STUDENT_EARLY);

    for (const options of capture.attendanceFindOneOptions) {
      const where = options.where as Record<string, unknown>;
      assert.equal(where.school_id, SCHOOL_A);
      assert.equal(where.trip_id, TRIP_A);
      assert.equal(where.student_id, STUDENT_EARLY);
      assert.ok(options.transaction, 'the locked read must run inside the transaction');
    }
  });
});
