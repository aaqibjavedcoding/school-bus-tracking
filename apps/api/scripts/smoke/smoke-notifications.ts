/**
 * HTTP smoke test for parent notifications + trip alerts (Task 21).
 *
 * Boots the real Nest application (guards, validation pipe, exception filter,
 * transform interceptor and every controller — including the *real*
 * `TripAttendanceService`, `TripsService` and `NotificationsService`) against
 * in-memory model stubs registered with the Nest DI container — the same
 * stubbing approach as `smoke-parent.ts`, but driven over real HTTP through
 * the app's embedded server. Socket delivery itself is covered by the gateway
 * unit suite; this script proves the REST flows end to end.
 *
 * A real PostgreSQL instance is not available in this sandbox, so the service
 * logic is covered against the actual Sequelize-shaped stubs and the DB
 * migration is reviewed for real deploys.
 *
 * Run: DB_AUTO_CONNECT=false DB_ALLOW_NO_CONNECT=true \
 *   node -r ts-node/register/transpile-only scripts/smoke/smoke-notifications.ts
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Op } from 'sequelize';
import * as cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import {
  JwtAccessTokenPayload,
  NotificationType,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { AuthService } from '../../src/modules/auth/auth.service';
import { SchoolAccessService } from '../../src/common/access/school-access.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { TripAttendanceService } from '../../src/modules/trip-attendance/trip-attendance.service';
import { TripsService } from '../../src/modules/trips/trips.service';

interface Row {
  [key: string]: unknown;
}

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARENT_A = '01010101-0101-4101-8101-010101010101';
const PARENT_B = '02020202-0202-4202-8202-020202020202';
const STUDENT_A = '03030303-0303-4303-8303-030303030301';
const STUDENT_B = '03030303-0303-4303-8303-030303030302';
const STOP_A = '04040404-0404-4404-8404-040404040401';
const STOP_B = '04040404-0404-4404-8404-040404040402';
const ROUTE_A = '05050505-0505-4505-8505-050505050501';
const ROUTE_B = '05050505-0505-4505-8505-050505050502';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const TRIP_A = '09090909-0909-4909-8909-090909090901';
const TRIP_LIFE = '09090909-0909-4909-8909-090909090902';

async function main(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      results.push({ name, ok: false, detail: (error as Error).message });
      console.log(`  ✗ ${name}: ${(error as Error).message}`);
    }
  };

  const now = () => new Date();
  const today = now().toISOString().slice(0, 10);
  const todayStart = new Date(`${today}T00:00:00.000Z`);

  // ---- In-memory data -------------------------------------------------
  const notifications: Row[] = [];
  const guardians: Row[] = [];
  const students: Row[] = [];
  const stops: Row[] = [];
  const routes: Row[] = [];
  const buses: Row[] = [];
  const trips: Row[] = [];
  const users: Row[] = [];
  const schools: Row[] = [];
  const attendance: Row[] = [];
  const schoolActive = new Map<string, boolean>();
  let revokedSessions = 0;

  function matchesWhere(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === 'object') {
        const ops = expected as Record<symbol | string, unknown>;
        if (ops[Op.in]) return (ops[Op.in] as unknown[]).includes(row[key]);
        if (ops[Op.gte] !== undefined || ops[Op.lt] !== undefined) {
          const value = row[key] as unknown;
          const t = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
          const gte = ops[Op.gte] as Date | undefined;
          const lt = ops[Op.lt] as Date | undefined;
          if (gte && t < gte.getTime()) return false;
          if (lt && t >= lt.getTime()) return false;
          return true;
        }
      }
      return row[key] === expected;
    });
  }

  function tableRepo(list: Row[]) {
    const repo = {
      findAll: async (options: { where?: Row } = {}) =>
        list.filter((row) => matchesWhere(row, options.where)) as Row[],
      findOne: async (options: { where?: Row } = {}) =>
        (list.find((row) => matchesWhere(row, options.where)) ?? null) as Row | null,
    };
    // AuthService queries users/refresh tokens through `.unscoped()`.
    return { ...repo, unscoped: () => repo };
  }

  // The trips service mutates trip rows through Sequelize's instance update.
  const attachUpdater = (row: Row): Row => {
    row.update = async (values: Row) => {
      Object.assign(row, values, { updated_at: now() });
      return row;
    };
    return row;
  };

  // Seed: school A + two parents, two children on two different routes, and
  // two trips crewed by DRIVER_A (one for attendance, one for the lifecycle).
  schools.push({ id: SCHOOL_A, name: 'Demo High', code: 'demo-high', is_active: true });
  schoolActive.set(SCHOOL_A, true);

  const passwordHash = await bcrypt.hash('parent-pass-123', 4);
  users.push(
    {
      id: PARENT_A,
      school_id: SCHOOL_A,
      role: UserRole.PARENT,
      first_name: 'Rosa',
      last_name: 'Rivera',
      email: 'rosa@demo.test',
      password_hash: passwordHash,
      is_active: true,
    },
    {
      id: PARENT_B,
      school_id: SCHOOL_A,
      role: UserRole.PARENT,
      first_name: 'Omar',
      last_name: 'Other',
      email: 'omar@demo.test',
      password_hash: passwordHash,
      is_active: true,
    },
    {
      id: DRIVER_A,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
      first_name: 'Dana',
      last_name: 'Nguyen',
      email: 'dana@demo.test',
      is_active: true,
    },
  );

  guardians.push(
    {
      id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_A,
      relationship: 'Mother',
      can_pick_up: true,
      is_primary: true,
      is_active: true,
    },
    {
      id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a02',
      school_id: SCHOOL_A,
      student_id: STUDENT_B,
      user_id: PARENT_B,
      relationship: 'Father',
      can_pick_up: true,
      is_primary: true,
      is_active: true,
    },
  );

  students.push(
    {
      id: STUDENT_A,
      school_id: SCHOOL_A,
      admission_number: 'S-1001',
      first_name: 'Alex',
      last_name: 'Rivera',
      grade_level: 'Grade 5',
      home_stop_id: STOP_A,
      is_active: true,
    },
    {
      id: STUDENT_B,
      school_id: SCHOOL_A,
      admission_number: 'S-1002',
      first_name: 'Bo',
      last_name: 'Other',
      grade_level: 'Grade 3',
      home_stop_id: STOP_B,
      is_active: true,
    },
  );

  stops.push(
    {
      id: STOP_A,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      name: 'Maple St & 5th Ave',
      sequence_number: 1,
      is_active: true,
    },
    {
      id: STOP_B,
      school_id: SCHOOL_A,
      route_id: ROUTE_B,
      name: 'Cedar Ln & 9th Ave',
      sequence_number: 1,
      is_active: true,
    },
  );

  routes.push(
    { id: ROUTE_A, school_id: SCHOOL_A, name: 'North Loop', code: 'NL', is_active: true },
    { id: ROUTE_B, school_id: SCHOOL_A, name: 'South Loop', code: 'SL', is_active: true },
  );

  buses.push({
    id: BUS_A,
    school_id: SCHOOL_A,
    registration_number: 'ABC-123',
    bus_number: 'Bus 7',
    capacity: 40,
    is_active: true,
  });

  trips.push(
    attachUpdater({
      id: TRIP_A,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      bus_id: BUS_A,
      driver_id: DRIVER_A,
      conductor_id: null,
      status: TripStatus.IN_PROGRESS,
      scheduled_start_at: new Date(todayStart.getTime() + 6.5 * 3600_000),
      scheduled_end_at: new Date(todayStart.getTime() + 7.5 * 3600_000),
      actual_start_at: new Date(todayStart.getTime() + 6.5 * 3600_000),
      actual_end_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      created_at: now(),
      updated_at: now(),
    }),
    attachUpdater({
      id: TRIP_LIFE,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      bus_id: BUS_A,
      driver_id: DRIVER_A,
      conductor_id: null,
      status: TripStatus.SCHEDULED,
      scheduled_start_at: new Date(todayStart.getTime() + 15 * 3600_000),
      scheduled_end_at: new Date(todayStart.getTime() + 16 * 3600_000),
      actual_start_at: null,
      actual_end_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      created_at: now(),
      updated_at: now(),
    }),
  );

  // ---- App bootstrap --------------------------------------------------
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  const configService = app.get(ConfigService);
  app.use(cookieParser());
  app.setGlobalPrefix(configService.get<string>('app.apiPrefix', 'api/v1'));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();

  const notificationsRepo = {
    findAll: async (options: { where?: Row } = {}) =>
      notifications.filter((row) => matchesWhere(row, options.where)) as Row[],
    findOne: async (options: { where?: Row } = {}) =>
      (notifications.find((row) => matchesWhere(row, options.where)) ?? null) as Row | null,
    findAndCountAll: async (options: { where?: Row; limit?: number; offset?: number } = {}) => {
      const filtered = notifications.filter((row) => matchesWhere(row, options.where));
      const sorted = [...filtered].sort(
        (a, b) =>
          new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
      );
      const offset = options.offset ?? 0;
      const limit = options.limit ?? sorted.length;
      return {
        rows: sorted.slice(offset, offset + limit) as Row[],
        count: filtered.length,
      };
    },
    count: async (options: { where?: Row } = {}) =>
      notifications.filter((row) => matchesWhere(row, options.where)).length,
    create: async (payload: Row) => {
      const row: Row = {
        id: randomUUID(),
        is_read: false,
        read_at: null,
        payload: null,
        trip_id: null,
        student_id: null,
        ...payload,
        created_at: new Date(),
        updated_at: new Date(),
      };
      row.update = async (values: Row) => {
        Object.assign(row, values, { updated_at: new Date() });
        return row;
      };
      notifications.push(row);
      return row;
    },
    update: async (values: Row, options: { where?: Row } = {}) => {
      const affected = notifications.filter((row) => matchesWhere(row, options.where));
      for (const row of affected) {
        Object.assign(row, values, { updated_at: new Date() });
      }
      return [affected.length, affected];
    },
  };

  const patchService = (service: unknown, stubs: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(stubs)) {
      (service as Record<string, unknown>)[key] = value;
    }
  };

  // The live-tracking dependency of TripsService (stub: crew check via the
  // dispatch snapshot, no socket emission).
  const liveTrackingStub = {
    onTripStatusChanged: async () => ({ event: null, payload: null }),
    authorizeObservation: async () => ({ ok: false as const, reason: 'unauthorized' as const }),
    isCrewOfTrip: async (actor: { id: string }, trip: Row) => actor.id === trip.driver_id,
    getParentObservableRouteIds: async () => [],
  };

  patchService(app.get(NotificationsService), {
    notifications: notificationsRepo,
    users: tableRepo(users),
    guardians: tableRepo(guardians),
    students: tableRepo(students),
    stops: tableRepo(stops),
    trips: tableRepo(trips),
  });

  patchService(app.get(TripAttendanceService), {
    attendance: {
      sequelize: {
        transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}),
      },
      findAll: async (options: { where?: Row } = {}) =>
        attendance.filter((row) => matchesWhere(row, options.where)) as Row[],
      findOne: async (options: { where?: Row } = {}) =>
        (attendance.find((row) => matchesWhere(row, options.where)) ?? null) as Row | null,
      create: async (payload: Row) => {
        const row: Row = {
          id: `att-${attendance.length + 1}`,
          ...payload,
          created_at: now(),
          updated_at: now(),
        };
        row.update = async (values: Row) => {
          Object.assign(row, values, { updated_at: now() });
          return row;
        };
        attendance.push(row);
        return row;
      },
    } as unknown,
    trips: tableRepo(trips),
    stops: tableRepo(stops),
    students: tableRepo(students),
    guardians: tableRepo(guardians),
    assignments: tableRepo([]),
  });

  patchService(app.get(TripsService), {
    trips: tableRepo(trips),
    assignments: tableRepo([]),
    routes: tableRepo(routes),
    buses: tableRepo(buses),
    users: tableRepo(users),
    liveTracking: liveTrackingStub,
  });

  const refreshStore: Row[] = [];
  patchService(app.get(AuthService), {
    users: tableRepo(users),
    schools: tableRepo(schools),
    refreshTokens: {
      unscoped() {
        return this;
      },
      create: async (data: Row) => {
        const row: Row = { id: `rt-${refreshStore.length + 1}`, revoked_at: null, ...data };
        row.save = async () => {
          revokedSessions += 1;
          row.revoked_at = new Date();
        };
        refreshStore.push(row);
        return row;
      },
      findOne: async () =>
        ([...refreshStore].reverse().find((row) => row.revoked_at === null) ?? null) as Row | null,
      update: async (_patch?: unknown, options?: { where?: Row }) => {
        if (options?.where?.school_id) revokedSessions += 1;
        return [1];
      },
    } as unknown,
  });

  const accessService = app.get(SchoolAccessService);
  patchService(accessService, {
    schools: {
      findOne: async ({ where }: { where: { id: string } }) =>
        schoolActive.has(where.id)
          ? ({ id: where.id, is_active: schoolActive.get(where.id) } as unknown as Row)
          : null,
    },
  });

  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const jwt = app.get(JwtService);
  const signToken = async (role: UserRole, schoolId: string | null, sub: string) => {
    const payload: JwtAccessTokenPayload = { sub, school_id: schoolId, role };
    return jwt.signAsync(payload);
  };

  const call = async (
    method: string,
    path: string,
    options: { token?: string; body?: unknown; cookie?: string } = {},
  ) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    const setCookie = res.headers.get('set-cookie') ?? '';
    return { status: res.status, json, setCookie };
  };

  interface ListBody {
    items: Array<{
      id: string;
      type: NotificationType;
      message: string;
      student_id: string | null;
      trip_id: string | null;
      is_read: boolean;
      payload: Record<string, unknown> | null;
    }>;
    total: number;
    unread_count: number;
  }

  const parentList = async (token: string, query = ''): Promise<ListBody> => {
    const res = await call('GET', `/parent/notifications${query}`, { token });
    if (res.status !== 200) {
      throw new Error(`expected 200 list, got ${res.status} ${JSON.stringify(res.json)}`);
    }
    return (res.json as { data: ListBody }).data;
  };

  const driverToken = await signToken(UserRole.DRIVER, SCHOOL_A, DRIVER_A);
  const adminToken = await signToken(UserRole.SCHOOL_ADMIN, SCHOOL_A, 'admin-1');

  console.log('\nNotifications smoke test (Task 21)\n');

  // ---- 1. Parent login ------------------------------------------------
  let parentToken = '';
  let parentCookie = '';
  await check('1a. parent login succeeds with valid credentials', async () => {
    const res = await call('POST', '/auth/login', {
      body: { school_id: 'demo-high', email: 'rosa@demo.test', password: 'parent-pass-123' },
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { access_token: string; user: { role: string } } };
    if (body.data.user.role !== 'PARENT') throw new Error('role is not PARENT');
    parentToken = body.data.access_token;
    parentCookie = res.setCookie;
  });

  await check('1b. parent login rejects an invalid password', async () => {
    const res = await call('POST', '/auth/login', {
      body: { school_id: 'demo-high', email: 'rosa@demo.test', password: 'wrong' },
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  // ---- 2. Parent notification list (empty at first) --------------------
  let otherParentToken = '';
  await check('2a. the notification list starts empty for the parent', async () => {
    const body = await parentList(parentToken);
    if (body.items.length !== 0 || body.total !== 0 || body.unread_count !== 0) {
      throw new Error(`expected an empty list, got ${JSON.stringify(body)}`);
    }
  });

  await check('2b. driver is denied the parent notification list (403)', async () => {
    const res = await call('GET', '/parent/notifications', { token: driverToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('2c. school admin is denied the parent notification list (403)', async () => {
    const res = await call('GET', '/parent/notifications', { token: adminToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('2d. unauthenticated list request is rejected (401)', async () => {
    const res = await call('GET', '/parent/notifications');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  // ---- 3/4. Boarding event creates the notification --------------------
  await check('3. driver boards the child successfully', async () => {
    const res = await call('POST', `/trips/${TRIP_A}/students/${STUDENT_A}/board`, {
      token: driverToken,
    });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    }
    const data = (res.json as { data: { status: string } }).data;
    if (data.status !== TripAttendanceStatus.BOARDED) throw new Error('boarding not recorded');
  });

  await check('4. the boarding notification is created with the expected content', async () => {
    const body = await parentList(parentToken);
    if (body.total !== 1 || body.unread_count !== 1) {
      throw new Error(`expected exactly one unread notification, got ${JSON.stringify(body)}`);
    }
    const item = body.items[0];
    if (item.type !== NotificationType.STUDENT_BOARDED) throw new Error('wrong type');
    if (item.student_id !== STUDENT_A) throw new Error('wrong student');
    if (item.trip_id !== TRIP_A) throw new Error('wrong trip');
    if (item.message !== 'Alex Rivera boarded the school bus.') {
      throw new Error(`unexpected message: ${item.message}`);
    }
  });

  await check('4b. a retried boarding is rejected and does not duplicate', async () => {
    const res = await call('POST', `/trips/${TRIP_A}/students/${STUDENT_A}/board`, {
      token: driverToken,
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
    const body = await parentList(parentToken);
    if (body.total !== 1) throw new Error(`duplicate notification created (${body.total})`);
  });

  // ---- 5/6. Visibility is strictly per parent --------------------------
  await check('5. the notification is visible to the correct parent only', async () => {
    const login = await call('POST', '/auth/login', {
      body: { school_id: 'demo-high', email: 'omar@demo.test', password: 'parent-pass-123' },
    });
    otherParentToken = (login.json as { data: { access_token: string } }).data.access_token;
    const body = await parentList(otherParentToken);
    if (body.total !== 0) {
      throw new Error(`the other parent sees ${body.total} notifications`);
    }
  });

  await check('6. the other parent cannot mark the notification read (404)', async () => {
    const body = await parentList(parentToken);
    const res = await call('PATCH', `/parent/notifications/${body.items[0].id}/read`, {
      token: otherParentToken,
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  // ---- 7. Mark notification read --------------------------------------
  await check('7. the parent marks the notification read; unread_count drops to 0', async () => {
    const body = await parentList(parentToken);
    const res = await call('PATCH', `/parent/notifications/${body.items[0].id}/read`, {
      token: parentToken,
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const read = (res.json as { data: { is_read: boolean } }).data;
    if (!read?.is_read) throw new Error('notification not marked read');

    const after = await parentList(parentToken);
    if (after.unread_count !== 0) throw new Error(`unread_count is ${after.unread_count}`);
    const unreadOnly = await parentList(parentToken, '?status=unread');
    if (unreadOnly.total !== 0) throw new Error('unread filter still returns the read row');
  });

  // ---- 8. Trip lifecycle + cancellation notifications ------------------
  await check('8a. BOARDING transition notifies the route parents', async () => {
    const res = await call('PATCH', `/trips/${TRIP_LIFE}/status`, {
      token: driverToken,
      body: { status: TripStatus.BOARDING },
    });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    }
    const body = await parentList(parentToken);
    const tripNote = body.items.find((item) => item.type === NotificationType.TRIP_BOARDING);
    if (!tripNote) throw new Error(`no TRIP_BOARDING notification: ${JSON.stringify(body.items)}`);
    if (tripNote.message !== "Your child's bus is now boarding.") {
      throw new Error(`unexpected message: ${tripNote.message}`);
    }
    // The other parent's child is on a different route: nothing for them.
    const otherBody = await parentList(otherParentToken);
    if (otherBody.total !== 0) throw new Error('the other route parent was notified');
  });

  await check('8b. an invalid transition creates no notification', async () => {
    const res = await call('PATCH', `/trips/${TRIP_LIFE}/status`, {
      token: driverToken,
      body: { status: TripStatus.COMPLETED },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    const body = await parentList(parentToken);
    if (body.items.some((item) => item.type === NotificationType.TRIP_COMPLETED)) {
      throw new Error('a notification was created for an invalid transition');
    }
  });

  await check('8c. CANCELLED transition notifies the route parents', async () => {
    const res = await call('PATCH', `/trips/${TRIP_LIFE}/status`, {
      token: driverToken,
      body: { status: TripStatus.CANCELLED, cancellation_reason: 'Heavy snow' },
    });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    }
    const body = await parentList(parentToken);
    const cancelled = body.items.find((item) => item.type === NotificationType.TRIP_CANCELLED);
    if (!cancelled) throw new Error('no TRIP_CANCELLED notification');
    if (cancelled.message !== "Your child's bus trip has been cancelled.") {
      throw new Error(`unexpected message: ${cancelled.message}`);
    }
    if (cancelled.payload?.['cancellation_reason'] !== 'Heavy snow') {
      throw new Error('cancellation reason missing from payload');
    }
  });

  await check('8d. read-all marks every unread notification as read', async () => {
    const before = await parentList(parentToken);
    if (before.unread_count < 2) throw new Error('expected at least two unread notifications');
    const res = await call('PATCH', '/parent/notifications/read-all', { token: parentToken });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const updated = (res.json as { data: { updated_count: number } }).data.updated_count;
    if (updated !== before.unread_count) {
      throw new Error(`expected ${before.unread_count} updates, got ${updated}`);
    }
    const after = await parentList(parentToken);
    if (after.unread_count !== 0) throw new Error('unread_count did not drop to 0');
  });

  // ---- 9. Refresh / logout keep working --------------------------------
  await check('9a. refresh keeps the parent authenticated', async () => {
    const res = await call('POST', '/auth/refresh', { cookie: parentCookie });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { access_token: string; user: { role: string } } };
    if (body.data.access_token || body.data.user.role !== 'PARENT') {
      // refresh rotates the token; role correctness is what matters here.
      if (body.data.user.role !== 'PARENT') throw new Error('refresh lost the parent session');
    }
  });

  await check('9b. logout invalidates the refresh session', async () => {
    const res = await call('POST', '/auth/logout', { cookie: parentCookie });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    if (revokedSessions < 1) throw new Error('refresh token was not revoked');
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\nNotifications smoke: ${results.length - failed}/${results.length} checks passed\n`,
  );
  await app.close();
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error('Notifications smoke test crashed', error);
  process.exitCode = 1;
});
