import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import {
  AuthenticatedRequestUser,
  JwtAuthGuard,
  RolesGuard,
  isAccessTokenPayloadValid,
} from '../guards';
import { SCHOOL_INACTIVE_MESSAGE, SchoolAccessService } from './school-access.service';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';
const jwtService = new JwtService({ secret: SECRET });

async function signToken(payload: JwtAccessTokenPayload): Promise<string> {
  return jwtService.signAsync(payload);
}

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

function makeContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (() => undefined) as unknown,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('isAccessTokenPayloadValid (platform claims)', () => {
  it('accepts a SUPER_ADMIN payload with a null school_id', () => {
    assert.equal(
      isAccessTokenPayloadValid({ sub: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN }),
      true,
    );
  });

  it('rejects a SUPER_ADMIN payload that carries a school claim', () => {
    assert.equal(
      isAccessTokenPayloadValid({ sub: USER_ID, school_id: SCHOOL_ID, role: UserRole.SUPER_ADMIN }),
      false,
    );
  });

  it('rejects a school-role payload with a null school_id', () => {
    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      assert.equal(isAccessTokenPayloadValid({ sub: USER_ID, school_id: null, role }), false);
    }
  });

  it('accepts a school-role payload with a real school_id', () => {
    assert.equal(
      isAccessTokenPayloadValid({ sub: USER_ID, school_id: SCHOOL_ID, role: UserRole.DRIVER }),
      true,
    );
  });
});

describe('JwtAuthGuard inactive-school enforcement', () => {
  it('blocks a school user token with 403 "School is inactive" once the tenant is deactivated', async () => {
    const active = new Set<string>([SCHOOL_ID]);
    const schoolAccess = {
      isSchoolAccessible: async (schoolId: string | null | undefined) =>
        schoolId === null || active.has(schoolId ?? ''),
    } as unknown as SchoolAccessService;
    const guard = new JwtAuthGuard(jwtService, schoolAccess);

    const driverToken = await signToken({
      sub: USER_ID,
      school_id: SCHOOL_ID,
      role: UserRole.DRIVER,
    });

    // Active tenant: passes.
    const okRequest: MockRequest = { headers: { authorization: `Bearer ${driverToken}` } };
    assert.equal(await guard.canActivate(makeContext(okRequest)), true);

    // Tenant deactivated: 403 with the generic business error.
    active.delete(SCHOOL_ID);
    const blockedRequest: MockRequest = { headers: { authorization: `Bearer ${driverToken}` } };
    await assert.rejects(
      guard.canActivate(makeContext(blockedRequest)),
      (error: { getStatus?: () => number; message?: string }) => {
        assert.equal(error.getStatus?.(), 403);
        assert.equal(error.message, SCHOOL_INACTIVE_MESSAGE);
        return true;
      },
    );
  });

  it('always lets the SUPER_ADMIN through, even for an inactive school', async () => {
    const schoolAccess = {
      isSchoolAccessible: async () => false,
    } as unknown as SchoolAccessService;
    const guard = new JwtAuthGuard(jwtService, schoolAccess);

    const adminToken = await signToken({
      sub: USER_ID,
      school_id: null,
      role: UserRole.SUPER_ADMIN,
    });
    const request: MockRequest = { headers: { authorization: `Bearer ${adminToken}` } };
    assert.equal(await guard.canActivate(makeContext(request)), true);
  });
});

describe('RolesGuard matrix for the platform surface', () => {
  function roleContext(request: MockRequest): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => (() => undefined) as unknown,
      getClass: () => class TestController {},
    } as unknown as ExecutionContext;
  }

  it('grants a route decorated with SUPER_ADMIN only to the platform role', () => {
    // The reflector reports the roles the route was decorated with.
    const stubReflector = {
      getAllAndOverride: () => [UserRole.SUPER_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(stubReflector);

    const schoolAdminRequest = {
      headers: {},
      user: { id: USER_ID, school_id: SCHOOL_ID, role: UserRole.SCHOOL_ADMIN },
    } as MockRequest;
    assert.throws(
      () => guard.canActivate(roleContext(schoolAdminRequest)),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
    );

    const superAdminRequest = {
      headers: {},
      user: { id: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN },
    } as MockRequest;
    assert.equal(guard.canActivate(roleContext(superAdminRequest)), true);
  });
});
