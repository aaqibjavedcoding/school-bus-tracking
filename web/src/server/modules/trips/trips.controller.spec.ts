import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { CancelTripDto } from './dto/cancel-trip.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { ListTripsQueryDto } from './dto/list-trips-query.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = '33333333-3333-4333-8333-333333333333';
const ASSIGNMENT_ID = '44444444-4444-4444-8444-444444444444';
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
    getClass: () => TripsController,
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

const createHandler = TripsController.prototype.create as unknown as (...args: never[]) => unknown;
const findAllHandler = TripsController.prototype.findAll as unknown as (
  ...args: never[]
) => unknown;
const updateStatusHandler = TripsController.prototype.updateStatus as unknown as (
  ...args: never[]
) => unknown;

function tripDto(): CreateTripDto {
  const dto = new CreateTripDto();
  dto.route_assignment_id = ASSIGNMENT_ID;
  dto.scheduled_start_at = '2026-09-01T06:30:00.000Z';
  return dto;
}

describe('TripsController authorization', () => {
  it('restricts the controller to SCHOOL_ADMIN', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, TripsController), [UserRole.SCHOOL_ADMIN]);
  });

  it('allows an admin and rejects every other authenticated role on mutations', async () => {
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
        activateGuards(request, createHandler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('lets rostered crew and parents read trips, and crew apply status transitions', async () => {
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
    }

    for (const role of [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await activateGuards(request, updateStatusHandler);
      assert.equal(request.user?.role, role);
    }

    const parentRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
    };
    await assert.rejects(
      activateGuards(parentRequest, updateStatusHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );
  });

  it('rejects anonymous callers with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, findAllHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('passes only the JWT school id to every trip service call', async () => {
    const calls: Array<{ method: string; schoolId: string; id?: string; dto?: unknown }> = [];
    const actor: AuthenticatedRequestUser = {
      id: USER_ID,
      school_id: SCHOOL_B,
      role: UserRole.SCHOOL_ADMIN,
    };
    const service = {
      create: async (schoolId: string, dto: CreateTripDto) => {
        calls.push({ method: 'create', schoolId, dto });
        return { id: TRIP_ID };
      },
      findAllForActor: async (user: AuthenticatedRequestUser, query: ListTripsQueryDto) => {
        calls.push({ method: 'findAll', schoolId: user.school_id, dto: query });
        return { items: [], meta: {} };
      },
      findOneForActor: async (user: AuthenticatedRequestUser, id: string) => {
        calls.push({ method: 'findOne', schoolId: user.school_id, id });
        return { id };
      },
      update: async (schoolId: string, id: string, dto: UpdateTripDto) => {
        calls.push({ method: 'update', schoolId, id, dto });
        return { id };
      },
      updateStatusForActor: async (
        user: AuthenticatedRequestUser,
        id: string,
        dto: UpdateTripStatusDto,
      ) => {
        calls.push({ method: 'updateStatus', schoolId: user.school_id, id, dto });
        return { id };
      },
      cancel: async (schoolId: string, id: string, dto: CancelTripDto) => {
        calls.push({ method: 'cancel', schoolId, id, dto });
        return { id };
      },
      remove: async (schoolId: string, id: string) => {
        calls.push({ method: 'remove', schoolId, id });
        return { id, message: 'deleted' };
      },
    } as unknown as TripsService;
    const controller = new TripsController(service);

    const status = new UpdateTripStatusDto();
    status.status = TripStatus.IN_PROGRESS;

    await controller.create(SCHOOL_B, tripDto());
    await controller.findAll(actor, new ListTripsQueryDto());
    await controller.findOne(actor, TRIP_ID);
    await controller.update(SCHOOL_B, TRIP_ID, new UpdateTripDto());
    await controller.updateStatus(actor, TRIP_ID, status);
    await controller.cancel(SCHOOL_B, TRIP_ID, new CancelTripDto());
    await controller.remove(SCHOOL_B, TRIP_ID);

    assert.deepEqual(
      calls.map((call) => call.method),
      ['create', 'findAll', 'findOne', 'update', 'updateStatus', 'cancel', 'remove'],
    );
    assert.ok(calls.every((call) => call.schoolId === SCHOOL_B));
    assert.ok(
      calls.every((call) => !Object.prototype.hasOwnProperty.call(call.dto ?? {}, 'school_id')),
      'no handler may forward a client supplied tenant',
    );
  });
});
