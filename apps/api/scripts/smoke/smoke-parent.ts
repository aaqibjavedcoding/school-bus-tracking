/**
 * HTTP smoke test for the Parent Portal (Task 20).
 *
 * Boots the real Nest application (guards, validation pipe, exception filter,
 * transform interceptor and every controller) against in-memory model stubs
 * registered with the Nest DI container — the same stubbing approach as the
 * unit suites and `smoke-admin.ts`, but driven over real HTTP through the
 * app's embedded server. A real PostgreSQL instance is not available in this
 * sandbox, so the service logic is covered against the actual Sequelize-shaped
 * stubs and the DB migration is reviewed for real deploys.
 *
 * Run: DB_AUTO_CONNECT=false DB_ALLOW_NO_CONNECT=true \
 *   node -r ts-node/register/transpile-only scripts/smoke/smoke-parent.ts
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Op } from 'sequelize';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { JwtService } from '@nestjs/jwt';
import {
  JwtAccessTokenPayload,
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { School } from '../../src/database/models';
import { AuthService } from '../../src/modules/auth/auth.service';
import { LiveTrackingService } from '../../src/modules/live-tracking/live-tracking.service';
import { SchoolAccessService } from '../../src/common/access/school-access.service';
import { ParentPortalService } from '../../src/modules/parent-portal/parent-portal.service';

interface Row {
  [key: string]: unknown;
}

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARENT_A = '01010101-0101-4101-8101-010101010101';
const PARENT_B = '02020202-0202-4202-8202-020202020202';
const STUDENT_A = '03030303-0303-4303-8303-030303030301';
const STUDENT_B = '03030303-0303-4303-8303-030303030302';
const STOP_A = '04040404-0404-4404-8404-040404040401';
const ROUTE_A = '05050505-0505-4505-8505-050505050501';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const CONDUCTOR_A = '08080808-0808-4808-8808-080808080801';
const TRIP_A = '09090909-0909-4909-8909-090909090901';

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
  const guardians: Row[] = [];
  const students: Row[] = [];
  const stops: Row[] = [];
  const routes: Row[] = [];
  const buses: Row[] = [];
  const trips: Row[] = [];
  const users: Row[] = [];
  const schools: Row[] = [];
  const schoolActive = new Map<string, boolean>();
  let revokedSessions = 0;

  // Helper: compare a row to a Sequelize where clause (equality + Op.in +
  // Op.gte / Op.lt date-range windows).
  function matchesWhere(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, expected]) => {
      if (expected && typeof expected === 'object') {
        const ops = expected as Record<symbol | string, unknown>;
        if (ops[Op.in]) return (ops[Op.in] as unknown[]).includes(row[key]);
        if (ops[Op.gte] !== undefined) {
          const value = row[key] as unknown;
          const gte = ops[Op.gte] as Date;
          const lt = ops[Op.lt] as Date | undefined;
          const t = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
          if (t < gte.getTime()) return false;
          if (lt !== undefined && t >= lt.getTime()) return false;
          return true;
        }
      }
      return row[key] === expected;
    });
  }

  function tableRepo(list: Row[]) {
    const repo = {
      findAll: async (options: { where?: Row; order?: unknown } = {}) =>
        list.filter((row) => matchesWhere(row, options.where)) as Row[],
      findOne: async (options: { where?: Row } = {}) =>
        (list.find((row) => matchesWhere(row, options.where)) ?? null) as Row | null,
    };
    // AuthService queries users/refresh tokens through `.unscoped()`.
    return { ...repo, unscoped: () => repo };
  }

  // Seed: school A (active) + parent A + linked student A on route A.
  schools.push({
    id: SCHOOL_A,
    name: 'Demo High',
    code: 'demo-high',
    is_active: true,
    timezone: 'UTC',
  });
  schoolActive.set(SCHOOL_A, true);

  const parentHash = await bcrypt.hash('parent-pass-123', 4);
  users.push({
    id: PARENT_A,
    school_id: SCHOOL_A,
    role: UserRole.PARENT,
    first_name: 'Rosa',
    last_name: 'Rivera',
    email: 'rosa@demo.test',
    password_hash: parentHash,
    is_active: true,
  });
  users.push({
    id: PARENT_B,
    school_id: SCHOOL_A,
    role: UserRole.PARENT,
    first_name: 'Other',
    last_name: 'Parent',
    email: 'other@demo.test',
    password_hash: parentHash,
    is_active: true,
  });
  users.push({
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    first_name: 'Dana',
    last_name: 'Nguyen',
    email: 'dana@demo.test',
    is_active: true,
  });
  users.push({
    id: CONDUCTOR_A,
    school_id: SCHOOL_A,
    role: UserRole.CONDUCTOR,
    first_name: 'Cara',
    last_name: 'Lee',
    email: 'cara@demo.test',
    is_active: true,
  });

  guardians.push({
    id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a01',
    school_id: SCHOOL_A,
    student_id: STUDENT_A,
    user_id: PARENT_A,
    relationship: 'Mother',
    can_pick_up: true,
    is_primary: true,
    is_active: true,
  });
  // A second child belongs to another parent (PARENT_B) — isolation check.
  guardians.push({
    id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a02',
    school_id: SCHOOL_A,
    student_id: STUDENT_B,
    user_id: PARENT_B,
    relationship: 'Father',
    can_pick_up: true,
    is_primary: true,
    is_active: true,
  });

  students.push({
    id: STUDENT_A,
    school_id: SCHOOL_A,
    admission_number: 'S-1001',
    first_name: 'Alex',
    last_name: 'Rivera',
    grade_level: 'Grade 5',
    home_stop_id: STOP_A,
    is_active: true,
  });
  students.push({
    id: STUDENT_B,
    school_id: SCHOOL_A,
    admission_number: 'S-1002',
    first_name: 'Bo',
    last_name: 'Parent',
    grade_level: 'Grade 3',
    home_stop_id: STOP_A,
    is_active: true,
  });

  stops.push({
    id: STOP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    name: 'Maple St & 5th Ave',
    latitude: 40.71,
    longitude: -74.0,
    sequence_number: 2,
    geofence_radius_meters: 100,
    estimated_arrival_time: '07:10',
    is_active: true,
    created_at: now(),
    updated_at: now(),
  });

  routes.push({
    id: ROUTE_A,
    school_id: SCHOOL_A,
    name: 'North Loop',
    code: 'NL',
    is_active: true,
    created_at: now(),
    updated_at: now(),
  });

  buses.push({
    id: BUS_A,
    school_id: SCHOOL_A,
    registration_number: 'ABC-123',
    bus_number: 'Bus 7',
    capacity: 40,
    is_active: true,
    created_at: now(),
    updated_at: now(),
  });

  trips.push({
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: BUS_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: new Date(todayStart.getTime() + 6.5 * 3600_000),
    scheduled_end_at: new Date(todayStart.getTime() + 7.5 * 3600_000),
    actual_start_at: new Date(todayStart.getTime() + 6.5 * 3600_000),
    actual_end_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: now(),
    updated_at: now(),
  });

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

  const guardiansRepo = tableRepo(guardians);
  const studentsRepo = tableRepo(students);
  const stopsRepo = tableRepo(stops);
  const routesRepo = tableRepo(routes);
  const busesRepo = tableRepo(buses);
  const tripsRepo = tableRepo(trips);
  const usersRepo = tableRepo(users);
  const schoolsRepo = tableRepo(schools);

  const patchService = (service: unknown, stubs: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(stubs)) {
      (service as Record<string, unknown>)[key] = value;
    }
  };

  const parentService = app.get(ParentPortalService);
  patchService(parentService, {
    guardians: guardiansRepo,
    students: studentsRepo,
    stops: stopsRepo,
    routes: routesRepo,
    buses: busesRepo,
    trips: tripsRepo,
    users: usersRepo,
    schools: schoolsRepo,
    liveTracking: {
      // Read-only snapshot: latest fix or null (never fabricated).
      getLatestLocationResponse: async () => ({
        id: 'loc-1',
        school_id: SCHOOL_A,
        trip_id: TRIP_A,
        latitude: 40.712,
        longitude: -74.003,
        accuracy: 10,
        speed: 32,
        heading: 90,
        recorded_at: now().toISOString(),
        received_at: now().toISOString(),
      }),
    },
    tripAttendance: {
      // Read-only attendance: child already boarded today.
      getStudent: async () => ({
        id: 'att-1',
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
        boarded_at: now().toISOString(),
        boarded_by: DRIVER_A,
        dropped_at: null,
        dropped_by: null,
        created_at: now().toISOString(),
        updated_at: now().toISOString(),
      }),
    },
  });

  const authService = app.get(AuthService);
  const refreshStore: Row[] = [];
  const refreshRepo = {
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
  } as unknown;
  patchService(authService, {
    users: usersRepo,
    refreshTokens: refreshRepo,
    schools: schoolsRepo,
  });

  // The trips location controller uses the real LiveTrackingService; give it
  // the same in-memory repos so parent observation authorization works.
  const liveTrackingService = app.get(LiveTrackingService);
  patchService(liveTrackingService, {
    trips: tripsRepo,
    students: studentsRepo,
    stops: stopsRepo,
    guardians: guardiansRepo,
    assignments: tableRepo([]),
    locations: {
      findAll: async () => [],
      findOne: async () => null,
      create: async () => ({}),
    },
  });

  const accessService = app.get(SchoolAccessService);
  patchService(accessService, {
    schools: {
      findOne: async ({ where }: { where: { id: string } }) =>
        schoolActive.has(where.id)
          ? ({ id: where.id, is_active: schoolActive.get(where.id) } as unknown as School)
          : null,
    },
  });

  const server = app.getHttpServer();
  await app.listen(0);
  const address = server.address();
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

  console.log('\nParent portal smoke test\n');

  // ---- Authentication -------------------------------------------------
  await check('parent login succeeds with valid credentials', async () => {
    const res = await call('POST', '/auth/login', {
      body: { school_id: 'demo-high', email: 'rosa@demo.test', password: 'parent-pass-123' },
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { access_token: string; user: { role: string } } };
    if (!body.data.access_token) throw new Error('missing access token');
    if (body.data.user.role !== 'PARENT') throw new Error('role is not PARENT');
    if (res.setCookie && !/refresh_token/i.test(res.setCookie)) {
      throw new Error('no refresh cookie set');
    }
  });

  await check('parent login rejects an invalid password', async () => {
    const res = await call('POST', '/auth/login', {
      body: { school_id: 'demo-high', email: 'rosa@demo.test', password: 'wrong-password' },
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('parent login rejects an unknown school code', async () => {
    const res = await call('POST', '/auth/login', {
      body: { school_id: 'nope-school', email: 'rosa@demo.test', password: 'parent-pass-123' },
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('parent login with another school is rejected', async () => {
    // The account exists under SCHOOL_A; logging in against a different tenant
    // must fail even with the correct password.
    const res = await call('POST', '/auth/login', {
      body: {
        school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb',
        email: 'rosa@demo.test',
        password: 'parent-pass-123',
      },
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  // ---- Refresh / logout ----------------------------------------------
  const loginCookie = (
    await call('POST', '/auth/login', {
      body: { school_id: 'demo-high', email: 'rosa@demo.test', password: 'parent-pass-123' },
    })
  ).setCookie;

  await check('refresh keeps the parent authenticated (browser refresh)', async () => {
    const res = await call('POST', '/auth/refresh', { cookie: loginCookie });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { access_token: string; user: { role: string } } };
    if (!body.data.access_token || body.data.user.role !== 'PARENT') {
      throw new Error('refresh did not return a parent session');
    }
  });

  await check('logout invalidates the refresh session', async () => {
    const res = await call('POST', '/auth/logout', { cookie: loginCookie });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    if (revokedSessions < 1) throw new Error('refresh token was not revoked');
  });

  // ---- Authorization-gated parent portal -----------------------------
  const parentToken = await signToken(UserRole.PARENT, SCHOOL_A, PARENT_A);

  await check('unauthenticated /parent/dashboard is 401', async () => {
    const res = await call('GET', '/parent/dashboard');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('school admin cannot access the parent portal (403)', async () => {
    const adminToken = await signToken(UserRole.SCHOOL_ADMIN, SCHOOL_A, 'admin-1');
    const res = await call('GET', '/parent/dashboard', { token: adminToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('dashboard shows the parent and only their own child', async () => {
    const res = await call('GET', '/parent/dashboard', { token: parentToken });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as {
      data: {
        parent: { role: string; first_name: string };
        count: number;
        children: Array<{ id: string; today: { trip: { status: string } | null } }>;
      };
    };
    if (body.data.parent.role !== 'PARENT') throw new Error('wrong role');
    if (body.data.count !== 1) throw new Error(`expected 1 child, got ${body.data.count}`);
    if (body.data.children[0]?.id !== STUDENT_A) throw new Error('wrong child returned');
    if (body.data.children[0].today.trip?.status !== 'IN_PROGRESS') {
      throw new Error('today trip not surfaced');
    }
  });

  await check('child list returns only the authenticated parent’s children', async () => {
    const res = await call('GET', '/parent/children', { token: parentToken });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { items: Array<{ id: string }>; count: number } };
    if (body.data.count !== 1 || body.data.items[0]?.id !== STUDENT_A) {
      throw new Error('list exposed another parent’s child');
    }
  });

  await check('parent cannot access another parent’s child (404)', async () => {
    const res = await call('GET', `/parent/children/${STUDENT_B}`, { token: parentToken });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('child detail returns the child with crew of today’s trip', async () => {
    const res = await call('GET', `/parent/children/${STUDENT_A}`, { token: parentToken });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { driver: { first_name: string }; today: unknown } };
    if (!body.data.driver) throw new Error('driver missing');
    if (body.data.driver.first_name !== 'Dana') throw new Error('wrong driver');
  });

  await check('today endpoint returns trip + read-only attendance', async () => {
    const res = await call('GET', `/parent/children/${STUDENT_A}/today`, {
      token: parentToken,
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as {
      data: { child: { today: { trip: { id: string }; attendance: { status: string } } } };
    };
    if (body.data.child.today.trip.id !== TRIP_A) throw new Error('wrong trip');
    if (body.data.child.today.attendance.status !== 'BOARDED') {
      throw new Error('attendance not read-only surfaced');
    }
  });

  await check('parent cannot modify attendance (board is 403)', async () => {
    const res = await call('POST', `/trips/${TRIP_A}/students/${STUDENT_A}/board`, {
      token: parentToken,
    });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('parent cannot modify a trip status (403)', async () => {
    const res = await call('PATCH', `/trips/${TRIP_A}/status`, {
      token: parentToken,
      body: { status: 'COMPLETED' },
    });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('tracking returns active trip + live location + route stops', async () => {
    const res = await call('GET', `/parent/children/${STUDENT_A}/tracking`, {
      token: parentToken,
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as {
      data: { trip: { id: string } | null; latest: { latitude: number } | null; stops: unknown[] };
    };
    if (body.data.trip?.id !== TRIP_A) throw new Error('no active trip');
    if (body.data.latest?.latitude !== 40.712) throw new Error('no live location');
    if (body.data.stops.length === 0) throw new Error('no route stops');
  });

  await check('parent cannot subscribe to another school’s trip location', async () => {
    // A trip id that is not on the parent’s observable route must not leak.
    const res = await call('GET', `/trips/${'99999999-9999-4999-8999-999999999999'}/location`, {
      token: parentToken,
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nParent smoke: ${results.length - failed}/${results.length} checks passed\n`);
  await app.close();
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error('Parent smoke test crashed', error);
  process.exitCode = 1;
});
