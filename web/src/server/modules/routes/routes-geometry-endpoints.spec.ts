import 'reflect-metadata';
import { after, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, NotFoundException, Reflector } from '../../framework';
import {
  JwtAccessTokenPayload,
  RouteGeometryAvailableResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { callHandler, invokeRoute, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import type { JwtService as JwtServiceType } from '../../framework';
import type { SchoolAccessService } from '../../common/access/school-access.service';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RouteGeometryService } from '../routing/route-geometry.service';
import { StoreRouteGeometryDto } from '../routing/dto/store-route-geometry.dto';
import { ROUTE_NOT_FOUND_MESSAGE } from './routes.constants';
import { postRoutesByIdGeometryRecompute, putRoutesByIdGeometry } from '../../api/routes';

/**
 * The geometry WRITE endpoints — `PUT /routes/:id/geometry` and
 * `POST /routes/:id/geometry/recompute` — at the HTTP boundary:
 *
 *  - SCHOOL_ADMIN only (the same guard contract as every other route
 *    mutation); crew, parents and SUPER_ADMIN get 403, anonymous gets 401;
 *  - the body is validated by the global pipe through the FULL route
 *    runtime: a bad LineString, a bad coordinate, a null/NaN distance and a
 *    client-supplied school_id are all 400 before the service runs;
 *  - the tenant comes from the JWT: a cross-tenant id surfaces the same
 *    generic 404 as `GET /routes/:id`;
 *  - the service receives the validated DTO, scoped to the token school.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 'unit-test-jwt-secret';
/** Authenticated SCHOOL_ADMIN actor, as the guards would have populated it. */
const ADMIN_USER = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A): Promise<string> {
  const payload: JwtAccessTokenPayload = {
    sub: USER_ID,
    school_id: role === UserRole.SUPER_ADMIN ? null : schoolId,
    role,
  };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

function makeContext(request: MockRequest, definition: EndpointDefinition<never, never>) {
  return makeGuardContext(definition, request as unknown as Record<string, unknown>);
}

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeContext(request, definition);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const putGeometryHandler = putRoutesByIdGeometry as EndpointDefinition<never, never>;
const recomputeHandler = postRoutesByIdGeometryRecompute as EndpointDefinition<never, never>;

/**
 * Stubs the container's JWT verification and school-access check so the
 * FULL route runtime (the same pattern as
 * `http/route-runtime-idempotency.spec.ts`) can drive authenticated
 * requests: any bearer token maps to a fixed claim set. The guard chain,
 * the runtime sequencing and the envelope stay production code.
 */
function stubContainerAuth(claimsByToken: Record<string, JwtAccessTokenPayload>): () => void {
  const jwt = {
    verifyAsync: async <T>(token: string): Promise<T> => {
      const claims = claimsByToken[token];
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

const ADMIN_TOKEN = 'admin-token';
const ADMIN_B_TOKEN = 'admin-b-token';
const DRIVER_TOKEN = 'driver-token';

const CONTAINER_CLAIMS: Record<string, JwtAccessTokenPayload> = {
  [ADMIN_TOKEN]: { sub: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN },
  [ADMIN_B_TOKEN]: { sub: USER_ID, school_id: SCHOOL_B, role: UserRole.SCHOOL_ADMIN },
  [DRIVER_TOKEN]: { sub: USER_ID, school_id: SCHOOL_A, role: UserRole.DRIVER },
};

const VALID_BODY = {
  status: 'road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
      [73.0613, 33.6972],
    ],
  },
  distance_meters: 4820.5,
  duration_seconds: 612.3,
  legs: [
    {
      distance_meters: 2410.2,
      duration_seconds: 300.1,
      maneuvers: [
        {
          type: 'depart',
          modifier: null,
          road_name: 'Margalla Road',
          distance_meters: 120.4,
          location: [73.0479, 33.6844],
        },
      ],
    },
  ],
  provider: 'osrm',
  computed_at: '2026-10-08T10:00:00.000Z',
};

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

interface RecordedCall {
  schoolId: string;
  id: string;
  dto?: unknown;
}

/** A stub geometry service recording every write-path call. */
function recordingGeometryService(behaviour?: { storeError?: unknown; recomputeError?: unknown }): {
  service: RouteGeometryService;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const service = {
    get enabled() {
      return true;
    },
    storeGeometry: async (schoolId: string, id: string, dto: StoreRouteGeometryDto) => {
      calls.push({ schoolId, id, dto });
      if (behaviour?.storeError) {
        throw behaviour.storeError;
      }
      return OK_GEOMETRY;
    },
    recomputeGeometry: async (schoolId: string, id: string) => {
      calls.push({ schoolId, id });
      if (behaviour?.recomputeError) {
        throw behaviour.recomputeError;
      }
      return {
        id,
        message: 'Cached route geometry cleared',
        geometry: OK_GEOMETRY,
      };
    },
  } as unknown as RouteGeometryService;
  return { service, calls };
}

describe('route geometry write endpoints (authorization)', () => {
  it('restricts both write endpoints to SCHOOL_ADMIN via the roles metadata', () => {
    assert.deepEqual(putRoutesByIdGeometry.roles, [UserRole.SCHOOL_ADMIN]);
    assert.deepEqual(postRoutesByIdGeometryRecompute.roles, [UserRole.SCHOOL_ADMIN]);
  });

  it('allows a SCHOOL_ADMIN with a token-scoped school_id', async () => {
    for (const definition of [putGeometryHandler, recomputeHandler]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
      };
      await activateGuards(request, definition);
      const user = request.user as AuthenticatedRequestUser;
      assert.equal(user.role, UserRole.SCHOOL_ADMIN);
      assert.equal(user.school_id, SCHOOL_A);
    }
  });

  it('rejects crew, parents and SUPER_ADMIN with 403', async () => {
    for (const role of [
      UserRole.SUPER_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      for (const definition of [putGeometryHandler, recomputeHandler]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await assert.rejects(
          activateGuards(request, definition),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403);
            return true;
          },
        );
      }
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    for (const definition of [putGeometryHandler, recomputeHandler]) {
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

describe('route geometry write endpoints (full runtime)', () => {
  // One auth stub around both verb suites: the container override is
  // process-global and node:test collects every describe body before
  // running any test, so per-describe installs would restore each
  // other's override mid-run.
  const restoreAuth = stubContainerAuth(CONTAINER_CLAIMS);
  after(() => restoreAuth());

  describe('PUT /routes/:id/geometry', () => {
    it('rejects a bad LineString with 400 before the service runs', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
          body: {
            ...VALID_BODY,
            geometry: { type: 'LineString', coordinates: [[73.0479, 33.6844]] },
          },
        });
        assert.equal(result.status, 400);
        const envelope = result.body as { success?: boolean; error?: { message?: unknown } };
        assert.equal(envelope.success, false);
        assert.ok(envelope.error?.message, 'the validation error names the problem');
        assert.equal(calls.length, 0, 'validation failures never reach the service');
      } finally {
        restore();
      }
    });

    it('rejects a bad coordinate with 400', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
          body: {
            ...VALID_BODY,
            geometry: {
              type: 'LineString',
              coordinates: [
                [73.0479, 33.6844],
                [73.0551, 95.0],
              ],
            },
          },
        });
        assert.equal(result.status, 400);
        assert.equal(calls.length, 0);
      } finally {
        restore();
      }
    });

    it('rejects a null distance (what NaN serialises to over JSON) with 400', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
          body: { ...VALID_BODY, distance_meters: null },
        });
        assert.equal(result.status, 400);
        assert.equal(calls.length, 0);
      } finally {
        restore();
      }
    });

    it('rejects a client-supplied school_id with 400 (the tenant is the JWT)', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
          body: { ...VALID_BODY, school_id: SCHOOL_B },
        });
        assert.equal(result.status, 400);
        assert.equal(calls.length, 0);
      } finally {
        restore();
      }
    });

    it('rejects a malformed route id with 400', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: 'not-a-uuid' },
          headers: { authorization: `Bearer ${token}` },
          body: VALID_BODY,
        });
        assert.equal(result.status, 400);
        assert.equal(calls.length, 0);
      } finally {
        restore();
      }
    });

    it('stores the validated DTO, scoped to the token school', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
          body: VALID_BODY,
        });

        assert.equal(result.status, 200);
        const envelope = result.body as {
          success?: boolean;
          data?: RouteGeometryAvailableResponse;
        };
        assert.equal(envelope.success, true);
        assert.equal(envelope.data?.status, 'ok');
        assert.equal(envelope.data?.route_id, ROUTE_ID);

        assert.equal(calls.length, 1);
        assert.equal(calls[0].schoolId, SCHOOL_A);
        assert.equal(calls[0].id, ROUTE_ID);
        const dto = calls[0].dto as StoreRouteGeometryDto;
        assert.ok(dto instanceof StoreRouteGeometryDto, 'the service gets the validated DTO');
        assert.equal(dto.status, 'road');
        assert.equal(dto.provider, 'osrm');
        assert.equal(dto.distance_meters, 4820.5);
        assert.equal(dto.geometry.coordinates.length, 3);
      } finally {
        restore();
      }
    });

    it('cross-tenant is denied: the service 404 surfaces as the generic envelope', async () => {
      const { service } = recordingGeometryService({
        storeError: new NotFoundException(ROUTE_NOT_FOUND_MESSAGE),
      });
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_B_TOKEN;
      try {
        const result = await invokeRoute(putGeometryHandler, {
          method: 'PUT',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
          body: VALID_BODY,
        });

        assert.equal(result.status, 404);
        const envelope = result.body as { success?: boolean; error?: { message?: unknown } };
        assert.equal(envelope.success, false);
        assert.equal(envelope.error?.message, ROUTE_NOT_FOUND_MESSAGE);
      } finally {
        restore();
      }
    });
  });

  describe('POST /routes/:id/geometry/recompute', () => {
    it('recomputes scoped to the token school and returns the honest result', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_TOKEN;
      try {
        const result = await invokeRoute(recomputeHandler, {
          method: 'POST',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(result.status, 200, 'an action, not a creation — 200 not 201');
        const envelope = result.body as {
          success?: boolean;
          data?: { id?: string; geometry?: { status?: string } };
        };
        assert.equal(envelope.success, true);
        assert.equal(envelope.data?.id, ROUTE_ID);
        assert.equal(envelope.data?.geometry?.status, 'ok');

        assert.deepEqual(calls, [{ schoolId: SCHOOL_A, id: ROUTE_ID }]);
      } finally {
        restore();
      }
    });

    it('rejects a non-admin role with 403 through the runtime', async () => {
      const { service, calls } = recordingGeometryService();
      const restore = overrideContainer('routeGeometry', service);
      const token = DRIVER_TOKEN;
      try {
        const result = await invokeRoute(recomputeHandler, {
          method: 'POST',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(result.status, 403);
        assert.equal(calls.length, 0);
      } finally {
        restore();
      }
    });

    it('cross-tenant recompute surfaces the generic 404', async () => {
      const { service } = recordingGeometryService({
        recomputeError: new NotFoundException(ROUTE_NOT_FOUND_MESSAGE),
      });
      const restore = overrideContainer('routeGeometry', service);
      const token = ADMIN_B_TOKEN;
      try {
        const result = await invokeRoute(recomputeHandler, {
          method: 'POST',
          params: { id: ROUTE_ID },
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(result.status, 404);
        const envelope = result.body as { error?: { message?: unknown } };
        assert.equal(envelope.error?.message, ROUTE_NOT_FOUND_MESSAGE);
      } finally {
        restore();
      }
    });
  });
});

describe('route geometry write endpoints (handler wiring)', () => {
  it('the PUT handler passes the parsed uuid and the body to the service', async () => {
    const { service, calls } = recordingGeometryService();
    const restore = overrideContainer('routeGeometry', service);
    try {
      const dto = new StoreRouteGeometryDto();
      Object.assign(dto, VALID_BODY);
      const result = (await callHandler(putRoutesByIdGeometry, {
        user: ADMIN_USER,
        params: { id: ROUTE_ID },
        body: dto,
      })) as RouteGeometryAvailableResponse;

      assert.equal(result.status, 'ok');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].schoolId, SCHOOL_A);
      assert.equal(calls[0].id, ROUTE_ID);
      assert.equal(calls[0].dto, dto);
    } finally {
      restore();
    }
  });
});
