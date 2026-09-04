/**
 * HTTP smoke test for the Super Admin platform flow.
 *
 * Boots the real Nest application (guards, validation pipe, exception
 * filter, transform interceptor and every admin controller) against
 * in-memory model stubs registered with the Nest DI container — the same
 * stubbing approach as the unit suites, but driven over real HTTP via the
 * app's embedded server. A real PostgreSQL instance is not available in
 * this sandbox; the service logic itself is covered against the actual
 * Sequelize-shaped stubs, and the DB migration is reviewed for real deploys.
 *
 * Run: DB_AUTO_CONNECT=false node -r ts-node/register/transpile-only scripts/smoke/smoke-admin.ts
 */
import 'reflect-metadata';
import { Op } from 'sequelize';
import { JwtService } from '../../src/server/framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import * as bcrypt from 'bcryptjs';
import { createSmokeApp } from './support/smoke-app';
import { School, User } from '../../src/server/database/models';
import { AdminSchoolsService } from '../../src/server/modules/admin/admin-schools.service';
import { AdminDashboardService } from '../../src/server/modules/admin/admin-dashboard.service';
import { AdminSchoolAdminsService } from '../../src/server/modules/admin/admin-school-admins.service';
import { AdminSubscriptionsService } from '../../src/server/modules/admin/admin-subscriptions.service';
import { AdminGlobalSubscriptionsService } from '../../src/server/modules/admin/admin-global-subscriptions.service';
import { SchoolsService } from '../../src/server/modules/schools/schools.service';
import { AuthService } from '../../src/server/modules/auth/auth.service';
import { SchoolAccessService } from '../../src/server/common/access/school-access.service';

interface Row {
  [key: string]: unknown;
}

let counter = 0;
function uuid(): string {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
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

  // ---- In-memory data -------------------------------------------------
  const schools: Row[] = [];
  const users: Row[] = [];
  // Task 42 — plan catalog + school subscriptions (in-memory).
  const plans: Row[] = [];
  const subscriptions: Row[] = [];
  const schoolActive = new Map<string, boolean>();
  let revokedSessions = 0;

  const now = () => new Date();

  function schoolStub() {
    return {
      sequelize: {
        fn: (n: string, c: unknown) => ({ fn: n, col: c }),
        col: (n: string) => n,
        transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({}),
      },
      create: async (data: Row) => {
        const row: Row = {
          id: uuid(),
          is_active: true,
          subdomain: null,
          email: null,
          phone: null,
          address_line1: null,
          address_line2: null,
          city: null,
          state: null,
          postal_code: null,
          country: null,
          timezone: 'UTC',
          created_at: now(),
          updated_at: now(),
          ...data,
        };
        row.update = async (patch: Row) => {
          Object.assign(row, patch, { updated_at: now() });
          if (patch.is_active !== undefined) {
            schoolActive.set(row.id as string, patch.is_active as boolean);
          }
        };
        row.reload = async () => row;
        row.sequelize = {
          transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({}),
        };
        schools.push(row);
        schoolActive.set(row.id as string, row.is_active as boolean);
        return row as unknown as School;
      },
      findOne: async (options: { where: Row }): Promise<School | null> => {
        const where = options.where;
        const row = schools.find((s) => Object.entries(where).every(([k, v]) => s[k] === v));
        return (row ?? null) as unknown as School | null;
      },
      findAndCountAll: async (options: {
        where: Row;
        limit: number;
        offset: number;
        order?: unknown;
      }) => {
        let rows = schools;
        if (options.where.is_active !== undefined) {
          rows = rows.filter((s) => s.is_active === options.where.is_active);
        }
        return {
          rows: rows.slice(options.offset, options.offset + options.limit),
          count: rows.length,
        };
      },
      findAll: async (options: {
        attributes?: Array<string | [unknown, string]>;
        where?: Row;
        group?: string[];
      }): Promise<Row[]> => {
        // Grouped COUNT aggregation for schools (grouped by is_active).
        if (options.group?.includes('is_active')) {
          const active = schools.filter((s) => s.is_active).length;
          const inactive = schools.filter((s) => !s.is_active).length;
          const out: Row[] = [];
          if (active) out.push({ is_active: true, count: String(active) });
          if (inactive) out.push({ is_active: false, count: String(inactive) });
          return out;
        }
        return schools as Row[];
      },
    } as unknown;
  }

  function userStub() {
    return {
      sequelize: {
        fn: (n: string, c: unknown) => ({ fn: n, col: c }),
        col: (n: string) => n,
      },
      unscoped() {
        return this;
      },
      create: async (data: Row) => {
        const row: Row = {
          id: uuid(),
          phone: null,
          email_verified_at: null,
          is_active: true,
          created_at: now(),
          updated_at: now(),
          ...data,
        };
        row.update = async (patch: Row) => {
          Object.assign(row, patch, { updated_at: now() });
        };
        users.push(row);
        return row as unknown as User;
      },
      findOne: async (options: { where: Row }): Promise<User | null> => {
        const where = options.where;
        const row = users.find((u) =>
          Object.entries(where).every(([k, v]) =>
            k === 'school_id' ? u.school_id === v : u[k] === v,
          ),
        );
        return (row ?? null) as unknown as User | null;
      },
      findAndCountAll: async () => ({
        rows: users.filter((u) => u.role === UserRole.SCHOOL_ADMIN),
        count: users.filter((u) => u.role === UserRole.SCHOOL_ADMIN).length,
      }),
      findAll: async (options: {
        attributes?: Array<string | [unknown, string]>;
        where?: Row;
        group?: string[];
        order?: unknown;
      }): Promise<Row[]> => {
        const grouped = Boolean(options.group);
        const hasCount = options.attributes?.some((a) => Array.isArray(a) && a[1] === 'count');
        let rows = users;
        if (options.where?.school_id && typeof options.where.school_id === 'object') {
          const whereValue = options.where.school_id as unknown;
          const allowed =
            (whereValue as Record<symbol, string[]>)[Op.in] ??
            (Object.values(whereValue as Record<string, unknown>)[0] as string[]) ??
            [];
          rows = rows.filter((u) => allowed.includes(u.school_id as string));
        } else if (options.where?.school_id) {
          rows = rows.filter((u) => u.school_id === options.where?.school_id);
        }
        if (options.where?.role) {
          const roleWhere = options.where.role as unknown;
          const allowedRoles = Array.isArray(roleWhere)
            ? (roleWhere as string[])
            : typeof roleWhere === 'object' && roleWhere
              ? ((roleWhere as Record<symbol, string[]>)[Op.in] ??
                (Object.values(roleWhere as Record<string, unknown>).flat() as string[]))
              : [roleWhere as string];
          rows = rows.filter((u) => allowedRoles.includes(u.role as string));
        }
        if (grouped && hasCount) {
          const buckets = new Map<string, Row>();
          for (const u of rows) {
            const key = [u.school_id, u.role, String(u.is_active)].join('|');
            const b = buckets.get(key) ?? {
              school_id: u.school_id,
              role: u.role,
              is_active: u.is_active,
              count: 0,
            };
            b.count = (b.count as number) + 1;
            buckets.set(key, b);
          }
          return [...buckets.values()].map((b) => ({ ...b, count: String(b.count) }));
        }
        if (hasCount) {
          const counts: Record<string, number> = {};
          for (const u of rows) {
            const key = String(u.role);
            counts[key] = (counts[key] ?? 0) + 1;
          }
          return Object.entries(counts).map(([role, count]) => ({ role, count: String(count) }));
        }
        return rows;
      },
    } as unknown;
  }

  function simpleCountStub(total: number, active = total) {
    return {
      sequelize: { fn: () => ({}), col: (n: string) => n },
      findAll: async (options: {
        attributes?: Array<string | [unknown, string]>;
        group?: string[];
        where?: Row;
      }) => {
        // School-grouped list stats: one row per school_id with total.
        if (options.group?.includes('school_id')) {
          const whereValue = options.where?.school_id as
            Record<symbol | string, unknown> | undefined;
          const schoolIds = whereValue
            ? ((((whereValue as Record<symbol, string[]>)[Op.in] ??
                Object.values(whereValue)[0]) as string[]) ?? [])
            : [];
          return schoolIds.map((id) => ({ school_id: id, count: String(total) }));
        }
        if (options.group?.includes('is_active')) {
          return [
            { is_active: true, count: String(active) },
            { is_active: false, count: String(total - active) },
          ];
        }
        if (options.group?.includes('status')) {
          return [
            { status: 'SCHEDULED', count: String(total) },
            { status: 'COMPLETED', count: '2' },
          ];
        }
        return [{ count: String(total) }];
      },
    } as unknown;
  }

  /** Read-only plan catalog stub (Task 41 plans are the subscription source). */
  function planStub() {
    return {
      findOne: async (options: { where: Row }) =>
        plans.find((p) => p.id === options.where.id) ?? null,
      findAll: async (options: { where?: Row; group?: string[] } = {}) => {
        if (options.group?.includes('is_active')) {
          const active = plans.filter((p) => p.is_active).length;
          const inactive = plans.filter((p) => !p.is_active).length;
          const out: Row[] = [];
          if (active) out.push({ is_active: true, count: String(active) });
          if (inactive) out.push({ is_active: false, count: String(inactive) });
          return out;
        }
        const idWhere = options.where?.id as Record<symbol, string[]> | undefined;
        const ids = idWhere ? idWhere[Op.in] : undefined;
        return ids ? plans.filter((p) => ids.includes(p.id as string)) : plans;
      },
    } as unknown;
  }

  /** In-memory `school_subscriptions` table honouring the live-status filter. */
  function subscriptionStub() {
    const matches = (row: Row, where: Row): boolean =>
      Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object') {
          const list = (value as Record<symbol, unknown[]>)[Op.in];
          if (Array.isArray(list)) return list.includes(row[key]);
        }
        return row[key] === value;
      });
    const sorted = (rows: Row[], order?: Array<[string, string]>) =>
      [...rows].sort((a, b) => {
        for (const [column, direction] of order ?? [['created_at', 'DESC']]) {
          const av = a[column] as never;
          const bv = b[column] as never;
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
        }
        return 0;
      });
    let seq = 0;
    return {
      sequelize: {
        transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({}),
      },
      findOne: async (options: { where: Row; order?: Array<[string, string]> }) =>
        sorted(subscriptions.filter((r) => matches(r, options.where)), options.order)[0] ?? null,
      findAll: async (options: { where?: Row; order?: Array<[string, string]> } = {}) =>
        sorted(
          options.where ? subscriptions.filter((r) => matches(r, options.where!)) : subscriptions,
          options.order,
        ),
      create: async (data: Row) => {
        seq += 1;
        const row: Row = {
          id: `sub-${seq}`,
          status: 'active',
          trial_start: null,
          trial_end: null,
          current_period_start: now(),
          current_period_end: null,
          cancelled_at: null,
          created_at: new Date(Date.now() + seq),
          updated_at: new Date(Date.now() + seq),
          deleted_at: null,
          ...data,
        };
        row.update = async (patch: Row) => {
          Object.assign(row, patch, { updated_at: now() });
          return row;
        };
        subscriptions.push(row);
        return row;
      },
    } as unknown;
  }

  function refreshTokenStub() {
    return {
      unscoped() {
        return this;
      },
      create: async (data: Row) => ({ id: 'rt-1', revoked_at: null, ...data }),
      findOne: async () => null,
      update: async (_patch?: unknown, options?: { where?: Row }) => {
        if (!options || options.where?.school_id) revokedSessions += 1;
        return [1];
      },
    } as unknown;
  }

  // ---- App bootstrap --------------------------------------------------
  const app = await createSmokeApp();

  const schoolsRepo = schoolStub();
  const usersRepo = userStub();
  const refreshRepo = refreshTokenStub();

  // Swap a service's constructor-injected model repositories for stubs.
  const patchService = (service: unknown, stubs: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(stubs)) {
      (service as Record<string, unknown>)[key] = value;
    }
  };

  // Resolve the actual created services and swap their repositories.
  const adminSchoolsService = app.get(AdminSchoolsService);
  const dashboardService = app.get(AdminDashboardService);
  const adminsService = app.get(AdminSchoolAdminsService);
  const onboardingService = app.get(SchoolsService);
  const authService = app.get(AuthService);
  const accessService = app.get(SchoolAccessService);

  patchService(adminSchoolsService, {
    schools: schoolsRepo,
    users: usersRepo,
    students: simpleCountStub(12, 11),
    buses: simpleCountStub(4, 3),
    routes: simpleCountStub(3, 3),
    trips: simpleCountStub(5, 5),
    // School 360 resource overview: route stops and crew assignments.
    stops: simpleCountStub(18, 18),
    assignments: simpleCountStub(6, 5),
    refreshTokens: refreshRepo,
    onboarding: onboardingService,
  });
  patchService(dashboardService, {
    schools: schoolsRepo,
    users: usersRepo,
    students: simpleCountStub(12),
    buses: simpleCountStub(4, 3),
    routes: simpleCountStub(3, 3),
    trips: simpleCountStub(7, 5),
    plans: planStub(),
    subscriptions: subscriptionStub(),
  });
  patchService(adminsService, { schools: schoolsRepo, users: usersRepo });
  const subscriptionsService = app.get(AdminSubscriptionsService);
  patchService(subscriptionsService, {
    subscriptions: subscriptionStub(),
    schools: schoolsRepo,
    plans: planStub(),
  });
  const globalSubscriptionsService = app.get(AdminGlobalSubscriptionsService);
  const emptyRawRepo = () =>
    ({
      findAll: async () => [],
    }) as unknown;
  patchService(globalSubscriptionsService, {
    subscriptions: subscriptionStub(),
    schools: schoolsRepo,
    plans: planStub(),
    users: emptyRawRepo(),
    students: emptyRawRepo(),
    buses: emptyRawRepo(),
    routes: emptyRawRepo(),
    stops: emptyRawRepo(),
    trips: emptyRawRepo(),
  });
  patchService(onboardingService, { schools: schoolsRepo, users: usersRepo });
  // Auth service repos are indexed by their token names; patch directly.
  patchService(authService, { users: usersRepo, refreshTokens: refreshRepo });
  // The SchoolAccessService uses the platform school repo; make it honor the
  // live active map so deactivation blocks access.
  patchService(accessService, {
    schools: {
      findOne: async ({ where }: { where: { id: string } }) =>
        schoolActive.has(where.id)
          ? ({ id: where.id, is_active: schoolActive.get(where.id) } as unknown as School)
          : null,
    },
    // The container always wires the user repository, so the
    // account-active check needs a stub too.
    users: undefined,
  });

  const server = app.getHttpServer();
  await app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const jwt = app.get(JwtService);
  const signToken = async (role: UserRole, schoolId: string | null) => {
    const payload: JwtAccessTokenPayload = {
      sub: role === UserRole.SUPER_ADMIN ? 'super-admin-id' : 'school-user-id',
      school_id: schoolId,
      role,
    };
    return jwt.signAsync(payload);
  };

  // Seed a platform super admin row for login (bcrypt hash).
  const superPasswordHash = await bcrypt.hash('super-password-123', 4);
  users.push({
    id: 'super-admin-id',
    school_id: null,
    role: UserRole.SUPER_ADMIN,
    first_name: 'Platform',
    last_name: 'Admin',
    email: 'super@platform.test',
    password_hash: superPasswordHash,
    email_verified_at: now(),
    phone: null,
    is_active: true,
  });

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

  console.log('\nSuper Admin platform smoke test\n');

  const superToken = await signToken(UserRole.SUPER_ADMIN, null);
  const schoolAdminToken = await signToken(UserRole.SCHOOL_ADMIN, 'tenant-1');

  let createdSchoolId = '';

  await check('unauthenticated request to /admin/dashboard is rejected with 401', async () => {
    const res = await call('GET', '/admin/dashboard');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('school admin is rejected from /admin/dashboard with 403', async () => {
    const res = await call('GET', '/admin/dashboard', { token: schoolAdminToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('super admin dashboard returns aggregate metrics', async () => {
    const res = await call('GET', '/admin/dashboard', { token: superToken });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { schools: { total: number } } };
    if (typeof body.data.schools.total !== 'number') throw new Error('missing school totals');
  });

  await check('create school with initial admin returns 201 and no credentials', async () => {
    const res = await call('POST', '/admin/schools', {
      token: superToken,
      body: {
        school: {
          name: 'Lincoln High School',
          code: 'lincoln-high',
          city: 'Springfield',
          country: 'us',
        },
        admin: {
          first_name: 'Alicia',
          last_name: 'Adams',
          email: 'admin@lincoln.test',
          password: 'school-admin-pass',
        },
      },
    });
    if (res.status !== 201)
      throw new Error(`expected 201, got ${res.status} ${JSON.stringify(res.json)}`);
    const serialized = JSON.stringify(res.json);
    if (serialized.includes('password')) throw new Error('response leaks password');
    const body = res.json as { data: { school: { id: string; status: string } } };
    createdSchoolId = body.data.school.id;
    if (body.data.school.status !== 'active') throw new Error('new school should be active');
  });

  await check('duplicate school code is rejected with 409', async () => {
    const res = await call('POST', '/admin/schools', {
      token: superToken,
      body: {
        school: { name: 'Duplicate', code: 'lincoln-high' },
        admin: {
          first_name: 'Other',
          last_name: 'Admin',
          email: 'other@lincoln.test',
          password: 'password123',
        },
      },
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  await check('school list includes stats and primary admin (no N+1)', async () => {
    const res = await call('GET', '/admin/schools?search=lincoln&status=active', {
      token: superToken,
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as {
      data: {
        items: Array<{ stats: { student_count: number }; primary_admin: { email: string } }>;
      };
    };
    const item = body.data.items[0];
    if (!item || item.stats.student_count !== 12)
      throw new Error(`missing stats: ${JSON.stringify(body.data.items[0]?.stats)}`);
    if (item.primary_admin.email !== 'admin@lincoln.test') throw new Error('missing primary admin');
  });

  await check('school details returns profile, stats and admins', async () => {
    const res = await call('GET', `/admin/schools/${createdSchoolId}`, { token: superToken });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { subscription: { status: string }; admins: unknown[] } };
    if (body.data.subscription.status !== 'none')
      throw new Error('subscription placeholder missing');
    if (body.data.admins.length !== 1) throw new Error('expected one admin');
  });

  await check(
    'school details reports the School 360 resource overview (stops + assignments)',
    async () => {
      const res = await call('GET', `/admin/schools/${createdSchoolId}`, { token: superToken });
      if (res.status !== 200)
        throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
      const stats = (res.json as { data: { stats: Record<string, number> } }).data.stats;
      if (stats.stop_count !== 18) throw new Error(`expected 18 stops, got ${stats.stop_count}`);
      if (stats.assignment_count !== 6)
        throw new Error(`expected 6 assignments, got ${stats.assignment_count}`);
      if (stats.active_assignment_count !== 5)
        throw new Error(`expected 5 active assignments, got ${stats.active_assignment_count}`);
      // Previously reported counters must keep working unchanged.
      if (stats.student_count !== 12) throw new Error('student_count regressed');
      if (stats.route_count !== 3) throw new Error('route_count regressed');
    },
  );

  await check('PATCH updates school profile only (code/tenant fields rejected)', async () => {
    const res = await call('PATCH', `/admin/schools/${createdSchoolId}`, {
      token: superToken,
      body: { name: 'Lincoln High School (Updated)', city: 'Springfield' },
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { name: string; city: string; code: string } };
    if (body.data.name !== 'Lincoln High School (Updated)') throw new Error('name not updated');
    if (body.data.city !== 'Springfield') throw new Error('city not updated');
    if (body.data.code !== 'lincoln-high') throw new Error('tenant code changed unexpectedly');

    // Tenant identity / lifecycle fields are not accepted on this endpoint.
    const codeAttempt = await call('PATCH', `/admin/schools/${createdSchoolId}`, {
      token: superToken,
      body: { code: 'hacked-code' },
    });
    if (codeAttempt.status !== 400)
      throw new Error(`tenant code mutation must be rejected, got ${codeAttempt.status}`);
    const lifecycleAttempt = await call('PATCH', `/admin/schools/${createdSchoolId}`, {
      token: superToken,
      body: { is_active: true },
    });
    if (lifecycleAttempt.status !== 400)
      throw new Error(`lifecycle flag via PATCH must be rejected, got ${lifecycleAttempt.status}`);
  });

  await check('validation rejects a client-supplied role on create (400)', async () => {
    const res = await call('POST', '/admin/schools', {
      token: superToken,
      body: {
        school: { name: 'Hack', code: 'hack-school' },
        admin: { first_name: 'H', last_name: 'A', email: 'h@h.test', password: 'password123' },
        role: 'SUPER_ADMIN',
      },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  // Create a school user (driver) in the new tenant.
  const driverId = 'driver-1';
  users.push({
    id: driverId,
    school_id: createdSchoolId,
    role: UserRole.DRIVER,
    first_name: 'Dana',
    last_name: 'Driver',
    email: 'driver@lincoln.test',
    password_hash: await bcrypt.hash('driver-password', 4),
    is_active: true,
  });

  await check('driver can authenticate against an active tenant via /auth/login', async () => {
    const res = await call('POST', '/auth/login', {
      body: {
        school_id: createdSchoolId,
        email: 'driver@lincoln.test',
        password: 'driver-password',
      },
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
  });

  await check('super admin logs in with no school_id (platform login)', async () => {
    const res = await call('POST', '/auth/login', {
      body: { email: 'super@platform.test', password: 'super-password-123' },
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { user: { role: string; school_id: string | null } } };
    if (body.data.user.role !== UserRole.SUPER_ADMIN) throw new Error('wrong role');
    if (body.data.user.school_id !== null)
      throw new Error('platform login must return null school_id');
  });

  await check('deactivate school: 200 and refresh sessions revoked', async () => {
    revokedSessions = 0;
    const res = await call('POST', `/admin/schools/${createdSchoolId}/deactivate`, {
      token: superToken,
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    if (revokedSessions !== 1)
      throw new Error(`expected refresh session revocation, got ${revokedSessions}`);
  });

  await check(
    'deactivated school: driver login is blocked with 403 "School is inactive"',
    async () => {
      const res = await call('POST', '/auth/login', {
        body: {
          school_id: createdSchoolId,
          email: 'driver@lincoln.test',
          password: 'driver-password',
        },
      });
      if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
      const body = res.json as { error?: { message?: string } };
      if (body.error?.message !== 'School is inactive')
        throw new Error(`wrong message: ${body.error?.message}`);
    },
  );

  await check(
    'deactivated school: a still-valid driver access token is rejected (403)',
    async () => {
      const driverToken = await signToken(UserRole.DRIVER, createdSchoolId);
      const res = await call('GET', '/buses', { token: driverToken });
      if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
    },
  );

  await check('super admin can still manage the inactive school (details 200)', async () => {
    const res = await call('GET', `/admin/schools/${createdSchoolId}`, { token: superToken });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  });

  await check('school list status filter shows the school as inactive', async () => {
    const res = await call('GET', '/admin/schools?status=inactive', { token: superToken });
    const body = res.json as { data: { items: Array<{ is_active: boolean }> } };
    if (!body.data.items.some((i) => i.is_active === false))
      throw new Error('inactive school missing');
  });

  await check('activate school restores driver access', async () => {
    const res = await call('POST', `/admin/schools/${createdSchoolId}/activate`, {
      token: superToken,
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const login = await call('POST', '/auth/login', {
      body: {
        school_id: createdSchoolId,
        email: 'driver@lincoln.test',
        password: 'driver-password',
      },
    });
    if (login.status !== 200)
      throw new Error(`driver login should work again, got ${login.status}`);
  });

  await check('school admin management: create + list an additional admin', async () => {
    const created = await call('POST', `/admin/schools/${createdSchoolId}/admins`, {
      token: superToken,
      body: {
        first_name: 'Bob',
        last_name: 'Baker',
        email: 'bob@lincoln.test',
        password: 'bob-password-123',
      },
    });
    if (created.status !== 201)
      throw new Error(`expected 201, got ${created.status} ${JSON.stringify(created.json)}`);
    const list = await call('GET', `/admin/schools/${createdSchoolId}/admins`, {
      token: superToken,
    });
    if (list.status !== 200) throw new Error(`expected 200, got ${list.status}`);
    const body = list.json as { data: { items: unknown[] } };
    if (body.data.items.length !== 2)
      throw new Error(`expected 2 admins, got ${body.data.items.length}`);
    if (JSON.stringify(list.json).includes('password_hash')) throw new Error('credentials leaked');
  });

  await check('duplicate admin email in tenant is rejected with 409', async () => {
    const res = await call('POST', `/admin/schools/${createdSchoolId}/admins`, {
      token: superToken,
      body: {
        first_name: 'A',
        last_name: 'B',
        email: 'ADMIN@lincoln.test',
        password: 'password123',
      },
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  // ---- Task 42: school subscriptions -----------------------------------
  const ACTIVE_PLAN_ID = '00000000-0000-4000-9000-000000000001';
  const RETIRED_PLAN_ID = '00000000-0000-4000-9000-000000000002';
  const UPGRADE_PLAN_ID = '00000000-0000-4000-9000-000000000003';
  const UNKNOWN_ID = '00000000-0000-4000-9000-0000000000ff';
  plans.push(
    {
      id: ACTIVE_PLAN_ID,
      code: 'basic',
      name: 'Basic',
      description: 'Starter tier',
      price_cents: 1999,
      currency: 'USD',
      billing_period: 'monthly',
      is_active: true,
      features: { live_tracking: true },
      limits: { students: { unlimited: false, value: 300 } },
      created_at: now(),
      updated_at: now(),
    },
    {
      id: RETIRED_PLAN_ID,
      code: 'legacy',
      name: 'Legacy',
      description: null,
      price_cents: 900,
      currency: 'USD',
      billing_period: 'monthly',
      is_active: false,
      features: {},
      limits: {},
      created_at: now(),
      updated_at: now(),
    },
    {
      id: UPGRADE_PLAN_ID,
      code: 'pro',
      name: 'Pro',
      description: 'Growth tier',
      price_cents: 4900,
      currency: 'USD',
      billing_period: 'monthly',
      is_active: true,
      features: { live_tracking: true, analytics: true },
      limits: { students: { unlimited: true, value: null } },
      created_at: now(),
      updated_at: now(),
    },
  );

  const subscriptionPath = `/admin/schools/${createdSchoolId}/subscription`;

  await check('subscription: unauthenticated read is rejected with 401', async () => {
    const res = await call('GET', subscriptionPath);
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('subscription: school admin is rejected with 403 on every route', async () => {
    const attempts = [
      await call('GET', subscriptionPath, { token: schoolAdminToken }),
      await call('POST', subscriptionPath, {
        token: schoolAdminToken,
        body: { plan_id: ACTIVE_PLAN_ID },
      }),
      await call('PATCH', subscriptionPath, {
        token: schoolAdminToken,
        body: { plan_id: ACTIVE_PLAN_ID },
      }),
      await call('POST', `${subscriptionPath}/cancel`, { token: schoolAdminToken, body: {} }),
    ];
    for (const res of attempts) {
      if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
    }
  });

  await check('subscription: school without one reads back as a clean `none` state', async () => {
    const res = await call('GET', subscriptionPath, { token: superToken });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { status: string; plan: unknown; id: string | null } };
    if (body.data.status !== 'none') throw new Error(`expected none, got ${body.data.status}`);
    if (body.data.plan !== null || body.data.id !== null)
      throw new Error('none state must be empty');
  });

  await check('subscription: unknown school returns 404 (never a subscription orphan)', async () => {
    const res = await call('GET', `/admin/schools/${UNKNOWN_ID}/subscription`, {
      token: superToken,
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('subscription: an inactive plan cannot be assigned (409)', async () => {
    const res = await call('POST', subscriptionPath, {
      token: superToken,
      body: { plan_id: RETIRED_PLAN_ID },
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  await check('subscription: an unknown plan is rejected with 404', async () => {
    const res = await call('POST', subscriptionPath, {
      token: superToken,
      body: { plan_id: UNKNOWN_ID },
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('subscription: invalid dates are rejected with 400', async () => {
    const res = await call('POST', subscriptionPath, {
      token: superToken,
      body: {
        plan_id: ACTIVE_PLAN_ID,
        trial_start: '2026-03-10T00:00:00.000Z',
        trial_end: '2026-03-01T00:00:00.000Z',
      },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('subscription: super admin assigns an active plan (201 + plan terms)', async () => {
    const res = await call('POST', subscriptionPath, {
      token: superToken,
      body: { plan_id: ACTIVE_PLAN_ID, current_period_end: '2026-12-31T00:00:00.000Z' },
    });
    if (res.status !== 201)
      throw new Error(`expected 201, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as {
      data: {
        status: string;
        plan: { code: string } | null;
        price: string;
        billing_period: string;
        current_period_end: string;
      };
    };
    if (body.data.status !== 'active') throw new Error(`wrong status ${body.data.status}`);
    if (body.data.plan?.code !== 'basic') throw new Error('plan relationship missing');
    if (body.data.price !== '19.99') throw new Error(`wrong price ${body.data.price}`);
    if (body.data.billing_period !== 'monthly') throw new Error('missing billing period');
    if (!body.data.current_period_end) throw new Error('missing current period end');
  });

  await check('subscription: a duplicate active subscription is rejected with 409', async () => {
    const res = await call('POST', subscriptionPath, {
      token: superToken,
      body: { plan_id: ACTIVE_PLAN_ID },
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  await check('subscription: school details now reports the real subscription', async () => {
    const res = await call('GET', `/admin/schools/${createdSchoolId}`, { token: superToken });
    const body = res.json as {
      data: { subscription: { status: string; plan: { code: string } | null } };
    };
    if (body.data.subscription.status !== 'active')
      throw new Error(`expected active, got ${body.data.subscription.status}`);
    if (body.data.subscription.plan?.code !== 'basic')
      throw new Error('school details must expose the plan reference');
  });

  await check('subscription: plan change keeps the previous record as history', async () => {
    const before = subscriptions.length;
    const res = await call('PATCH', subscriptionPath, {
      token: superToken,
      body: { plan_id: UPGRADE_PLAN_ID },
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { plan: { code: string } | null; status: string } };
    if (body.data.plan?.code !== 'pro') throw new Error('plan was not changed');
    if (subscriptions.length !== before + 1)
      throw new Error('plan change must append a new subscription row');
    const expired = subscriptions.filter((r) => r.status === 'expired');
    if (expired.length !== 1) throw new Error('previous subscription must be closed, not deleted');
  });

  await check('subscription: status can be updated in place (past_due)', async () => {
    const res = await call('PATCH', subscriptionPath, {
      token: superToken,
      body: { status: 'past_due' },
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    const body = res.json as { data: { status: string } };
    if (body.data.status !== 'past_due') throw new Error(`wrong status ${body.data.status}`);
  });

  await check('subscription: cancel keeps the record and records the date', async () => {
    const before = subscriptions.length;
    const res = await call('POST', `${subscriptionPath}/cancel`, { token: superToken, body: {} });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as { data: { status: string; cancelled_at: string | null } };
    if (body.data.status !== 'cancelled') throw new Error(`wrong status ${body.data.status}`);
    if (!body.data.cancelled_at) throw new Error('cancellation date missing');
    if (subscriptions.length !== before) throw new Error('cancellation must not delete history');
  });

  await check('subscription: cancelling twice is rejected with 409', async () => {
    const res = await call('POST', `${subscriptionPath}/cancel`, { token: superToken, body: {} });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
  });

  await check('subscription: a cancelled school can be resubscribed', async () => {
    const res = await call('POST', subscriptionPath, {
      token: superToken,
      body: { plan_id: UPGRADE_PLAN_ID },
    });
    if (res.status !== 201)
      throw new Error(`expected 201, got ${res.status} ${JSON.stringify(res.json)}`);
    const read = await call('GET', subscriptionPath, { token: superToken });
    const body = read.json as { data: { status: string; plan: { code: string } | null } };
    if (body.data.status !== 'active' || body.data.plan?.code !== 'pro')
      throw new Error('resubscription did not become the current subscription');
  });

  // ---- Task 42 step 2: subscription history (read-only) -----------------

  await check('subscription history: unauthenticated read is rejected with 401', async () => {
    const res = await call('GET', `${subscriptionPath}/history`);
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('subscription history: school admin is rejected with 403', async () => {
    const res = await call('GET', `${subscriptionPath}/history`, { token: schoolAdminToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('subscription history: unknown school returns 404', async () => {
    const res = await call('GET', `/admin/schools/${UNKNOWN_ID}/subscription/history`, {
      token: superToken,
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('subscription history: every preserved record is returned newest-first', async () => {
    const res = await call('GET', `${subscriptionPath}/history`, { token: superToken });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const body = res.json as {
      data: {
        items: Array<{
          status: string;
          is_current: boolean;
          plan: { code: string } | null;
          cancelled_at: string | null;
          created_at: string | null;
        }>;
      };
    };
    const items = body.data.items;
    // Full flow above: basic assigned (expired on change), pro (cancelled),
    // pro resubscription (live) — three preserved rows, nothing deleted.
    if (items.length !== 3) throw new Error(`expected 3 history rows, got ${items.length}`);
    if (items[0].status !== 'active' || !items[0].is_current || items[0].plan?.code !== 'pro')
      throw new Error('newest row must be the live pro subscription');
    if (items[1].status !== 'cancelled' || items[1].is_current || !items[1].cancelled_at)
      throw new Error('cancelled row must be preserved with its cancellation date');
    if (items[2].status !== 'expired' || items[2].is_current || items[2].plan?.code !== 'basic')
      throw new Error('plan change must keep the superseded basic subscription as expired');
    const currentCount = items.filter((item) => item.is_current).length;
    if (currentCount !== 1) throw new Error('exactly one row may be current');
  });

  // ---- Task 45: global platform-wide subscriptions ----------------------

  await check('global subscriptions: unauthenticated read is rejected with 401', async () => {
    const res = await call('GET', '/admin/subscriptions');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  });

  await check('global subscriptions: school admin is rejected with 403', async () => {
    const res = await call('GET', '/admin/subscriptions', { token: schoolAdminToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await check('global subscriptions: super admin gets the platform list', async () => {
    const res = await call('GET', '/admin/subscriptions?limit=100', { token: superToken });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const data = (res.json as { data: { items: unknown[] } }).data;
    if (!Array.isArray(data.items) || data.items.length === 0)
      throw new Error('expected at least one subscription row');
  });

  await check('global subscriptions: an over-long search string is rejected with 400', async () => {
    const res = await call('GET', `/admin/subscriptions?search=${'a'.repeat(101)}`, {
      token: superToken,
    });
    if (res.status !== 400)
      throw new Error(`expected 400, got ${res.status} ${JSON.stringify(res.json)}`);
  });

  await check('global subscriptions: status filter returns no-subscription schools', async () => {
    const res = await call('GET', '/admin/subscriptions?status=none&limit=100', {
      token: superToken,
    });
    if (res.status !== 200)
      throw new Error(`expected 200, got ${res.status} ${JSON.stringify(res.json)}`);
    const data = (res.json as { data: { items: Array<{ status: string }> } }).data;
    if (data.items.some((item) => item.status !== 'none'))
      throw new Error('none filter must only return schools without subscriptions');
  });

  await app.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
