import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  deleteConductorsById,
  deleteDriversById,
  getConductors,
  getConductorsById,
  getDrivers,
  getDriversById,
  patchConductorsById,
  patchDriversById,
  postConductors,
  postDrivers,
} from '../../api/staff';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { StaffService } from './staff.service';
import { UpdateStaffDto } from './dto/update-staff.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

/** Authenticated SCHOOL_ADMIN actors, as the guards would populate them. */
const ADMIN_A = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };
const ADMIN_B = { id: USER_ID, school_id: SCHOOL_B, role: UserRole.SCHOOL_ADMIN };

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

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

// Endpoints that were inherited from the abstract `StaffController`; the
// generated definitions carry the base class's guard metadata directly.
const createHandler = postDrivers as EndpointDefinition<never, never>;
const findOneHandler = getConductorsById as EndpointDefinition<never, never>;
const removeHandler = deleteConductorsById as EndpointDefinition<never, never>;
const conductorCreateHandler = postConductors as EndpointDefinition<never, never>;

describe('staff endpoints authorization and tenant propagation', () => {
  it('restricts both staff resources to SCHOOL_ADMIN', () => {
    // The abstract base declared @Roles once; every generated subclass
    // endpoint carries the same restriction.
    for (const definition of [
      postDrivers,
      getDrivers,
      getDriversById,
      patchDriversById,
      deleteDriversById,
      postConductors,
      getConductors,
      getConductorsById,
      patchConductorsById,
      deleteConductorsById,
    ]) {
      assert.deepEqual(definition.roles, [UserRole.SCHOOL_ADMIN]);
    }
  });

  it('allows a school admin and rejects every other role on staff management', async () => {
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

  it('applies the same restriction to the conductor resource', async () => {
    const conductorSelfRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.CONDUCTOR)}` },
    };
    await assert.rejects(
      activateGuards(conductorSelfRequest, conductorCreateHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );

    const driverRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.DRIVER)}` },
    };
    await assert.rejects(
      activateGuards(driverRequest, removeHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );
  });

  it('rejects unauthenticated staff requests with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, createHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
    await assert.rejects(
      activateGuards({ headers: {} }, findOneHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('pins DRIVER on the drivers endpoints and passes only the JWT school id', async () => {
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

    const restore = overrideContainer('staff', service);
    try {
      await callHandler(postDrivers, { user: ADMIN_A, body: new CreateStaffDto() });
      await callHandler(getDrivers, { user: ADMIN_A, query: new ListStaffQueryDto() });
      await callHandler(getDriversById, { user: ADMIN_A, params: { driverId: USER_ID } });
      await callHandler(patchDriversById, {
        user: ADMIN_A,
        params: { driverId: USER_ID },
        body: new UpdateStaffDto(),
      });
      await callHandler(deleteDriversById, { user: ADMIN_A, params: { driverId: USER_ID } });
    } finally {
      restore();
    }

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

  it('pins CONDUCTOR on the conductor endpoints even with another tenant in the JWT', async () => {
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

    const restore = overrideContainer('staff', service);
    try {
      await callHandler(postConductors, { user: ADMIN_B, body: new CreateStaffDto() });
      await callHandler(getConductors, { user: ADMIN_B, query: new ListStaffQueryDto() });
      await callHandler(getConductorsById, { user: ADMIN_B, params: { id: USER_ID } });
      await callHandler(patchConductorsById, {
        user: ADMIN_B,
        params: { id: USER_ID },
        body: new UpdateStaffDto(),
      });
      await callHandler(deleteConductorsById, { user: ADMIN_B, params: { id: USER_ID } });
    } finally {
      restore();
    }

    // The role is pinned by the route, never taken from the request: a
    // conductors endpoint can only ever write CONDUCTOR rows.
    assert.ok(seen.every((call) => call.role === UserRole.CONDUCTOR));
    assert.ok(seen.every((call) => call.schoolId === SCHOOL_B));
  });
});
