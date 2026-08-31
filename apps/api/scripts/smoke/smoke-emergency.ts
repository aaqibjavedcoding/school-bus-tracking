/**
 * HTTP smoke test for Task 44 — crew SOS / emergency events.
 *
 * Boots the real Nest application (guards, validation pipe, exception filter,
 * transform interceptor and every controller — including the real
 * `EmergenciesService`) and drives it over real HTTP through the app's
 * embedded server, with the Sequelize repositories replaced by in-memory
 * stubs (the same approach as `smoke-admin.ts`).
 *
 * The Socket.IO gateway is not started here; the service's broadcast hook is
 * captured instead, so the script proves *what* would be pushed to the
 * tenant's room (room name + event + persisted payload) without needing a
 * live socket server. Socket delivery itself is covered by
 * `emergencies.gateway.spec.ts`.
 *
 * No paid third party is involved anywhere in the flow: delivery is
 * first-party (database + Socket.IO).
 *
 * Run: DB_AUTO_CONNECT=false DB_ALLOW_NO_CONNECT=true \
 *   node -r ts-node/register/transpile-only scripts/smoke/smoke-emergency.ts
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as cookieParser from 'cookie-parser';
import {
  EMERGENCY_EVENTS,
  EmergencyStatus,
  EmergencyType,
  JwtAccessTokenPayload,
  TripStatus,
  UserRole,
  emergencyRoomName,
} from '@school-bus-tracking/shared-types';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { SchoolAccessService } from '../../src/common/access/school-access.service';
import { EmergenciesService } from '../../src/modules/emergencies/emergencies.service';

interface Row {
  [key: string]: unknown;
}

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_A = '01010101-0101-4101-8101-010101010101';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const CONDUCTOR_A = '07070707-0707-4707-8707-070707070702';
const PARENT_A = '01010101-0101-4101-8101-010101010102';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const ROUTE_A = '05050505-0505-4505-8505-050505050501';
const TRIP_A = '09090909-0909-4909-8909-090909090901';
const TRIP_B = '09090909-0909-4909-8909-090909090902';

/** Midday today — comfortably inside the "today" window used by the service. */
function todayNoon(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

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

  // ---- In-memory data -------------------------------------------------
  const events: Row[] = [];
  const trips: Row[] = [
    {
      id: TRIP_A,
      school_id: SCHOOL_A,
      route_id: ROUTE_A,
      bus_id: BUS_A,
      driver_id: DRIVER_A,
      conductor_id: CONDUCTOR_A,
      status: TripStatus.IN_PROGRESS,
      scheduled_start_at: todayNoon(),
    },
    {
      id: TRIP_B,
      school_id: SCHOOL_B,
      route_id: 'route-b',
      bus_id: 'bus-b',
      driver_id: 'driver-b',
      conductor_id: null,
      status: TripStatus.IN_PROGRESS,
      scheduled_start_at: todayNoon(),
    },
  ];
  const buses: Row[] = [{ id: BUS_A, school_id: SCHOOL_A, registration_number: 'BUS-A-1' }];
  const routes: Row[] = [{ id: ROUTE_A, school_id: SCHOOL_A, name: 'North Loop' }];
  const users: Row[] = [
    {
      id: DRIVER_A,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
      first_name: 'Asha',
      last_name: 'Rane',
    },
    {
      id: CONDUCTOR_A,
      school_id: SCHOOL_A,
      role: UserRole.CONDUCTOR,
      first_name: 'Cory',
      last_name: 'Duta',
    },
    {
      id: ADMIN_A,
      school_id: SCHOOL_A,
      role: UserRole.SCHOOL_ADMIN,
      first_name: 'Nina',
      last_name: 'Principal',
    },
  ];

  /**
   * Sequelize operator keys are ES symbols (`Op.or`, `Op.in`, `Op.gte`, …).
   * They appear at the top level of a `where` *and* inside a nested operator
   * object, and `Object.entries` drops them silently — so they are folded in
   * at both levels. Ignoring them would make a stub return rows the real
   * query would never return.
   */
  function entriesOf(value: Row): Array<[string, unknown]> {
    const named = Object.entries(value) as Array<[string, unknown]>;
    const symbolic = Object.getOwnPropertySymbols(value).map(
      (symbol) =>
        [
          String(symbol).replace(/^Symbol\(|\)/g, ''),
          (value as Record<symbol, unknown>)[symbol],
        ] as [string, unknown],
    );
    return [...named, ...symbolic];
  }

  function matchesWhere(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return entriesOf(where).every(([key, expected]) => {
      if (key === 'or') {
        return (expected as Row[]).some((alternative) => matchesWhere(row, alternative));
      }
      const cell = row[key];
      if (expected && typeof expected === 'object') {
        return entriesOf(expected as Row).every(([op, operand]) => {
          if (op === 'in') return (operand as unknown[]).includes(cell);
          if (op === 'ne') return cell !== operand;
          if (op === 'gte') return (cell as Date) >= (operand as Date);
          if (op === 'lt') return (cell as Date) < (operand as Date);
          return cell === operand;
        });
      }
      return cell === expected;
    });
  }

  function tableRepo(list: Row[]) {
    const repo = {
      create: async (payload: Row) => {
        const row: Row = {
          id: randomUUID(),
          created_at: now(),
          updated_at: now(),
          deleted_at: null,
          ...payload,
        };
        row.update = async (patch: Row) => {
          Object.assign(row, patch, { updated_at: now() });
          return row;
        };
        list.push(row);
        return row;
      },
      findOne: async (options: { where: Row }) =>
        (list.find((row) => matchesWhere(row, options.where)) ?? null) as Row | null,
      findAll: async (options: { where?: Row; limit?: number } = {}) => {
        const found = list.filter((row) => matchesWhere(row, options.where));
        return options.limit ? found.slice(0, options.limit) : found;
      },
      findAndCountAll: async (options: { where?: Row; limit?: number; offset?: number }) => {
        const found = list.filter((row) => matchesWhere(row, options.where));
        const offset = options.offset ?? 0;
        return {
          rows: options.limit ? found.slice(offset, offset + options.limit) : found.slice(offset),
          count: found.length,
        };
      },
    };
    return repo;
  }

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

  const broadcasts: Array<{ room: string; event: string; id: string; status: string }> = [];
  const emergencies = app.get(EmergenciesService);
  emergencies.attachBroadcaster((room, event, payload) => {
    broadcasts.push({ room, event, id: payload.id, status: payload.status });
  });
  (emergencies as unknown as Record<string, unknown>).events = tableRepo(events);
  (emergencies as unknown as Record<string, unknown>).trips = tableRepo(trips);
  (emergencies as unknown as Record<string, unknown>).buses = tableRepo(buses);
  (emergencies as unknown as Record<string, unknown>).routes = tableRepo(routes);
  (emergencies as unknown as Record<string, unknown>).users = tableRepo(users);

  (app.get(SchoolAccessService) as unknown as Record<string, unknown>).schools = {
    findOne: async ({ where }: { where: { id: string } }) =>
      ({ id: where.id, is_active: true }) as unknown as Row,
  };

  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const jwt = app.get(JwtService);
  const signToken = async (role: UserRole, schoolId: string, sub: string) => {
    const payload: JwtAccessTokenPayload = { sub, school_id: schoolId, role };
    return jwt.signAsync(payload);
  };

  const call = async (
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; json: Record<string, unknown> | string | undefined }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> | string | undefined;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };

  const data = (result: {
    status: number;
    json: Record<string, unknown> | string | undefined;
  }): Record<string, unknown> => {
    const envelope = result.json as Record<string, unknown> | undefined;
    const payload = envelope?.data as Record<string, unknown> | undefined;
    if (!payload) {
      throw new Error(`unexpected response ${result.status}: ${JSON.stringify(result.json)}`);
    }
    return payload;
  };

  const adminToken = await signToken(UserRole.SCHOOL_ADMIN, SCHOOL_A, ADMIN_A);
  const driverToken = await signToken(UserRole.DRIVER, SCHOOL_A, DRIVER_A);
  const conductorToken = await signToken(UserRole.CONDUCTOR, SCHOOL_A, CONDUCTOR_A);
  const parentToken = await signToken(UserRole.PARENT, SCHOOL_A, PARENT_A);
  const otherAdminToken = await signToken(UserRole.SCHOOL_ADMIN, SCHOOL_B, 'admin-b');

  // ---- Raising an SOS --------------------------------------------------
  let firstEventId = '';

  await check('SOS: a driver raises an emergency against their own trip', async () => {
    const before = Date.now();
    const res = await call('POST', '/emergencies/sos', {
      token: driverToken,
      body: {
        trip_id: TRIP_A,
        type: EmergencyType.ACCIDENT,
        message: 'Bus hit a divider — no injuries',
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 12.5,
      },
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
    const created = data(res);
    firstEventId = created.id as string;
    if (created.trip_id !== TRIP_A) throw new Error('wrong trip');
    if (created.bus_id !== BUS_A) throw new Error('bus not snapshotted');
    if (created.route_id !== ROUTE_A) throw new Error('route not snapshotted');
    if (created.raised_by_user_id !== DRIVER_A) throw new Error('wrong author');
    if (created.raised_by_name !== 'Asha Rane') throw new Error('author name not resolved');
    if (created.status !== EmergencyStatus.OPEN) throw new Error(`status ${created.status}`);
    if (created.bus_registration_number !== 'BUS-A-1') throw new Error('bus label missing');
    if (created.route_name !== 'North Loop') throw new Error('route label missing');

    // The event time is the server clock, never a client value.
    const triggered = new Date(created.triggered_at as string).getTime();
    if (triggered < before - 1000 || triggered > Date.now() + 1000) {
      throw new Error('triggered_at is not the server clock');
    }
  });

  await check('SOS: the event is broadcast to the tenant room', async () => {
    if (broadcasts.length !== 1) throw new Error(`expected 1 broadcast, got ${broadcasts.length}`);
    if (broadcasts[0].room !== emergencyRoomName(SCHOOL_A)) throw new Error('wrong room');
    if (broadcasts[0].event !== EMERGENCY_EVENTS.new) throw new Error('wrong event');
    if (broadcasts[0].id !== firstEventId) throw new Error('wrong payload');
  });

  await check('SOS: a conductor can raise one too, without naming the trip', async () => {
    const res = await call('POST', '/emergencies/sos', {
      token: conductorToken,
      body: { type: EmergencyType.MEDICAL, message: 'Student feeling faint' },
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
    const created = data(res);
    // The crew member's own trip of today is resolved server-side.
    if (created.trip_id !== TRIP_A) throw new Error('current trip not resolved');
    if (created.raised_by_role !== UserRole.CONDUCTOR) throw new Error('wrong role recorded');
    if (created.latitude !== null) throw new Error('a missing fix must stay null, not 0');
  });

  await check('SOS: a client cannot supply a tenant id or an event time', async () => {
    const res = await call('POST', '/emergencies/sos', {
      token: driverToken,
      body: {
        type: EmergencyType.OTHER,
        school_id: SCHOOL_B,
        triggered_at: '2000-01-01T00:00:00.000Z',
      },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('SOS: a half coordinate pair is rejected', async () => {
    const res = await call('POST', '/emergencies/sos', {
      token: driverToken,
      body: { type: EmergencyType.BREAKDOWN, latitude: 28.6 },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('SOS: another tenant’s trip is hidden behind 404', async () => {
    const res = await call('POST', '/emergencies/sos', {
      token: driverToken,
      body: { trip_id: TRIP_B, type: EmergencyType.OTHER },
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('SOS: a parent cannot raise one', async () => {
    const res = await call('POST', '/emergencies/sos', {
      token: parentToken,
      body: { type: EmergencyType.OTHER },
    });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  // ---- Admin handling --------------------------------------------------
  await check('admin: the open events are listed for the school', async () => {
    const active = data(await call('GET', '/emergencies/active', { token: adminToken }));
    const items = active.items as Array<Record<string, unknown>>;
    if (items.length !== 2) throw new Error(`expected 2 open events, got ${items.length}`);
  });

  await check('admin: an event can be acknowledged and then resolved', async () => {
    const acknowledged = data(
      await call('PATCH', `/emergencies/${firstEventId}/status`, {
        token: adminToken,
        body: { status: EmergencyStatus.ACKNOWLEDGED, note: 'School van dispatched' },
      }),
    );
    if (acknowledged.status !== EmergencyStatus.ACKNOWLEDGED) throw new Error('not acknowledged');
    if (!acknowledged.acknowledged_at) throw new Error('acknowledged_at missing');
    if (acknowledged.acknowledged_by_name !== 'Nina Principal') throw new Error('wrong handler');

    const resolved = data(
      await call('PATCH', `/emergencies/${firstEventId}/status`, {
        token: adminToken,
        body: { status: EmergencyStatus.RESOLVED, note: 'All students safe' },
      }),
    );
    if (resolved.status !== EmergencyStatus.RESOLVED) throw new Error('not resolved');
    if (!resolved.resolved_at) throw new Error('resolved_at missing');
    if (resolved.resolution_note !== 'All students safe') throw new Error('note not stored');
  });

  await check('admin: a resolved event cannot be reopened', async () => {
    const res = await call('PATCH', `/emergencies/${firstEventId}/status`, {
      token: adminToken,
      body: { status: EmergencyStatus.OPEN },
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  await check('admin: the history is filterable and paginated', async () => {
    const list = data(
      await call('GET', `/emergencies?status=${EmergencyStatus.RESOLVED}`, { token: adminToken }),
    );
    if ((list.meta as Record<string, number>).total !== 1) throw new Error('wrong total');

    const all = data(await call('GET', '/emergencies?limit=1', { token: adminToken }));
    if ((all.items as unknown[]).length !== 1) throw new Error('limit not applied');
    if ((all.meta as Record<string, number>).total !== 2) throw new Error('wrong total');
  });

  await check('admin: another tenant’s event is hidden behind 404', async () => {
    const res = await call('GET', `/emergencies/${firstEventId}`, { token: otherAdminToken });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('admin: a parent cannot read the emergency console', async () => {
    const res = await call('GET', '/emergencies', { token: parentToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  // ---- Crew self-service ----------------------------------------------
  await check('crew: a crew member sees only their own history', async () => {
    const mine = data(await call('GET', '/emergencies/mine', { token: driverToken }));
    const items = mine.items as Array<Record<string, string>>;
    if (items.length !== 1) throw new Error(`expected 1 own event, got ${items.length}`);
    if (items[0].raised_by_user_id !== DRIVER_A) throw new Error('wrong author');
  });

  await check('crew: a crew member can retract their own alarm', async () => {
    const mine = data(await call('GET', '/emergencies/mine', { token: conductorToken }));
    const own = (mine.items as Array<Record<string, string>>)[0];
    const res = await call('PATCH', `/emergencies/${own.id}/cancel`, {
      token: conductorToken,
      body: { note: 'Pressed by mistake' },
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    if (data(res).status !== EmergencyStatus.CANCELLED) throw new Error('not cancelled');
  });

  await check('crew: a crew member cannot cancel somebody else’s alarm', async () => {
    const mine = data(await call('GET', '/emergencies/mine', { token: driverToken }));
    const own = (mine.items as Array<Record<string, string>>)[0];
    const res = await call('PATCH', `/emergencies/${own.id}/cancel`, { token: conductorToken });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('crew: a crew member cannot resolve on behalf of the school', async () => {
    const mine = data(await call('GET', '/emergencies/mine', { token: driverToken }));
    const own = (mine.items as Array<Record<string, string>>)[0];
    const res = await call('PATCH', `/emergencies/${own.id}/cancel`, {
      token: driverToken,
      body: { status: EmergencyStatus.RESOLVED },
    });
    // The cancel route only ever applies CANCELLED; a forged status is
    // rejected by the DTO before it can reach the service.
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('broadcasts: every transition reached the tenant room', async () => {
    const updates = broadcasts.filter((entry) => entry.event === EMERGENCY_EVENTS.updated);
    // acknowledge + resolve (school) and cancel (crew) — all three pushed to
    // the school's own room, and nothing left the tenant.
    if (updates.length !== 3) throw new Error(`expected 3 updates, got ${updates.length}`);
    for (const status of [
      EmergencyStatus.ACKNOWLEDGED,
      EmergencyStatus.RESOLVED,
      EmergencyStatus.CANCELLED,
    ]) {
      if (!updates.some((entry) => entry.status === status)) {
        throw new Error(`${status} was not broadcast`);
      }
    }
    if (broadcasts.some((entry) => entry.room !== emergencyRoomName(SCHOOL_A))) {
      throw new Error('a broadcast leaked to another tenant room');
    }
  });

  await app.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
