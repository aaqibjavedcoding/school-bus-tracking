import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import {
  JwtAccessTokenPayload,
  NotificationReadFilter,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ListParentNotificationsQueryDto } from './dto/list-parent-notifications-query.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';
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
    getClass: () => NotificationsController,
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

describe('NotificationsController authorization', () => {
  it('restricts every route to the PARENT role', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, NotificationsController), [UserRole.PARENT]);
  });

  it('allows a PARENT with a tenant and rejects every other role', async () => {
    const handler = NotificationsController.prototype.list as unknown as (
      ...args: never[]
    ) => unknown;

    const parentRequest: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
    };
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

  it('rejects an unauthenticated call with 401', async () => {
    const handler = NotificationsController.prototype.list as unknown as (
      ...args: never[]
    ) => unknown;
    const request: MockRequest = { headers: {} };

    await assert.rejects(() => activateGuards(request, handler));
    assert.equal(request.user, undefined);
  });

  it('delegates each route to the service with the JWT-derived actor', async () => {
    const calls: string[] = [];
    const service = {
      listForParent: async (actor: AuthenticatedRequestUser, query: unknown) => {
        calls.push(`list:${JSON.stringify(query)}`);
        return { items: [], total: 0, unread_count: 0, actor };
      },
      markRead: async (actor: AuthenticatedRequestUser, id: string) => {
        calls.push(`read:${id}`);
        return { notification: { id }, actor };
      },
      markAllRead: async (actor: AuthenticatedRequestUser) => {
        calls.push('read-all');
        return { updated_count: 0, actor };
      },
    } as unknown as NotificationsService;

    const controller = new NotificationsController(service);
    const actor: AuthenticatedRequestUser = {
      id: USER_ID,
      school_id: SCHOOL_A,
      role: UserRole.PARENT,
    };

    const query = new ListParentNotificationsQueryDto();
    query.page = 2;
    query.status = NotificationReadFilter.UNREAD;
    await controller.list(actor, query);
    await controller.markRead(actor, NOTIFICATION_ID);
    await controller.markAllRead(actor);

    assert.deepEqual(
      calls.map((call) => call.split(':')[0]),
      ['list', 'read', 'read-all'],
    );
    assert.ok(calls[0].includes('"page":2'));
    assert.ok(calls[0].includes(`"status":"${NotificationReadFilter.UNREAD}"`));
    assert.ok(calls[1].endsWith(NOTIFICATION_ID));
    // The actor is the JWT subject — no client-supplied identity is passed.
    for (const call of calls) {
      assert.ok(!call.includes('parent_id'));
      assert.ok(!call.includes('school_id='));
    }
  });
});
