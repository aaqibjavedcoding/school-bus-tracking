import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminSchoolAdminsController } from './admin-school-admins.controller';
import { AdminSchoolsController } from './admin-schools.controller';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
// The access service stub always reports the tenant as active; the inactive
// path is covered by the dedicated guard suite.
const schoolAccess = { isSchoolAccessible: async () => true };
const jwtAuthGuard = new JwtAuthGuard(jwtService, schoolAccess as never);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId: string | null): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: USER_ID, school_id: schoolId, role };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

function makeContext(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  controller: object,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller.constructor,
  } as unknown as ExecutionContext;
}

async function activateGuards(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  controller: object,
): Promise<void> {
  const context = makeContext(request, handler, controller);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

function controllerFor(controllerClass: new (...args: never[]) => unknown, methods: string[]) {
  return methods.map((method) => ({
    method,
    handler: (controllerClass.prototype as Record<string, (...args: never[]) => unknown>)[method],
  }));
}

const SCHOOL_ID_PARAM = SCHOOL_ID;

describe('Admin controllers authorization', () => {
  const dashboardController = {} as AdminDashboardController;
  const schoolsController = {} as AdminSchoolsController;
  const adminsController = {} as AdminSchoolAdminsController;

  const protectedHandlers: Array<{
    method: string;
    handler: (...args: never[]) => unknown;
    controller: object;
  }> = [
    ...controllerFor(AdminDashboardController, ['getDashboard']).map((h) => ({
      ...h,
      controller: dashboardController,
    })),
    ...controllerFor(AdminSchoolsController, [
      'create',
      'findAll',
      'findOne',
      'update',
      'activate',
      'deactivate',
    ]).map((h) => ({ ...h, controller: schoolsController })),
    ...controllerFor(AdminSchoolAdminsController, [
      'list',
      'create',
      'update',
      'activate',
      'deactivate',
      'resetPassword',
    ]).map((h) => ({ ...h, controller: adminsController })),
  ];

  it('restricts every admin route to the SUPER_ADMIN role', () => {
    for (const { handler, method } of protectedHandlers) {
      const metadata = Reflect.getMetadata(ROLES_KEY, handler);
      assert.deepEqual(metadata, [UserRole.SUPER_ADMIN], `${method} must require SUPER_ADMIN`);
    }
  });

  it('allows a SUPER_ADMIN (platform, no school claim) through both guards', async () => {
    for (const { handler, method, controller } of protectedHandlers) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN, null)}` },
      };
      await activateGuards(request, handler, controller);
      assert.equal((request.user as AuthenticatedRequestUser).role, UserRole.SUPER_ADMIN, method);
      assert.equal((request.user as AuthenticatedRequestUser).school_id, null, method);
    }
  });

  it('rejects every school role with 403 on every admin route', async () => {
    const schoolRoles = [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ];
    for (const role of schoolRoles) {
      for (const { handler, method } of protectedHandlers) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role, SCHOOL_ID_PARAM)}` },
        };
        await assert.rejects(
          activateGuards(request, handler, schoolsController),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403, `${role} ${method} must be 403`);
            return true;
          },
        );
      }
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    const request: MockRequest = { headers: {} };
    const handler = AdminDashboardController.prototype.getDashboard as unknown as (
      ...args: never[]
    ) => unknown;
    await assert.rejects(
      activateGuards(request, handler, dashboardController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('rejects a SUPER_ADMIN token that carries a school claim (malformed platform token)', async () => {
    const token = await signAccessToken(UserRole.SUPER_ADMIN, SCHOOL_ID_PARAM);
    const request: MockRequest = { headers: { authorization: `Bearer ${token}` } };
    const handler = AdminSchoolsController.prototype.findAll as unknown as (
      ...args: never[]
    ) => unknown;
    await assert.rejects(
      activateGuards(request, handler, schoolsController),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });
});
