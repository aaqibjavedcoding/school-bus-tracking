import 'reflect-metadata';
import { after, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, NotFoundException, Reflector } from '../../framework';
import {
  JwtAccessTokenPayload,
  MissingRouteGeometryListResponse,
  RouteGeometryAvailableResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { invokeRoute, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import type { JwtService as JwtServiceType } from '../../framework';
import type { SchoolAccessService } from '../../common/access/school-access.service';
import type { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { ROUTE_NOT_FOUND_MESSAGE } from '../routes/routes.constants';
import {
  getAdminRoutesGeometryMissing,
  postAdminRoutesByRouteIdGeometryRecompute,
  putAdminRoutesByRouteIdGeometry,
} from '../../api/admin';
import { RouteGeometryService } from './route-geometry.service';
import type { MissingRouteGeometryService } from './missing-route-geometry.service';

/**
 * The PLATFORM geometry endpoints under `/api/v1/admin/routes/...`:
 *
 *  - SUPER_ADMIN only — the role metadata, and the full runtime: a SCHOOL_ADMIN,
 *    DRIVER, CONDUCTOR or PARENT gets 403, an anonymous caller 401;
 *  - the SUPER_ADMIN token carries `school_id: null` and still passes the
 *    guards (platform scope, not a tenant);
 *  - the body is the strict `StoreRouteGeometryDto`; a client-supplied
 *    `stops_hash` (or any unknown field) is 400 before the service runs —
 *    the key is never the caller's to pin;
 *  - the route id is a UUID path parameter; an unknown route is the generic 404;
 *  - a successful write is audited against the route's own school, by the
 *    platform actor.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROUTE_UNKNOWN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const putHandler = putAdminRoutesByRouteIdGeometry as EndpointDefinition<never, never>;
const recomputeHandler = postAdminRoutesByRouteIdGeometryRecompute as EndpointDefinition<
  never,
  never
>;
const missingHandler = getAdminRoutesGeometryMissing as EndpointDefinition<never, never>;

const ALL_ENDPOINTS = [missingHandler, putHandler, recomputeHandler];

/** Claims the stubbed JWT verifier maps each bearer token to. */
const SUPER_TOKEN = 'super-token';
const ADMIN_TOKEN = 'school-admin-token';
const DRIVER_TOKEN = 'driver-token';
const CONDUCTOR_TOKEN = 'conductor-token';
const PARENT_TOKEN = 'parent-token';

const CONTAINER_CLAIMS: Record<string, JwtAccessTokenPayload> = {
  [SUPER_TOKEN]: { sub: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN },
  [ADMIN_TOKEN]: { sub: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN },
  [DRIVER_TOKEN]: { sub: USER_ID, school_id: SCHOOL_A, role: UserRole.DRIVER },
  [CONDUCTOR_TOKEN]: { sub: USER_ID, school_id: SCHOOL_A, role: UserRole.CONDUCTOR },
  [PARENT_TOKEN]: { sub: USER_ID, school_id: SCHOOL_A, role: UserRole.PARENT },
};

/**
 * Stubs the container's JWT verification and school-access check so the FULL
 * route runtime drives authenticated requests (the pattern of
 * `routes/routes-geometry-endpoints.spec.ts`).
 */
function stubContainerAuth(): () => void {
  const jwt = {
    verifyAsync: async <T>(token: string): Promise<T> => {
      const claims = CONTAINER_CLAIMS[token];
      if (!claims) {
        throw new Error('invalid token');
      }
      return claims as T;
    },
  } as unknown as JwtServiceType;
  const schoolAccess = {
    isSchoolAccessible: async () => true,
    isUserActive: async () => true,
  } as unknown as SchoolAccessService;
  const restoreJwt = overrideContainer('jwt', jwt);
  const restoreSchoolAccess = overrideContainer('schoolAccess', schoolAccess);
  return () => {
    restoreJwt();
    restoreSchoolAccess();
  };
}

const OK_GEOMETRY: RouteGeometryAvailableResponse = {
  status: 'ok',
  route_id: ROUTE_ID,
  stops_hash: 'a'.repeat(64),
  geometry: {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0613, 33.6972],
    ],
  },
  distance_meters: 4820.5,
  duration_seconds: 612.3,
  legs: [],
  provider: 'osrm',
  computed_at: '2026-10-08T10:00:00.000Z',
};

const VALID_BODY = {
  status: 'road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0613, 33.6972],
    ],
  },
  distance_meters: 4820.5,
  duration_seconds: 612.3,
  legs: [],
  provider: 'osrm',
  computed_at: '2026-10-08T10:00:00.000Z',
};

const MISSING_PAGE: MissingRouteGeometryListResponse = {
  items: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
  schools: [],
  totals: {
    routes_total: 0,
    routes_cached: 0,
    routes_missing: 0,
    routes_unlocated: 0,
    outsideBbox: null,
    fillable: 0,
  },
};

/** Records every service and audit call the endpoints make. */
function installStubs() {
  const storeCalls: Array<{ routeId: string; dto: unknown }> = [];
  const recomputeCalls: string[] = [];
  const listCalls: unknown[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const geometry = {
    storeGeometryForRoute: async (routeId: string, dto: unknown) => {
      storeCalls.push({ routeId, dto });
      if (routeId === ROUTE_UNKNOWN) {
        throw new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
      }
      return { schoolId: SCHOOL_B, result: OK_GEOMETRY };
    },
    recomputeGeometryForRoute: async (routeId: string) => {
      recomputeCalls.push(routeId);
      if (routeId === ROUTE_UNKNOWN) {
        throw new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
      }
      return {
        schoolId: SCHOOL_B,
        result: { id: routeId, message: 'cleared', geometry: { status: 'unavailable' } },
      };
    },
  } as unknown as RouteGeometryService;

  const missing = {
    listMissing: async (query: { page: number; limit: number }) => {
      listCalls.push({ page: query.page, limit: query.limit });
      return MISSING_PAGE;
    },
  } as unknown as MissingRouteGeometryService;

  const audit = {
    log: async (entry: Record<string, unknown>) => {
      audits.push(entry);
    },
  } as unknown as AuditService;

  const restores = [
    overrideContainer('routeGeometry', geometry),
    overrideContainer('missingRouteGeometry', missing),
    overrideContainer('audit', audit),
  ];
  return {
    storeCalls,
    recomputeCalls,
    listCalls,
    audits,
    restore: () => restores.forEach((restore) => restore()),
  };
}

describe('platform geometry endpoints (authorization metadata)', () => {
  it('restricts every platform geometry endpoint to SUPER_ADMIN', () => {
    for (const definition of [
      getAdminRoutesGeometryMissing,
      putAdminRoutesByRouteIdGeometry,
      postAdminRoutesByRouteIdGeometryRecompute,
    ]) {
      assert.deepEqual(definition.roles, [UserRole.SUPER_ADMIN]);
    }
  });

  it('lets a SUPER_ADMIN with school_id null through the guards', async () => {
    for (const definition of ALL_ENDPOINTS) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signToken(UserRole.SUPER_ADMIN)}` },
      };
      await activateGuards(request, definition);
      const user = request.user as AuthenticatedRequestUser;
      assert.equal(user.role, UserRole.SUPER_ADMIN);
      assert.equal(user.school_id, null);
    }
  });

  it('rejects SCHOOL_ADMIN, DRIVER, CONDUCTOR and PARENT with 403', async () => {
    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      for (const definition of ALL_ENDPOINTS) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signToken(role)}` },
        };
        await assert.rejects(
          activateGuards(request, definition),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403, `${role} must be refused`);
            return true;
          },
        );
      }
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    for (const definition of ALL_ENDPOINTS) {
      await assert.rejects(
        activateGuards({ headers: {} }, definition),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    }
  });
});

async function signToken(role: UserRole): Promise<string> {
  return jwtService.signAsync({
    sub: USER_ID,
    school_id: role === UserRole.SUPER_ADMIN ? null : SCHOOL_A,
    role,
  } as JwtAccessTokenPayload);
}

describe('platform geometry endpoints (full runtime)', () => {
  // One auth stub for the whole suite: the container override is process-global
  // and node:test collects every describe body before running any test.
  const restoreAuth = stubContainerAuth();
  after(() => restoreAuth());

  const url = (path: string) => `http://localhost/api/v1/admin/routes${path}`;

  it('answers the SUPER_ADMIN list with the paginated page and forwards the query', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(missingHandler, {
        method: 'GET',
        url: url('/geometry/missing?page=2&limit=50'),
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
      });

      assert.equal(result.status, 200);
      assert.equal((result.body as { success: boolean }).success, true);
      assert.deepEqual(stubs.listCalls, [{ page: 2, limit: 50 }]);
    } finally {
      stubs.restore();
    }
  });

  it('applies the default pagination when no query is given', async () => {
    const stubs = installStubs();
    try {
      await invokeRoute(missingHandler, {
        method: 'GET',
        url: url('/geometry/missing'),
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
      });
      assert.deepEqual(stubs.listCalls, [{ page: 1, limit: 20 }]);
    } finally {
      stubs.restore();
    }
  });

  it('refuses an oversized page with 400 before the service runs', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(missingHandler, {
        method: 'GET',
        url: url('/geometry/missing?limit=500'),
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
      });
      assert.equal(result.status, 400);
      assert.equal(stubs.listCalls.length, 0);
    } finally {
      stubs.restore();
    }
  });

  it('stores a geometry for any school’s route and audits it against that school', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(putHandler, {
        method: 'PUT',
        params: { routeId: ROUTE_ID },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
        body: VALID_BODY,
      });

      assert.equal(result.status, 200);
      assert.equal(stubs.storeCalls.length, 1);
      assert.equal(stubs.storeCalls[0].routeId, ROUTE_ID);
      assert.equal(stubs.audits.length, 1);
      assert.equal(stubs.audits[0].school_id, SCHOOL_B, 'audited against the route’s own school');
      assert.equal(stubs.audits[0].actor_user_id, USER_ID);
      assert.equal(stubs.audits[0].action, AUDIT_ACTIONS.ROUTE_GEOMETRY_STORE);
      assert.equal(stubs.audits[0].entity_type, AUDIT_ENTITY_TYPES.ROUTE);
      assert.equal(stubs.audits[0].entity_id, ROUTE_ID);
    } finally {
      stubs.restore();
    }
  });

  it('refuses a client-supplied stops_hash with 400 — the key is never the caller’s', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(putHandler, {
        method: 'PUT',
        params: { routeId: ROUTE_ID },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
        body: { ...VALID_BODY, stops_hash: 'f'.repeat(64) },
      });
      assert.equal(result.status, 400);
      assert.equal(stubs.storeCalls.length, 0, 'a pinned hash never reaches the service');
      assert.equal(stubs.audits.length, 0);
    } finally {
      stubs.restore();
    }
  });

  it('refuses a malformed geometry with 400 before the service runs', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(putHandler, {
        method: 'PUT',
        params: { routeId: ROUTE_ID },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
        body: { ...VALID_BODY, geometry: { type: 'LineString', coordinates: [[73.04, 33.68]] } },
      });
      assert.equal(result.status, 400);
      assert.equal(stubs.storeCalls.length, 0);
    } finally {
      stubs.restore();
    }
  });

  it('refuses a route id that is not a UUID with 400', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(putHandler, {
        method: 'PUT',
        params: { routeId: 'not-a-uuid' },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
        body: VALID_BODY,
      });
      assert.equal(result.status, 400);
      assert.equal(stubs.storeCalls.length, 0);
    } finally {
      stubs.restore();
    }
  });

  it('answers the generic 404 for an unknown route on PUT and on recompute', async () => {
    const stubs = installStubs();
    try {
      const put = await invokeRoute(putHandler, {
        method: 'PUT',
        params: { routeId: ROUTE_UNKNOWN },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
        body: VALID_BODY,
      });
      assert.equal(put.status, 404);

      const recompute = await invokeRoute(recomputeHandler, {
        method: 'POST',
        params: { routeId: ROUTE_UNKNOWN },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
      });
      assert.equal(recompute.status, 404);
      assert.equal(stubs.audits.length, 0, 'a refused write is not audited as a write');
    } finally {
      stubs.restore();
    }
  });

  it('recomputes any school’s route for the SUPER_ADMIN and audits it', async () => {
    const stubs = installStubs();
    try {
      const result = await invokeRoute(recomputeHandler, {
        method: 'POST',
        params: { routeId: ROUTE_ID },
        headers: { authorization: `Bearer ${SUPER_TOKEN}` },
      });

      assert.equal(result.status, 200);
      assert.deepEqual(stubs.recomputeCalls, [ROUTE_ID]);
      assert.equal(stubs.audits[0].action, AUDIT_ACTIONS.ROUTE_GEOMETRY_RECOMPUTE);
      assert.equal(stubs.audits[0].school_id, SCHOOL_B);
    } finally {
      stubs.restore();
    }
  });

  it('keeps the 403 for a SCHOOL_ADMIN on every platform endpoint in the full runtime', async () => {
    const stubs = installStubs();
    try {
      const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };
      const list = await invokeRoute(missingHandler, {
        method: 'GET',
        url: url('/geometry/missing'),
        headers,
      });
      const put = await invokeRoute(putHandler, {
        method: 'PUT',
        params: { routeId: ROUTE_ID },
        headers,
        body: VALID_BODY,
      });
      const recompute = await invokeRoute(recomputeHandler, {
        method: 'POST',
        params: { routeId: ROUTE_ID },
        headers,
      });
      assert.deepEqual([list.status, put.status, recompute.status], [403, 403, 403]);
      assert.equal(stubs.storeCalls.length + stubs.recomputeCalls.length + stubs.listCalls.length, 0);
    } finally {
      stubs.restore();
    }
  });

  it('keeps the 403 for DRIVER, CONDUCTOR and PARENT in the full runtime', async () => {
    const stubs = installStubs();
    try {
      for (const token of [DRIVER_TOKEN, CONDUCTOR_TOKEN, PARENT_TOKEN]) {
        const headers = { authorization: `Bearer ${token}` };
        const put = await invokeRoute(putHandler, {
          method: 'PUT',
          params: { routeId: ROUTE_ID },
          headers,
          body: VALID_BODY,
        });
        assert.equal(put.status, 403, `token ${token}`);
      }
      assert.equal(stubs.storeCalls.length, 0);
    } finally {
      stubs.restore();
    }
  });
});
