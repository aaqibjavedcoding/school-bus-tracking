import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { AuthTestController, ADMIN_ONLY_MESSAGE, STAFF_ONLY_MESSAGE } from './auth-test.controller';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());
const controller = new AuthTestController();

async function signAccessToken(role: UserRole): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: USER_ID, school_id: SCHOOL_ID, role };
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

/**
 * Builds an ExecutionContext pointing at the *real* controller handler, so
 * the guard chain resolves the actual `@Roles(...)` decorator metadata.
 */
function makeContext(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => AuthTestController,
  } as unknown as ExecutionContext;
}

/** Runs the guard chain exactly as declared on the endpoint. */
async function activateGuards(
  request: MockRequest,
  handler: (...args: never[]) => unknown,
  useRolesGuard: boolean,
): Promise<void> {
  const context = makeContext(request, handler);
  await jwtAuthGuard.canActivate(context);
  if (useRolesGuard) {
    rolesGuard.canActivate(context);
  }
}

const meHandler = AuthTestController.prototype.getMe as unknown as (...args: never[]) => unknown;
const adminOnlyHandler = AuthTestController.prototype.getAdminOnly as unknown as (
  ...args: never[]
) => unknown;
const staffOnlyHandler = AuthTestController.prototype.getStaffOnly as unknown as (
  ...args: never[]
) => unknown;

describe('AuthTestController (protected verification endpoints)', () => {
  describe('GET /auth-test/me — authentication only', () => {
    it('succeeds for an authenticated request and returns only non-sensitive claims', async () => {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
      };

      await activateGuards(request, meHandler, false);
      const response = controller.getMe(request.user as AuthenticatedRequestUser);

      assert.deepEqual(response.user, {
        id: USER_ID,
        school_id: SCHOOL_ID,
        role: UserRole.PARENT,
      });
      assert.deepEqual(
        Object.keys(response.user).sort(),
        ['id', 'role', 'school_id'],
        'no email, name, or credentials may be exposed',
      );
    });

    it('rejects a missing token with 401 before reaching the controller', async () => {
      const request: MockRequest = { headers: {} };
      await assert.rejects(
        activateGuards(request, meHandler, false),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects an invalid token with 401 before reaching the controller', async () => {
      const forgedToken = await new JwtService({ secret: 'wrong-secret' }).signAsync({
        sub: USER_ID,
        school_id: SCHOOL_ID,
        role: UserRole.SCHOOL_ADMIN,
      });
      const request: MockRequest = { headers: { authorization: `Bearer ${forgedToken}` } };

      await assert.rejects(
        activateGuards(request, meHandler, false),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });
  });

  describe('GET /auth-test/admin-only — SCHOOL_ADMIN role', () => {
    it('declares exactly the SCHOOL_ADMIN role in @Roles metadata', () => {
      const metadata = Reflect.getMetadata(ROLES_KEY, AuthTestController.prototype.getAdminOnly);
      assert.deepEqual(metadata, [UserRole.SCHOOL_ADMIN]);
    });

    it('succeeds for the allowed role', async () => {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
      };

      await activateGuards(request, adminOnlyHandler, true);
      const response = controller.getAdminOnly((request.user as AuthenticatedRequestUser).role);

      assert.deepEqual(response, { message: ADMIN_ONLY_MESSAGE, role: UserRole.SCHOOL_ADMIN });
    });

    it('rejects an authenticated user with a different role using 403', async () => {
      for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };

        await assert.rejects(
          activateGuards(request, adminOnlyHandler, true),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403);
            return true;
          },
        );
      }
    });
  });

  describe('GET /auth-test/staff-only — multi-role check', () => {
    it('declares the staff roles in @Roles metadata', () => {
      const metadata = Reflect.getMetadata(ROLES_KEY, AuthTestController.prototype.getStaffOnly);
      assert.deepEqual(metadata, [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR]);
    });

    it('succeeds for every staff role', async () => {
      for (const role of [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };

        await activateGuards(request, staffOnlyHandler, true);
        const response = controller.getStaffOnly((request.user as AuthenticatedRequestUser).role);
        assert.deepEqual(response, { message: STAFF_ONLY_MESSAGE, role });
      }
    });

    it('rejects the PARENT role with 403', async () => {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.PARENT)}` },
      };

      await assert.rejects(
        activateGuards(request, staffOnlyHandler, true),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    });
  });
});
