import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import {
  getAdminDashboard,
  getAdminPlans,
  getAdminPlansById,
  getAdminSchools,
  getAdminSchoolsById,
  getAdminSchoolsByIdAdmins,
  getAdminSchoolsBySchoolIdSubscription,
  getAdminSubscriptions,
  patchAdminPlansById,
  patchAdminSchoolsById,
  patchAdminSchoolsByIdAdminsByAdminId,
  patchAdminSchoolsBySchoolIdSubscription,
  postAdminPlans,
  postAdminPlansByIdActivate,
  postAdminPlansByIdDeactivate,
  postAdminSchools,
  postAdminSchoolsByIdActivate,
  postAdminSchoolsByIdAdmins,
  postAdminSchoolsByIdAdminsByAdminIdActivate,
  postAdminSchoolsByIdAdminsByAdminIdDeactivate,
  postAdminSchoolsByIdAdminsByAdminIdResetpassword,
  postAdminSchoolsByIdDeactivate,
  postAdminSchoolsBySchoolIdSubscription,
  postAdminSchoolsBySchoolIdSubscriptionCancel,
} from '../../api/admin';

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

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const SCHOOL_ID_PARAM = SCHOOL_ID;

describe('Admin endpoints authorization', () => {
  /**
   * Every endpoint that used to live on one of the six admin controllers.
   * The controller-level `@Roles(SUPER_ADMIN)` is now declared per definition,
   * so the whole surface is enumerated explicitly here.
   */
  const protectedHandlers: Array<{
    method: string;
    definition: EndpointDefinition<never, never>;
  }> = (
    [
      ['dashboard.getDashboard', getAdminDashboard],
      ['schools.create', postAdminSchools],
      ['schools.findAll', getAdminSchools],
      ['schools.findOne', getAdminSchoolsById],
      ['schools.update', patchAdminSchoolsById],
      ['schools.activate', postAdminSchoolsByIdActivate],
      ['schools.deactivate', postAdminSchoolsByIdDeactivate],
      ['admins.list', getAdminSchoolsByIdAdmins],
      ['admins.create', postAdminSchoolsByIdAdmins],
      ['admins.update', patchAdminSchoolsByIdAdminsByAdminId],
      ['admins.activate', postAdminSchoolsByIdAdminsByAdminIdActivate],
      ['admins.deactivate', postAdminSchoolsByIdAdminsByAdminIdDeactivate],
      ['admins.resetPassword', postAdminSchoolsByIdAdminsByAdminIdResetpassword],
      ['plans.create', postAdminPlans],
      ['plans.findAll', getAdminPlans],
      ['plans.findOne', getAdminPlansById],
      ['plans.update', patchAdminPlansById],
      ['plans.activate', postAdminPlansByIdActivate],
      ['plans.deactivate', postAdminPlansByIdDeactivate],
      // Task 42 — school subscription management is SUPER_ADMIN only as well.
      ['subscriptions.get', getAdminSchoolsBySchoolIdSubscription],
      ['subscriptions.create', postAdminSchoolsBySchoolIdSubscription],
      ['subscriptions.update', patchAdminSchoolsBySchoolIdSubscription],
      ['subscriptions.cancel', postAdminSchoolsBySchoolIdSubscriptionCancel],
      // Task 45 — the global platform-wide subscription console is SUPER_ADMIN only.
      ['globalSubscriptions.findAll', getAdminSubscriptions],
    ] as Array<[string, EndpointDefinition<never, never>]>
  ).map(([method, definition]) => ({ method, definition }));

  it('restricts every admin route to the SUPER_ADMIN role', () => {
    for (const { definition, method } of protectedHandlers) {
      assert.deepEqual(
        definition.roles,
        [UserRole.SUPER_ADMIN],
        `${method} must require SUPER_ADMIN`,
      );
    }
  });

  it('allows a SUPER_ADMIN (platform, no school claim) through both guards', async () => {
    for (const { definition, method } of protectedHandlers) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN, null)}` },
      };
      await activateGuards(request, definition);
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
      for (const { definition, method } of protectedHandlers) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role, SCHOOL_ID_PARAM)}` },
        };
        await assert.rejects(
          activateGuards(request, definition),
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
    await assert.rejects(
      activateGuards(request, getAdminDashboard as EndpointDefinition<never, never>),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('rejects a SUPER_ADMIN token that carries a school claim (malformed platform token)', async () => {
    const token = await signAccessToken(UserRole.SUPER_ADMIN, SCHOOL_ID_PARAM);
    const request: MockRequest = { headers: { authorization: `Bearer ${token}` } };
    await assert.rejects(
      activateGuards(request, getAdminSchools as EndpointDefinition<never, never>),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });
});
