import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { ConductorsController } from './conductors.controller';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { DriversController } from './drivers.controller';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { UpdateStaffDto } from './dto/update-staff.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A, userId = USER_ID) {
  const payload: JwtAccessTokenPayload = {
    sub: userId,
    school_id: role === UserRole.SUPER_ADMIN ? null : schoolId,
    role,
  };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

function makeContext(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  target: new (...args: unknown[]) => unknown,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => target,
  } as unknown as ExecutionContext;
}

async function activateGuards(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  target: new (...args: unknown[]) => unknown,
): Promise<void> {
  const context = makeContext(request, handler, target);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

// Inherited route handlers — the metadata lives on the abstract base class.
const createHandler = StaffController.prototype.create as unknown as (...args: never[]) => unknown;
const findOneHandler = StaffController.prototype.findOne as unknown as (
  ...args: never[]
) => unknown;
const removeHandler = StaffController.prototype.remove as unknown as (...args: never[]) => unknown;

describe('staff controllers authorization and tenant propagation', () => {
  it('restricts both staff resources to SCHOOL_ADMIN', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, StaffController), [UserRole.SCHOOL_ADMIN]);
    // Subclasses inherit the class-level role metadata through the prototype.
    for (const target of [DriversController, ConductorsController]) {
      assert.deepEqual(Reflect.getMetadata(ROLES_KEY, target), [UserRole.SCHOOL_ADMIN]);
    }
  });

  it('allows a school admin and rejects every other role on staff management', async () => {
    const adminRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
    };
    await activateGuards(adminRequest, createHandler, DriversController);
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
        activateGuards(request, createHandler, DriversController),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('applies the same restriction to the conductor resource', async () => {
    const conductorSelfRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.CONDUCTOR)}` },
    };
    await assert.rejects(
      activateGuards(conductorSelfRequest, createHandler, ConductorsController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );

    const driverRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.DRIVER)}` },
    };
    await assert.rejects(
      activateGuards(driverRequest, removeHandler, ConductorsController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );
  });

  it('rejects unauthenticated staff requests with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, createHandler, DriversController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
    await assert.rejects(
      activateGuards({ headers: {} }, findOneHandler, ConductorsController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('pins DRIVER on the drivers controller and passes only the JWT school id', async () => {
    const calls: Array<{ method: string; schoolId: string; role: UserRole; id?: string }> = [];
    const service = {
      create: async (schoolId: string, role: UserRole) => {
        calls.push({ method: 'create', schoolId, role });
        return { id: 'driver-1', role };
      },
      findAll: async (schoolId: string, role: UserRole) => {
        calls.push({ method: 'findAll', schoolId, role });
        return { items: [], meta: {} };
      },
      findOne: async (schoolId: string, role: UserRole, id: string) => {
        calls.push({ method: 'findOne', schoolId, role, id });
        return { id, role };
      },
      update: async (schoolId: string, role: UserRole, id: string) => {
        calls.push({ method: 'update', schoolId, role, id });
        return { id, role };
      },
      remove: async (schoolId: string, role: UserRole, id: string) => {
        calls.push({ method: 'remove', schoolId, role, id });
        return { id, message: 'deleted' };
      },
    } as unknown as StaffService;
    const controller = new DriversController(service);

    await controller.create(SCHOOL_A, new CreateStaffDto());
    await controller.findAll(SCHOOL_A, new ListStaffQueryDto());
    await controller.findOne(SCHOOL_A, USER_ID);
    await controller.update(SCHOOL_A, USER_ID, new UpdateStaffDto());
    await controller.remove(SCHOOL_A, USER_ID);

    assert.deepEqual(
      calls.map((call) => call.method),
      ['create', 'findAll', 'findOne', 'update', 'remove'],
    );
    assert.ok(calls.every((call) => call.schoolId === SCHOOL_A));
    assert.ok(calls.every((call) => call.role === UserRole.DRIVER));
    assert.deepEqual(
      calls.filter((call) => call.id).map((call) => call.id),
      [USER_ID, USER_ID, USER_ID],
    );
  });

  it('pins CONDUCTOR on the conductors controller even with another tenant in the JWT', async () => {
    const seen: Array<{ method: string; schoolId: string; role: UserRole }> = [];
    const service = {
      create: async (schoolId: string, role: UserRole) => {
        seen.push({ method: 'create', schoolId, role });
        return { id: 'conductor-1', role };
      },
      findAll: async (schoolId: string, role: UserRole) => {
        seen.push({ method: 'findAll', schoolId, role });
        return { items: [], meta: {} };
      },
      findOne: async (schoolId: string, role: UserRole) => {
        seen.push({ method: 'findOne', schoolId, role });
        return { id: 'conductor-1', role };
      },
      update: async (schoolId: string, role: UserRole) => {
        seen.push({ method: 'update', schoolId, role });
        return { id: 'conductor-1', role };
      },
      remove: async (schoolId: string, role: UserRole) => {
        seen.push({ method: 'remove', schoolId, role });
        return { id: 'conductor-1', message: 'deleted' };
      },
    } as unknown as StaffService;
    const controller = new ConductorsController(service);

    await controller.create(SCHOOL_B, new CreateStaffDto());
    await controller.findAll(SCHOOL_B, new ListStaffQueryDto());
    await controller.findOne(SCHOOL_B, USER_ID);
    await controller.update(SCHOOL_B, USER_ID, new UpdateStaffDto());
    await controller.remove(SCHOOL_B, USER_ID);

    assert.ok(seen.every((call) => call.schoolId === SCHOOL_B));
    assert.ok(seen.every((call) => call.role === UserRole.CONDUCTOR));
  });
});
