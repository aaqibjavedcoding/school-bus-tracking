import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import {
  JwtAccessTokenPayload,
  TripAttendanceStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  getTripsByTripIdStudents,
  getTripsByTripIdStudentsByStudentId,
  postTripsByTripIdStudentsByStudentIdBoard,
  postTripsByTripIdStudentsByStudentIdDrop,
} from '../../api/trip-attendance';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { TripAttendanceService } from './trip-attendance.service';
import { ListTripStudentsQueryDto } from './dto/list-trip-students-query.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = 'unit-test-jwt-secret';

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

const findAllHandler = getTripsByTripIdStudents as EndpointDefinition<never, never>;
const findOneHandler = getTripsByTripIdStudentsByStudentId as EndpointDefinition<never, never>;
const boardHandler = postTripsByTripIdStudentsByStudentIdBoard as EndpointDefinition<never, never>;
const dropHandler = postTripsByTripIdStudentsByStudentIdDrop as EndpointDefinition<never, never>;

describe('TripAttendanceController authorization', () => {
  it('opens reading to the admin, the crew and parents', () => {
    assert.deepEqual(getTripsByTripIdStudents.roles, [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]);
  });

  it('restricts boarding and dropping to the crew and the admin', () => {
    for (const definition of [boardHandler, dropHandler]) {
      assert.deepEqual(definition.roles, [
        UserRole.SCHOOL_ADMIN,
        UserRole.DRIVER,
        UserRole.CONDUCTOR,
      ]);
    }
  });

  it('lets every allowed role read the manifest', async () => {
    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await activateGuards(request, findAllHandler);
      assert.equal(request.user?.role, role);
      assert.equal(request.user?.school_id, SCHOOL_A);
    }
  });

  it('rejects a parent that tries to board or drop with 403', async () => {
    for (const handler of [boardHandler, dropHandler]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
      };
      await assert.rejects(
        activateGuards(request, handler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects the platform SUPER_ADMIN on every tenant-scoped handler with 403', async () => {
    for (const handler of [findAllHandler, findOneHandler, boardHandler, dropHandler]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN)}` },
      };
      await assert.rejects(
        activateGuards(request, handler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects anonymous callers with 401', async () => {
    for (const handler of [findAllHandler, findOneHandler, boardHandler, dropHandler]) {
      await assert.rejects(
        activateGuards({ headers: {} }, handler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    }
  });
});

describe('TripAttendanceController delegation', () => {
  it('forwards only the JWT-derived actor and the path parameters', async () => {
    const calls: Array<{
      method: string;
      actor: AuthenticatedRequestUser;
      tripId: string;
      studentId?: string;
      query?: ListTripStudentsQueryDto;
    }> = [];

    const service = {
      getManifest: async (
        actor: AuthenticatedRequestUser,
        tripId: string,
        query: ListTripStudentsQueryDto,
      ) => {
        calls.push({ method: 'getManifest', actor, tripId, query });
        return { items: [] };
      },
      getStudent: async (actor: AuthenticatedRequestUser, tripId: string, studentId: string) => {
        calls.push({ method: 'getStudent', actor, tripId, studentId });
        return { student_id: studentId };
      },
      board: async (actor: AuthenticatedRequestUser, tripId: string, studentId: string) => {
        calls.push({ method: 'board', actor, tripId, studentId });
        return { status: TripAttendanceStatus.BOARDED };
      },
      drop: async (actor: AuthenticatedRequestUser, tripId: string, studentId: string) => {
        calls.push({ method: 'drop', actor, tripId, studentId });
        return { status: TripAttendanceStatus.DROPPED };
      },
    } as unknown as TripAttendanceService;

    const actor: AuthenticatedRequestUser = {
      id: USER_ID,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
    };
    const query = Object.assign(new ListTripStudentsQueryDto(), {
      status: TripAttendanceStatus.PENDING,
    });

    const restore = overrideContainer('tripAttendance', service);
    try {
      await callHandler(getTripsByTripIdStudents, {
        user: actor,
        params: { tripId: TRIP_ID },
        query,
      });
      await callHandler(getTripsByTripIdStudentsByStudentId, {
        user: actor,
        params: { tripId: TRIP_ID, studentId: STUDENT_ID },
      });
      await callHandler(postTripsByTripIdStudentsByStudentIdBoard, {
        user: actor,
        params: { tripId: TRIP_ID, studentId: STUDENT_ID },
      });
      await callHandler(postTripsByTripIdStudentsByStudentIdDrop, {
        user: actor,
        params: { tripId: TRIP_ID, studentId: STUDENT_ID },
      });
    } finally {
      restore();
    }

    assert.deepEqual(
      calls.map((call) => call.method),
      ['getManifest', 'getStudent', 'board', 'drop'],
    );
    for (const call of calls) {
      assert.equal(call.actor.school_id, SCHOOL_A);
      assert.equal(call.actor.id, USER_ID);
      assert.equal(call.tripId, TRIP_ID);
    }
    assert.equal(calls[0].query?.status, TripAttendanceStatus.PENDING);
    assert.deepEqual(
      calls.slice(1).map((call) => call.studentId),
      [STUDENT_ID, STUDENT_ID, STUDENT_ID],
    );
  });

  it('declares no request body on any handler', () => {
    // Board and drop are deliberately body-less: the acting user comes from
    // the JWT and the timestamp from the server clock. A definition without a
    // `bodyType` is the replacement for a handler without an `@Body()`
    // parameter — the runtime never parses or validates a body for it.
    for (const definition of [findAllHandler, findOneHandler, boardHandler, dropHandler]) {
      assert.equal(definition.bodyType, undefined);
    }
  });
});
