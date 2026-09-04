import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { JwtService, Reflector } from '../../framework';
import {
  JwtAccessTokenPayload,
  TripAttendanceStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { TripAttendanceController } from './trip-attendance.controller';
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

function makeContext(request: MockRequest, handler: (...args: never[]) => unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => TripAttendanceController,
  } as unknown as ExecutionContext;
}

async function activateGuards(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
): Promise<void> {
  const context = makeContext(request, handler);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const findAllHandler = TripAttendanceController.prototype.findAll as unknown as (
  ...args: never[]
) => unknown;
const findOneHandler = TripAttendanceController.prototype.findOne as unknown as (
  ...args: never[]
) => unknown;
const boardHandler = TripAttendanceController.prototype.board as unknown as (
  ...args: never[]
) => unknown;
const dropHandler = TripAttendanceController.prototype.drop as unknown as (
  ...args: never[]
) => unknown;

describe('TripAttendanceController authorization', () => {
  it('opens reading to the admin, the crew and parents', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, TripAttendanceController), [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]);
  });

  it('restricts boarding and dropping to the crew and the admin', () => {
    for (const handler of [boardHandler, dropHandler]) {
      assert.deepEqual(Reflect.getMetadata(ROLES_KEY, handler), [
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

    const controller = new TripAttendanceController(service);
    const actor: AuthenticatedRequestUser = {
      id: USER_ID,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
    };
    const query = Object.assign(new ListTripStudentsQueryDto(), {
      status: TripAttendanceStatus.PENDING,
    });

    await controller.findAll(actor, TRIP_ID, query);
    await controller.findOne(actor, TRIP_ID, STUDENT_ID);
    await controller.board(actor, TRIP_ID, STUDENT_ID);
    await controller.drop(actor, TRIP_ID, STUDENT_ID);

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
    // the JWT and the timestamp from the server clock. `3:<index>` is the
    // Nest metadata key for an `@Body()` parameter.
    for (const handler of ['findAll', 'findOne', 'board', 'drop']) {
      const routeArguments = Reflect.getMetadata(
        '__routeArguments__',
        TripAttendanceController,
        handler,
      ) as Record<string, unknown> | undefined;

      assert.ok(routeArguments, `${handler} must declare its route parameters`);
      assert.ok(
        Object.keys(routeArguments).every((key) => !key.startsWith('3:')),
        `${handler} must not accept a request body`,
      );
    }
  });
});
