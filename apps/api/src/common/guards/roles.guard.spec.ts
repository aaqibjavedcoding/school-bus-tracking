import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { INSUFFICIENT_ROLE_MESSAGE, RolesGuard } from './roles.guard';
import type { AuthenticatedRequestUser } from './jwt-auth.guard';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Reflector stand-in serving fixed handler/class metadata so the guard's
 * resolution semantics are tested without a Nest application.
 */
class FakeReflector {
  constructor(
    private readonly handlerRoles: unknown,
    private readonly classRoles: unknown,
    public readonly targets: unknown[][] = [],
  ) {}

  getAllAndOverride(key: string, targets: [Type<unknown>, () => unknown]): unknown {
    assert.equal(key, ROLES_KEY);
    this.targets.push(targets);
    return this.handlerRoles ?? this.classRoles;
  }
}

function makeGuard(handlerRoles: unknown, classRoles: unknown = undefined): RolesGuard {
  const reflector = new FakeReflector(handlerRoles, classRoles) as unknown as Reflector;
  return new RolesGuard(reflector);
}

function makeContext(user?: AuthenticatedRequestUser): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function handler() {},
    getClass: () => class FakeController {},
  } as unknown as ExecutionContext;
}

function makeUser(role: UserRole): AuthenticatedRequestUser {
  return { id: '22222222-2222-4222-8222-222222222222', school_id: SCHOOL_ID, role };
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no @Roles metadata is present', () => {
    const guard = makeGuard(undefined, undefined);
    assert.equal(guard.canActivate(makeContext(makeUser(UserRole.PARENT))), true);
  });

  it('allows any authenticated user when @Roles metadata is empty', () => {
    const guard = makeGuard([], []);
    assert.equal(guard.canActivate(makeContext(makeUser(UserRole.PARENT))), true);
  });

  it('allows a user whose role is listed', () => {
    const guard = makeGuard([UserRole.SCHOOL_ADMIN, UserRole.DRIVER]);
    assert.equal(guard.canActivate(makeContext(makeUser(UserRole.DRIVER))), true);
  });

  it('rejects a user whose role is not listed with 403', () => {
    const guard = makeGuard([UserRole.SCHOOL_ADMIN]);
    assert.throws(
      () => guard.canActivate(makeContext(makeUser(UserRole.PARENT))),
      (error: { getStatus?: () => number; message: string }) => {
        assert.equal(error.getStatus?.(), 403);
        assert.equal(error.message, INSUFFICIENT_ROLE_MESSAGE);
        return true;
      },
    );
  });

  it('rejects every school role when only SUPER_ADMIN is allowed', () => {
    const guard = makeGuard([UserRole.SUPER_ADMIN]);
    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      assert.throws(
        () => guard.canActivate(makeContext(makeUser(role))),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects with 403 when no authenticated user is attached (defense in depth)', () => {
    const guard = makeGuard([UserRole.SCHOOL_ADMIN]);
    assert.throws(
      () => guard.canActivate(makeContext(undefined)),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 403);
        return true;
      },
    );
  });

  it('reads metadata with handler-level precedence over class-level', () => {
    const fakeReflector = new FakeReflector([UserRole.DRIVER], [UserRole.PARENT]);
    const guard = new RolesGuard(fakeReflector as unknown as Reflector);

    // Handler metadata (first entry) takes precedence: DRIVER passes.
    assert.equal(guard.canActivate(makeContext(makeUser(UserRole.DRIVER))), true);
    assert.equal(fakeReflector.targets.length, 1, 'metadata is resolved once per activation');
  });
});
