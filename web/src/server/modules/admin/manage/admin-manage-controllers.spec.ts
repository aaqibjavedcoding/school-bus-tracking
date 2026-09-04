import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { JwtService, Reflector } from '../../../framework';
import { makeGuardContext } from '../../../http/route-testing';
import type { EndpointDefinition } from '../../../http/route-runtime';
import * as manage from '../../../api/admin-manage';
import { ManagedSchoolGuard } from './managed-school.guard';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const schoolAccess = { isSchoolAccessible: async () => true, isUserActive: async () => true };
const jwtAuthGuard = new JwtAuthGuard(jwtService, schoolAccess as never);
const rolesGuard = new RolesGuard(new Reflector());

/**
 * Managed-school repository stub: every known school is active unless the
 * test marks it inactive.
 */
function schoolLookupStub(active = true) {
  return {
    unscoped: () => ({
      findOne: async ({ where }: { where: { id: string } }) =>
        where.id === SCHOOL_ID
          ? { id: SCHOOL_ID, name: 'ABC School', code: 'ABC', is_active: active }
          : null,
    }),
  };
}

async function signAccessToken(role: UserRole, schoolId: string | null): Promise<string> {
  return jwtService.signAsync({ sub: USER_ID, school_id: schoolId, role });
}

interface MockRequest {
  headers: Record<string, unknown>;
  method?: string;
  params?: Record<string, string>;
  user?: { id: string; school_id: string | null; role: UserRole };
  managedSchool?: unknown;
}

function makeContext(request: MockRequest, definition: EndpointDefinition<never, never>) {
  return makeGuardContext(definition, request as unknown as Record<string, unknown>);
}

/**
 * Every endpoint of the assisted-management surface.
 *
 * The Nest version enumerated thirteen controllers and their methods; the
 * definitions are exported from one module, so the whole surface is collected
 * from its exports — which also means a newly added endpoint is covered
 * automatically instead of silently escaping these checks.
 */
const MANAGE_ENDPOINTS: Array<{ name: string; definition: EndpointDefinition<never, never> }> =
  Object.entries(manage)
    .filter(
      (entry): entry is [string, EndpointDefinition<never, never>] =>
        typeof entry[1] === 'object' && entry[1] !== null && 'handler' in entry[1],
    )
    .map(([name, definition]) => ({ name, definition }));

const studentsFindAll =
  manage.getAdminSchoolsBySchoolIdManageStudents as EndpointDefinition<never, never>;
const studentsCreate =
  manage.postAdminSchoolsBySchoolIdManageStudents as EndpointDefinition<never, never>;
const sessionStart =
  manage.postAdminSchoolsBySchoolIdManageSession as EndpointDefinition<never, never>;

describe('assisted management endpoint surface', () => {
  const reflector = new Reflector();

  it('covers the whole assisted-management surface', () => {
    // Sanity check on the reflection above: the thirteen former controllers
    // contributed 67 endpoints between them.
    assert.equal(MANAGE_ENDPOINTS.length, 67);
  });

  it('declares the SUPER_ADMIN-only role on every handler', () => {
    for (const { name, definition } of MANAGE_ENDPOINTS) {
      assert.deepEqual(
        definition.roles,
        [UserRole.SUPER_ADMIN],
        `${name} must be SUPER_ADMIN-only`,
      );
    }
  });

  it('routes every endpoint through the managed-school guard', () => {
    // What `@UseGuards(..., ManagedSchoolGuard)` on each controller used to
    // express: the school always comes from the verified route parameter.
    for (const { name, definition } of MANAGE_ENDPOINTS) {
      assert.equal(definition.managedSchool, true, `${name} must resolve the managed school`);
    }
  });

  it('exposes the roles to the guard chain as metadata', () => {
    const context = makeContext({ headers: {} }, studentsFindAll);
    const roles = reflector.getAllAndOverride<UserRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    assert.deepEqual(roles, [UserRole.SUPER_ADMIN]);
  });

  it('rejects a SCHOOL_ADMIN token with 403 before the managed-school guard runs', async () => {
    const request: MockRequest = {
      headers: {
        authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN, SCHOOL_ID)}`,
      },
      method: 'GET',
      params: { schoolId: SCHOOL_ID },
      user: { id: USER_ID, school_id: SCHOOL_ID, role: UserRole.SCHOOL_ADMIN },
    };
    const context = makeContext(request, studentsFindAll);

    // Authentication passes (the school admin is a valid user), but the role
    // check must refuse the assisted surface.
    assert.equal(await jwtAuthGuard.canActivate(context), true);
    assert.throws(
      () => rolesGuard.canActivate(context),
      (error: { status?: number }) => {
        assert.equal(error.status, 403);
        return true;
      },
    );
    // ManagedSchoolGuard was never reached: no school was attached, and the
    // actor identity was never swapped.
    assert.equal(request.managedSchool, undefined);
    assert.deepEqual(request.user, {
      id: USER_ID,
      school_id: SCHOOL_ID,
      role: UserRole.SCHOOL_ADMIN,
    });
  });

  it('runs the full guard chain for a SUPER_ADMIN token and attaches the managed school', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN, null)}` },
      method: 'GET',
      params: { schoolId: SCHOOL_ID },
      user: { id: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN },
    };
    const context = makeContext(request, studentsFindAll);

    assert.equal(await jwtAuthGuard.canActivate(context), true);
    assert.equal(rolesGuard.canActivate(context), true);
    const guard = new ManagedSchoolGuard(reflector, schoolLookupStub(true) as never);
    assert.equal(await guard.canActivate(context), true);
    assert.deepEqual(request.managedSchool, {
      id: SCHOOL_ID,
      name: 'ABC School',
      code: 'ABC',
      is_active: true,
    });
    // The actor identity is untouched — still the platform Super Admin.
    assert.deepEqual(request.user, { id: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN });
  });
});

describe('ManagedSchoolGuard', () => {
  const reflector = new Reflector();

  function requestFor(method: string, schoolId = SCHOOL_ID): MockRequest {
    return {
      headers: {},
      method,
      params: { schoolId },
      user: { id: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN },
    };
  }

  it('404s for an unknown or non-UUID school id', async () => {
    const guard = new ManagedSchoolGuard(reflector, schoolLookupStub(true) as never);

    const unknown = makeContext(
      requestFor('GET', '99999999-1111-4111-8111-111111111111'),
      studentsFindAll,
    );
    await assert.rejects(
      guard.canActivate(unknown),
      (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 404);
        assert.match(String(error.message), /not found/i);
        return true;
      },
    );

    const malformed = makeContext(requestFor('GET', 'not-a-uuid'), studentsFindAll);
    await assert.rejects(guard.canActivate(malformed), (error: { status?: number }) => {
      assert.equal(error.status, 400);
      return true;
    });
  });

  it('allows reads on a deactivated school but blocks mutations', async () => {
    const guard = new ManagedSchoolGuard(reflector, schoolLookupStub(false) as never);

    const readRequest = requestFor('GET');
    assert.equal(await guard.canActivate(makeContext(readRequest, studentsFindAll)), true);
    assert.equal((readRequest.managedSchool as { is_active: boolean }).is_active, false);

    const write = makeContext(requestFor('POST'), studentsCreate);
    await assert.rejects(
      guard.canActivate(write),
      (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 403);
        assert.match(String(error.message), /deactivated/i);
        return true;
      },
    );
  });

  it('permits session lifecycle handlers on a deactivated school (opt-in metadata)', async () => {
    const guard = new ManagedSchoolGuard(reflector, schoolLookupStub(false) as never);
    // The session definitions carry `allowWhenInactive`, which the runtime
    // publishes as the same opt-in metadata the decorator used to set.
    const context = makeContext(requestFor('POST'), sessionStart);
    assert.equal(await guard.canActivate(context), true);
  });
});
