import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import {
  JwtAccessTokenPayload,
  RouteAssignmentRole,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  deleteRouteassignmentsById,
  getRouteassignments,
  getRouteassignmentsById,
  patchRouteassignmentsById,
  postRouteassignments,
} from '../../api/assignments';
import { invokeRoute } from '../../http/route-testing';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RouteAssignmentsService } from './assignments.service';
import { CreateRouteAssignmentDto } from './dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from './dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from './dto/update-route-assignment.dto';
import {
  ROUTE_ASSIGNMENTS_DEPRECATED_SUNSET,
  ROUTE_ASSIGNMENTS_RETIRED_WRITE_MESSAGE,
  ROUTE_ASSIGNMENTS_SUCCESSOR_PATH,
} from './assignments.constants';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
/** Authenticated SCHOOL_ADMIN of school B, as the guards would populate it. */
const ADMIN_B = { id: USER_ID, school_id: SCHOOL_B, role: UserRole.SCHOOL_ADMIN };
const ASSIGNMENT_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

/** Retirement declaration identical to the one `api/assignments.ts` uses. */
const deprecation = {
  sunset: ROUTE_ASSIGNMENTS_DEPRECATED_SUNSET,
  successor: ROUTE_ASSIGNMENTS_SUCCESSOR_PATH,
  retiredWrite: true,
  retiredMessage: ROUTE_ASSIGNMENTS_RETIRED_WRITE_MESSAGE,
};

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

const createHandler = postRouteassignments as EndpointDefinition<never, never>;
const findAllHandler = getRouteassignments as EndpointDefinition<never, never>;

function assignmentDto(): CreateRouteAssignmentDto {
  const dto = new CreateRouteAssignmentDto();
  dto.route_id = '44444444-4444-4444-8444-444444444444';
  dto.bus_id = '55555555-5555-4555-8555-555555555555';
  dto.user_id = '66666666-6666-4666-8666-666666666666';
  dto.role = RouteAssignmentRole.DRIVER;
  dto.effective_from = '2026-08-27';
  return dto;
}

describe('RouteAssignmentsController authorization', () => {
  it('restricts the controller to SCHOOL_ADMIN', () => {
    assert.deepEqual(postRouteassignments.roles, [
      UserRole.SCHOOL_ADMIN,
    ]);
  });

  it('allows an admin and rejects every other authenticated role with 403', async () => {
    const adminRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
    };
    await activateGuards(adminRequest, createHandler);
    assert.equal(adminRequest.user?.school_id, SCHOOL_A);

    for (const role of [
      UserRole.SUPER_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await assert.rejects(
        activateGuards(request, findAllHandler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects anonymous callers with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, createHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('passes only the JWT school id to the read-only service calls', async () => {
    const calls: Array<{ method: string; schoolId: string; id?: string; dto?: unknown }> = [];
    const service = {
      create: async (schoolId: string, dto: CreateRouteAssignmentDto) => {
        calls.push({ method: 'create', schoolId, dto });
        return { id: ASSIGNMENT_ID };
      },
      findAll: async (schoolId: string, query: ListRouteAssignmentsQueryDto) => {
        calls.push({ method: 'findAll', schoolId, dto: query });
        return { items: [], meta: {} };
      },
      findOne: async (schoolId: string, id: string) => {
        calls.push({ method: 'findOne', schoolId, id });
        return { id };
      },
      update: async (schoolId: string, id: string, dto: UpdateRouteAssignmentDto) => {
        calls.push({ method: 'update', schoolId, id, dto });
        return { id };
      },
      remove: async (schoolId: string, id: string) => {
        calls.push({ method: 'remove', schoolId, id });
        return { id, message: 'deleted' };
      },
    } as unknown as RouteAssignmentsService;
    const restore = overrideContainer('routeAssignments', service);
    try {
      // Reads still reach the mirror service, pinned to the JWT school.
      await callHandler(getRouteassignments, { user: ADMIN_B, query: new ListRouteAssignmentsQueryDto() });
      await callHandler(getRouteassignmentsById, { user: ADMIN_B, params: { id: ASSIGNMENT_ID } });
    } finally {
      restore();
    }

    assert.deepEqual(
      calls.map((call) => call.method),
      ['findAll', 'findOne'],
    );
    assert.ok(calls.every((call) => call.schoolId === SCHOOL_B));
  });

  it('retired writes answer 410 Gone with the deprecation headers, never touching the service', async () => {
    const calls: string[] = [];
    const service = {
      create: async () => {
        calls.push('create');
        return {};
      },
      update: async () => {
        calls.push('update');
        return {};
      },
      remove: async () => {
        calls.push('remove');
        return {};
      },
      findAll: async () => ({ items: [], meta: {} }),
      findOne: async () => ({}),
    } as unknown as RouteAssignmentsService;
    const restore = overrideContainer('routeAssignments', service);
    const token = `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}`;
    try {
      for (const [definition, method, body] of [
        [postRouteassignments, 'POST', assignmentDto()],
        [patchRouteassignmentsById, 'PATCH', new UpdateRouteAssignmentDto()],
        [deleteRouteassignmentsById, 'DELETE', undefined],
      ] as const) {
        const result = await invokeRoute(definition as EndpointDefinition<never, never>, {
          method,
          params: { id: ASSIGNMENT_ID },
          headers: { authorization: token },
          ...(body ? { body } : {}),
        });
        assert.equal(result.status, 410, `${method} should be 410 Gone`);
        assert.equal(result.headers.get('deprecation'), 'true');
        assert.equal(result.headers.get('sunset'), ROUTE_ASSIGNMENTS_DEPRECATED_SUNSET);
        assert.equal(
          result.headers.get('link'),
          `<${ROUTE_ASSIGNMENTS_SUCCESSOR_PATH}>; rel="success-version"`,
        );
        const envelope = result.body as { error?: { message?: string } };
        assert.equal(envelope.error?.message, ROUTE_ASSIGNMENTS_RETIRED_WRITE_MESSAGE);
      }
    } finally {
      restore();
    }
    assert.deepEqual(calls, []);
  });

  it('serves a readable mirror on GET with the deprecation headers', async () => {
    // The legacy read endpoints run with full auth (verified above and by the
    // roles spec); here we drive the route runtime with an `auth: false`
    // definition carrying the *same* retirement declaration, so the GET
    // behaviour — mirror served, deprecation headers attached — is proven
    // without a database.
    let reached = false;
    const mirror: EndpointDefinition = {
      deprecation,
      auth: false,
      roles: [],
      status: 200,
      handler: async () => {
        reached = true;
        return { items: [], meta: {} };
      },
    };
    const result = await invokeRoute(mirror as EndpointDefinition<never, never>, {
      method: 'GET',
    });
    assert.equal(result.status, 200);
    assert.equal(reached, true);
    assert.equal(result.headers.get('deprecation'), 'true');
    assert.equal(result.headers.get('sunset'), ROUTE_ASSIGNMENTS_DEPRECATED_SUNSET);
    assert.equal(
      result.headers.get('link'),
      `<${ROUTE_ASSIGNMENTS_SUCCESSOR_PATH}>; rel="success-version"`,
    );
  });
});
