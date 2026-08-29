import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
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
    getClass: () => ParentPortalController,
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

describe('ParentPortalController authorization', () => {
  it('restricts every route to the PARENT role', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ParentPortalController), [UserRole.PARENT]);
  });

  it('allows a PARENT with a tenant and rejects other roles', async () => {
    const parentRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
    };
    const handler = ParentPortalController.prototype.listChildren as unknown as (
      ...args: never[]
    ) => unknown;
    await activateGuards(parentRequest, handler);
    assert.equal(parentRequest.user?.role, UserRole.PARENT);
    assert.equal(parentRequest.user?.school_id, SCHOOL_A);

    for (const role of [
      UserRole.SUPER_ADMIN,
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await assert.rejects(
        () => activateGuards(request, handler),
        (error: unknown) =>
          error instanceof Error && /Insufficient role permissions/.test(error.message),
      );
    }
  });

  it('delegates each route to the service with the JWT-derived actor', async () => {
    const calls: string[] = [];
    const service = {
      getDashboard: async () => {
        calls.push('dashboard');
        return { parent: {}, school: null, children: [], count: 0 };
      },
      listChildren: async () => {
        calls.push('children');
        return { items: [], count: 0 };
      },
      getChild: async () => {
        calls.push('child');
        return {};
      },
      getChildToday: async () => {
        calls.push('today');
        return { child: {}, driver: null, conductor: null, stops: [] };
      },
      getChildTracking: async () => {
        calls.push('tracking');
        return { child: {}, trip: null, driver: null, conductor: null, stops: [], latest: null };
      },
    } as unknown as ParentPortalService;

    const controller = new ParentPortalController(service);
    const actor: AuthenticatedRequestUser = {
      id: USER_ID,
      school_id: SCHOOL_A,
      role: UserRole.PARENT,
    };

    await controller.getDashboard(actor);
    await controller.listChildren(actor);
    await controller.getChild(actor, STUDENT_ID);
    await controller.getChildToday(actor, STUDENT_ID);
    await controller.getChildTracking(actor, STUDENT_ID);

    assert.deepEqual(calls, ['dashboard', 'children', 'child', 'today', 'tracking']);
  });
});
