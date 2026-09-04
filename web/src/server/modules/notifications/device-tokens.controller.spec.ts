import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  deleteNotificationsDevicesByToken,
  postNotificationsDevices,
} from '../../api/notifications';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { DeviceTokensService } from './device-tokens.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'device-controller-test-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(
  role: UserRole,
  schoolId: string | null = SCHOOL_A,
): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: USER_ID, school_id: schoolId, role };
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

/** Every tenant role that needs OS-level push. */
const ALLOWED_ROLES = [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT];

describe('DeviceTokensController authorization', () => {
  it('restricts the controller to every school role (parents AND crew)', () => {
    assert.deepEqual(postNotificationsDevices.roles, ALLOWED_ROLES);
  });

  it('allows every school role and rejects the platform SUPER_ADMIN', async () => {
    const handler = postNotificationsDevices as EndpointDefinition<never, never>;

    for (const role of ALLOWED_ROLES) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await activateGuards(request, handler);
      assert.equal(request.user?.role, role);
      assert.equal(request.user?.school_id, SCHOOL_A);
    }

    const platform: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN, null)}` },
    };
    await assert.rejects(
      () => activateGuards(platform, handler),
      (error: unknown) =>
        error instanceof Error && /Insufficient role permissions/.test(error.message),
    );
  });

  it('rejects an unauthenticated call with 401', async () => {
    const handler = postNotificationsDevices as EndpointDefinition<never, never>;

    const request: MockRequest = { headers: {} };

    await assert.rejects(() => activateGuards(request, handler));
    assert.equal(request.user, undefined);
  });

  it('delegates register and unregister with only the JWT-derived actor', async () => {
    const calls: string[] = [];
    const service = {
      register: async (actor: AuthenticatedRequestUser, dto: unknown) => {
        calls.push(`register:${JSON.stringify(dto)}`);
        return { id: 'device-1', token: (dto as { token: string }).token, actor };
      },
      unregister: async (actor: AuthenticatedRequestUser, token: string) => {
        calls.push(`unregister:${token}`);
        return { removed: true, actor };
      },
    } as unknown as DeviceTokensService;

    const restore = overrideContainer('deviceTokens', service);
    try {
      const actor: AuthenticatedRequestUser = {
        id: USER_ID,
        school_id: SCHOOL_A,
        role: UserRole.DRIVER,
      };

      const dto = { token: 'fcm-123', platform: 'android' as const };
      await callHandler(postNotificationsDevices, { user: actor, body: dto });
      await callHandler(deleteNotificationsDevicesByToken, {
        user: actor,
        params: { token: 'fcm-123' },
      });
    } finally {
      restore();
    }

    assert.deepEqual(calls, [
      'register:{"token":"fcm-123","platform":"android"}',
      'unregister:fcm-123',
    ]);
    // No client-supplied identity is ever forwarded.
    for (const call of calls) {
      assert.ok(!call.includes('school_id'));
      assert.ok(!call.includes('user_id'));
    }
  });
});
