import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@school-bus-tracking/shared-types';
import {
  AuthenticatedRequestUser,
  INVALID_AUTH_TOKEN_MESSAGE,
  JwtAuthGuard,
  MISSING_AUTH_TOKEN_MESSAGE,
} from './jwt-auth.guard';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

/** Real signing/verification — the guard must hold against actual JWTs. */
const jwtService = new JwtService({ secret: SECRET });
const guard = new JwtAuthGuard(jwtService);

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

function makeContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

async function signToken(payload: Record<string, unknown>, options: object = {}): Promise<string> {
  return jwtService.signAsync(payload, options);
}

describe('JwtAuthGuard', () => {
  describe('token extraction / authentication', () => {
    it('rejects a request without an Authorization header with 401', async () => {
      const request: MockRequest = { headers: {} };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number; message: string }) => {
          assert.equal(error.getStatus?.(), 401);
          assert.equal(error.message, MISSING_AUTH_TOKEN_MESSAGE);
          return true;
        },
      );
      assert.equal(request.user, undefined, 'no user must be attached on failure');
    });

    it('rejects a non-Bearer authorization scheme with 401', async () => {
      const request: MockRequest = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects an empty Bearer scheme with 401', async () => {
      const request: MockRequest = { headers: { authorization: 'Bearer' } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects a Bearer token with trailing segments with 401', async () => {
      const request: MockRequest = { headers: { authorization: 'Bearer token extra-segment' } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects a malformed (non-JWT) token with 401', async () => {
      const request: MockRequest = { headers: { authorization: 'Bearer not-a-jwt-token' } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number; message: string }) => {
          assert.equal(error.getStatus?.(), 401);
          assert.equal(error.message, INVALID_AUTH_TOKEN_MESSAGE);
          return true;
        },
      );
    });

    it('rejects a token signed with a different secret with 401', async () => {
      const attackerToken = await new JwtService({ secret: 'attacker-secret' }).signAsync({
        sub: USER_ID,
        school_id: SCHOOL_ID,
        role: UserRole.SCHOOL_ADMIN,
      });
      const request: MockRequest = { headers: { authorization: `Bearer ${attackerToken}` } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects an expired token with 401', async () => {
      const expiredToken = await signToken(
        { sub: USER_ID, school_id: SCHOOL_ID, role: UserRole.PARENT },
        { expiresIn: -60 },
      );
      const request: MockRequest = { headers: { authorization: `Bearer ${expiredToken}` } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('accepts a lowercase bearer scheme per RFC 7235', async () => {
      const token = await signToken({
        sub: USER_ID,
        school_id: SCHOOL_ID,
        role: UserRole.DRIVER,
      });
      const request: MockRequest = { headers: { authorization: `bearer ${token}` } };
      assert.equal(await guard.canActivate(makeContext(request)), true);
    });
  });

  describe('payload validation', () => {
    it('rejects a signed token missing school_id with 401', async () => {
      const token = await signToken({ sub: USER_ID, role: UserRole.PARENT });
      const request: MockRequest = { headers: { authorization: `Bearer ${token}` } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects a signed token missing sub with 401', async () => {
      const token = await signToken({ school_id: SCHOOL_ID, role: UserRole.PARENT });
      const request: MockRequest = { headers: { authorization: `Bearer ${token}` } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });

    it('rejects a signed token carrying an unrecognized role with 401', async () => {
      const token = await signToken({
        sub: USER_ID,
        school_id: SCHOOL_ID,
        role: 'SUPER_HACKER',
      });
      const request: MockRequest = { headers: { authorization: `Bearer ${token}` } };
      await assert.rejects(
        guard.canActivate(makeContext(request)),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401);
          return true;
        },
      );
    });
  });

  describe('valid tokens', () => {
    it('authenticates and attaches only the token claims to request.user', async () => {
      for (const role of [
        UserRole.SCHOOL_ADMIN,
        UserRole.DRIVER,
        UserRole.CONDUCTOR,
        UserRole.PARENT,
      ]) {
        const token = await signToken({ sub: USER_ID, school_id: SCHOOL_ID, role });
        const request: MockRequest = { headers: { authorization: `Bearer ${token}` } };

        assert.equal(await guard.canActivate(makeContext(request)), true);
        assert.deepEqual(request.user, { id: USER_ID, school_id: SCHOOL_ID, role });
        assert.deepEqual(Object.keys(request.user ?? {}).sort(), ['id', 'role', 'school_id']);
      }
    });
  });
});
