/**
 * HTTP smoke test for Task 22 — dynamic ETA, geofence arrivals and stop
 * arrival detection.
 *
 * Boots the real Nest application (guards, validation pipe, exception filter,
 * transform interceptor and every controller — including the real
 * `LiveTrackingService`, `EtaService`, `StopArrivalsService` and
 * `NotificationsService`) against in-memory model stubs registered with the
 * Nest DI container — the same stubbing approach as `smoke-notifications.ts`,
 * but driven over real HTTP through the app's embedded server.
 *
 * Socket delivery itself is covered by the unit suites; this script proves
 * the REST flows end to end: ETA authorization (crew / parent / cross-tenant
 * / platform), no fabricated ETA without GPS, arrival creation through the
 * real geofence pipeline, duplicate protection, parent notification and the
 * completed-trip stop behaviour.
 *
 * A real PostgreSQL instance is not available in this sandbox, so the service
 * logic is covered against the actual Sequelize-shaped stubs and the DB
 * migrations are reviewed for real deploys.
 *
 * Run: DB_AUTO_CONNECT=false DB_ALLOW_NO_CONNECT=true \
 *   node -r ts-node/register/transpile-only scripts/smoke/smoke-eta-arrivals.ts
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
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { SchoolAccessService } from '../../src/common/access/school-access.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { EtaService } from '../../src/modules/eta/eta.service';
import { StopArrivalsService } from '../../src/modules/eta/stop-arrivals.service';
import { LiveTrackingService } from '../../src/modules/live-tracking/live-tracking.service';

interface Row {
  [key: string]: unknown;
}

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const DRIVER_B = '07070707-0707-4707-8707-070707070702';
const PARENT_A = '01010101-0101-4101-8101-010101010101';
const PARENT_A2 = '01010101-0101-4101-8101-010101010102';
const PARENT_OTHER_ROUTE = '01010101-0101-4101-8101-010101010103';
const PARENT_B = '01010101-0101-4101-8101-010101010104';
const STUDENT_A = '03030303-0303-4303-8303-030303030301';
const STUDENT_B_ROUTE = '03030303-0303-4303-8303-030303030302';
const STUDENT_B = '03030303-0303-4303-8303-030303030303';
const STOP_1 = '04040404-0404-4404-8404-040404040401';
const STOP_2 = '04040404-0404-4404-8404-040404040402';
const STOP_OTHER_ROUTE = '04040404-0404-4404-8404-040404040403';
const STOP_B = '04040404-0404-4404-8404-040404040404';
const ROUTE_A = '05050505-0505-4505-8505-050505050501';
const ROUTE_B = '05050505-0505-4505-8505-050505050502';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const TRIP_A = '09090909-0909-4909-8909-090909090901';
const TRIP_SCHOOL_B = '09090909-0909-4909-8909-090909090902';

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
  const todayStart = new Date(`${now().toISOString().slice(0, 10)}T00:00:00.000Z`);

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
  const arrivals: Row[] = [];
  const locations: Row[] = [];
  const schoolActive = new Map<string, boolean>();

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
    return { ...repo, unscoped: () => repo };
  }

  schools.push(
    { id: SCHOOL_A, name: 'Demo High', code: 'demo-high', is_active: true },
    { id: SCHOOL_B, name: 'Other High', code: 'other-high', is_active: true },
  );
  schoolActive.set(SCHOOL_A, true);
  schoolActive.set(SCHOOL_B, true);

  users.push(
    { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER, is_active: true },
    { id: DRIVER_B, school_id: SCHOOL_B, role: UserRole.DRIVER, is_active: true },
    { id: PARENT_A, school_id: SCHOOL_A, role: UserRole.PARENT, is_active: true },
    { id: PARENT_A2, school_id: SCHOOL_A, role: UserRole.PARENT, is_active: true },
    { id: PARENT_OTHER_ROUTE, school_id: SCHOOL_A, role: UserRole.PARENT, is_active: true },
    { id: PARENT_B, school_id: SCHOOL_B, role: UserRole.PARENT, is_active: true },
  );

  routes.push(
    { id: ROUTE_A, school_id: SCHOOL_A, name: 'North Loop', code: 'NL', is_active: true },
    { id: ROUTE_B, school_id: SCHOOL_A, name: 'South Loop', code: 'SL', is_active: true },
  );

  stops.push(
    {
      id: STOP_1,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      name: 'Green Park Stop',
      sequence_number: 1,
      latitude: 40.7,
      longitude: -74.0,
      geofence_radius_meters: 100,
      is_active: true,
    },
    {
      id: STOP_2,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      name: 'Oak Ave',
      sequence_number: 2,
      latitude: 40.7,
      longitude: -73.99,
      geofence_radius_meters: 100,
      is_active: true,
    },
    {
      id: STOP_OTHER_ROUTE,
      school_id: SCHOOL_A,
      route_id: ROUTE_B,
      name: 'Birch Rd',
      sequence_number: 1,
      latitude: 40.75,
      longitude: -74.1,
      geofence_radius_meters: 100,
      is_active: true,
    },
    {
      id: STOP_B,
      school_id: SCHOOL_B,
      route_id: ROUTE_B,
      name: 'Cedar Ln',
      sequence_number: 1,
      latitude: 40.75,
      longitude: -74.1,
      geofence_radius_meters: 100,
      is_active: true,
    },
  );

  students.push(
    { id: STUDENT_A, school_id: SCHOOL_A, home_stop_id: STOP_1, is_active: true },
    { id: STUDENT_B_ROUTE, school_id: SCHOOL_A, home_stop_id: STOP_OTHER_ROUTE, is_active: true },
    { id: STUDENT_B, school_id: SCHOOL_B, home_stop_id: STOP_B, is_active: true },
  );

  guardians.push(
    { school_id: SCHOOL_A, student_id: STUDENT_A, user_id: PARENT_A, is_active: true },
    { school_id: SCHOOL_A, student_id: STUDENT_A, user_id: PARENT_A2, is_active: true },
    {
      school_id: SCHOOL_A,
      student_id: STUDENT_B_ROUTE,
      user_id: PARENT_OTHER_ROUTE,
      is_active: true,
    },
    { school_id: SCHOOL_B, student_id: STUDENT_B, user_id: PARENT_B, is_active: true },
  );

  buses.push({ id: BUS_A, school_id: SCHOOL_A, registration_number: 'ABC-123' });

  trips.push(
    {
      id: TRIP_A,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      bus_id: BUS_A,
      driver_id: DRIVER_A,
      conductor_id: null,
      status: TripStatus.IN_PROGRESS,
      scheduled_start_at: new Date(todayStart.getTime() + 6.5 * 3600_000),
      scheduled_end_at: new Date(todayStart.getTime() + 7.5 * 3600_000),
    },
    {
      id: TRIP_SCHOOL_B,
      school_id: SCHOOL_B,
      route_id: ROUTE_B,
      bus_id: null,
      driver_id: DRIVER_B,
      conductor_id: null,
      status: TripStatus.IN_PROGRESS,
      scheduled_start_at: new Date(todayStart.getTime() + 6.5 * 3600_000),
      scheduled_end_at: new Date(todayStart.getTime() + 7.5 * 3600_000),
    },
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

  const patchService = (service: unknown, stubs: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(stubs)) {
      (service as Record<string, unknown>)[key] = value;
    }
  };

  const arrivalsRepo = {
    findAll: async (options: { where?: Row } = {}) =>
      arrivals.filter((row) => matchesWhere(row, options.where)) as Row[],
    findOne: async (options: { where?: Row } = {}) =>
      (arrivals.find((row) => matchesWhere(row, options.where)) ?? null) as Row | null,
    create: async (payload: Row) => {
      const row: Row = {
        id: randomUUID(),
        ...payload,
        created_at: now(),
        updated_at: now(),
      };
      arrivals.push(row);
      return row;
    },
  };

  const locationsRepo = {
    findAll: async (options: { where?: Row } = {}) =>
      locations.filter((row) => matchesWhere(row, options.where)) as Row[],
    findOne: async (options: { where?: Row; order?: Array<[string, string]> } = {}) => {
      const matched = locations.filter((row) => matchesWhere(row, options.where));
      if (!options.order) return matched[0] ?? null;
      const [field, direction] = options.order[0];
      const sorted = [...matched].sort((a, b) => {
        const av = new Date(a[field] as string).getTime();
        const bv = new Date(b[field] as string).getTime();
        return direction === 'DESC' ? bv - av : av - bv;
      });
      return (sorted[0] ?? null) as Row | null;
    },
    create: async (payload: Row) => {
      const row: Row = { id: randomUUID(), ...payload };
      locations.push(row);
      return row;
    },
  };

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
      return { rows: sorted.slice(offset, offset + limit) as Row[], count: filtered.length };
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
        stop_id: null,
        ...payload,
        created_at: now(),
        updated_at: now(),
      };
      notifications.push(row);
      return row;
    },
    update: async () => [0],
  };

  // Task 21 service over in-memory tables (the same instance the arrival
  // pipeline notifies).
  patchService(app.get(NotificationsService), {
    notifications: notificationsRepo,
    users: tableRepo(users),
    guardians: tableRepo(guardians),
    students: tableRepo(students),
    stops: tableRepo(stops),
    trips: tableRepo(trips),
  });

  // Task 22 services share the same in-memory tables.
  patchService(app.get(EtaService), {
    stops: tableRepo(stops),
    arrivals: arrivalsRepo,
  });
  patchService(app.get(StopArrivalsService), {
    stops: tableRepo(stops),
    arrivals: arrivalsRepo,
  });

  // Live-tracking reads used by the ETA controller and the arrival pipeline.
  patchService(app.get(LiveTrackingService), {
    trips: tableRepo(trips),
    assignments: tableRepo([]),
    students: tableRepo(students),
    stops: tableRepo(stops),
    guardians: tableRepo(guardians),
    locations: locationsRepo,
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
    options: { token?: string; body?: unknown } = {},
  ) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
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
    return { status: res.status, json };
  };

  const driverToken = await signToken(UserRole.DRIVER, SCHOOL_A, DRIVER_A);
  const otherSchoolDriverToken = await signToken(UserRole.DRIVER, SCHOOL_B, DRIVER_B);
  const parentToken = await signToken(UserRole.PARENT, SCHOOL_A, PARENT_A);
  const parentOtherRouteToken = await signToken(UserRole.PARENT, SCHOOL_A, PARENT_OTHER_ROUTE);
  const parentSchoolBToken = await signToken(UserRole.PARENT, SCHOOL_B, PARENT_B);
  const superAdminToken = await signToken(
    UserRole.SUPER_ADMIN,
    null,
    '99999999-9999-4999-8999-999999999999',
  );

  // ---------------------------------------------------------------------
  await check('ETA: crew sees the trip with no fabricated ETA while no GPS exists', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`, { token: driverToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = (res.json as { data: Row }).data;
    if (data.trip_id !== TRIP_A) throw new Error('wrong trip');
    if (data.eta_available !== false) throw new Error('ETA must be unavailable without GPS');
    if (data.latest !== null) throw new Error('latest must be null without GPS');
    if ((data.items as Row[]).length !== 2) throw new Error('both route stops must be listed');
    for (const item of data.items as Row[]) {
      if (item.distance_meters !== null || item.eta_minutes !== null) {
        throw new Error('no distance/ETA may be invented without GPS');
      }
    }
  });

  await check('ETA: parent of a child on the trip can read it', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`, { token: parentToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
  });

  await check('ETA: parent without a child on the trip gets the generic 404', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`, { token: parentOtherRouteToken });
    if (res.status !== 404) throw new Error(`status ${res.status}`);
  });

  await check('ETA: cross-school crew gets the generic 404', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`, { token: otherSchoolDriverToken });
    if (res.status !== 404) throw new Error(`status ${res.status}`);
  });

  await check('ETA: platform SUPER_ADMIN is refused by the role guard', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`, { token: superAdminToken });
    if (res.status !== 403) throw new Error(`status ${res.status}`);
  });

  await check('ETA: unauthenticated request is refused', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`);
    if (res.status !== 401) throw new Error(`status ${res.status}`);
  });

  // ---- Geofence arrival through the real pipeline ---------------------
  const arrivalsService = app.get(StopArrivalsService);
  const tripA = trips.find((trip) => trip.id === TRIP_A) as Row;
  const insideFix = {
    id: 'loc-inside-1',
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    latitude: 40.7003,
    longitude: -73.9997,
    accuracy: 10,
    speed: 25,
    heading: 90,
    recorded_at: now(),
    received_at: now(),
  };

  await check('arrival: a fix inside the geofence records exactly one arrival', async () => {
    // The fix is persisted like `recordLocation` would (locations table), so
    // the REST ETA reads see it as the latest GPS fix.
    locations.push({ ...insideFix, created_at: now(), updated_at: now() });
    await arrivalsService.onAcceptedFix(tripA as never, insideFix as never);
    if (arrivals.length !== 1) throw new Error(`expected 1 arrival, got ${arrivals.length}`);
    const arrival = arrivals[0];
    if (
      arrival.trip_id !== TRIP_A ||
      arrival.stop_id !== STOP_1 ||
      arrival.school_id !== SCHOOL_A
    ) {
      throw new Error('arrival row must be pinned to the trip/stop/tenant');
    }
    if (typeof arrival.distance_meters !== 'number' || arrival.distance_meters > 100) {
      throw new Error('arrival distance must be inside the geofence radius');
    }
  });

  await check('arrival: repeated fixes inside the same geofence do not duplicate', async () => {
    await arrivalsService.onAcceptedFix(tripA as never, insideFix as never);
    await arrivalsService.onAcceptedFix(tripA as never, insideFix as never);
    if (arrivals.length !== 1) throw new Error(`expected 1 arrival, got ${arrivals.length}`);
  });

  await check('arrival: parents of the reached stop are notified exactly once', async () => {
    const stopArrivals = notifications.filter((row) => row.type === NotificationType.STOP_ARRIVED);
    if (stopArrivals.length !== 2)
      throw new Error(`expected 2 notifications, got ${stopArrivals.length}`);
    for (const row of stopArrivals) {
      if (row.message !== 'Bus arrived at Green Park Stop.') throw new Error('wrong message');
      if (row.stop_id !== STOP_1 || row.trip_id !== TRIP_A) throw new Error('wrong scope');
    }
    const userIds = stopArrivals.map((row) => row.user_id).sort();
    if (userIds.join(',') !== [PARENT_A, PARENT_A2].sort().join(',')) {
      throw new Error('wrong recipients');
    }
  });

  await check('ETA: after the arrival the next stop carries a real distance and ETA', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/eta`, { token: driverToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = (res.json as { data: Row }).data;
    if (data.eta_available !== true) throw new Error('ETA must be available with GPS');
    if ((data.current_stop as Row | null)?.stop_id !== STOP_1)
      throw new Error('wrong current stop');
    if ((data.next_stop as Row | null)?.stop_id !== STOP_2) throw new Error('wrong next stop');
    const distance = (data.next_stop as Row).distance_meters as number;
    if (distance < 700 || distance > 900) throw new Error(`unexpected distance ${distance}`);
    if ((data.next_stop as Row).eta_minutes !== 2) throw new Error('unexpected ETA minutes');
  });

  await check('arrivals: the recorded arrivals are readable by authorized crew', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/arrivals`, { token: driverToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = (res.json as { data: { items: Row[] } }).data;
    if (data.items.length !== 1) throw new Error('expected one arrival');
    if (data.items[0].stop_name !== 'Green Park Stop') throw new Error('stop name must resolve');
  });

  await check('progress: current/next stop and arrivals are exposed for the crew', async () => {
    const res = await call('GET', `/trips/${TRIP_A}/progress`, { token: driverToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = (res.json as { data: Row }).data;
    if ((data.current_stop as Row | null)?.stop_id !== STOP_1)
      throw new Error('wrong current stop');
    if ((data.next_stop as Row | null)?.stop_id !== STOP_2) throw new Error('wrong next stop');
    if ((data.arrivals as Row[]).length !== 1) throw new Error('wrong arrivals');
  });

  await check('notification: the notified parent reads the arrival over REST', async () => {
    const res = await call('GET', '/parent/notifications', { token: parentToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = (res.json as { data: { items: Row[] } }).data;
    const arrival = data.items.find((item) => item.type === NotificationType.STOP_ARRIVED);
    if (!arrival) throw new Error('arrival notification missing');
    if (arrival.message !== 'Bus arrived at Green Park Stop.') throw new Error('wrong message');
  });

  await check('notification: a parent of another school sees nothing', async () => {
    const res = await call('GET', '/parent/notifications', { token: parentSchoolBToken });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = (res.json as { data: { items: Row[] } }).data;
    if (data.items.some((item) => item.type === NotificationType.STOP_ARRIVED)) {
      throw new Error('cross-school leak');
    }
  });

  await check('arrival: a completed trip no longer generates arrivals', async () => {
    tripA.status = TripStatus.COMPLETED;
    const atStop2 = { ...insideFix, latitude: 40.7001, longitude: -73.9898 };
    await arrivalsService.onAcceptedFix(tripA as never, atStop2 as never);
    if (arrivals.length !== 1) throw new Error('completed trip must not create arrivals');
  });

  await check('tracking: a GPS update for a completed trip is rejected', async () => {
    const liveTracking = app.get(LiveTrackingService);
    const { ack } = await liveTracking.recordLocation(
      { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER },
      {
        trip_id: TRIP_A,
        latitude: 40.7001,
        longitude: -73.9898,
        accuracy: 10,
        speed: 20,
        heading: 90,
        recorded_at: now().toISOString(),
      },
    );
    if (ack.status !== 'rejected' || ack.reason !== 'trip_not_open') {
      throw new Error(`expected rejection, got ${ack.status}/${ack.reason}`);
    }
    if (arrivals.length !== 1) throw new Error('rejected fix must not create arrivals');
  });

  await app.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
