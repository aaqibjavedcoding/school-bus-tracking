import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { JwtService } from '@nestjs/jwt';
import { AdminManageAssignmentsController } from './admin-manage-assignments.controller';
import { AdminManageBusesController } from './admin-manage-buses.controller';
import { AdminManageConductorsController } from './admin-manage-staff.controller';
import { AdminManageDriversController } from './admin-manage-staff.controller';
import { AdminManageExportsController } from './admin-manage-exports.controller';
import { AdminManageImportsController } from './admin-manage-imports.controller';
import { AdminManageParentsController } from './admin-manage-parents.controller';
import { AdminManageReportsController } from './admin-manage-reports.controller';
import { AdminManageRoutesController } from './admin-manage-routes.controller';
import { AdminManageSessionsController } from './admin-manage-sessions.controller';
import { AdminManageStudentGuardiansController } from './admin-manage-student-guardians.controller';
import { AdminManageStudentsController } from './admin-manage-students.controller';
import { AdminManageStopsController } from './admin-manage-stops.controller';
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

/** Controllers of the assisted-management surface with every mutating handler. */
const MANAGE_CONTROLLERS: Array<{ controller: object; methods: string[]; path: string }> = [
  {
    controller: new AdminManageSessionsController({} as never),
    methods: ['start', 'current', 'end'],
    path: `admin/schools/:${'schoolId'}/manage/session`,
  },
  {
    controller: new AdminManageStudentsController({} as never),
    methods: ['create', 'findAll', 'findOne', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/students',
  },
  {
    controller: new AdminManageStudentGuardiansController({} as never),
    methods: ['create', 'list', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/students/:studentId/guardians',
  },
  {
    controller: new AdminManageParentsController({} as never, {} as never),
    methods: [
      'create',
      'findAll',
      'findOne',
      'update',
      'remove',
      'linkStudent',
      'listStudents',
      'updateStudentLink',
      'unlinkStudent',
    ],
    path: 'admin/schools/:schoolId/manage/parents',
  },
  {
    controller: new AdminManageBusesController({} as never),
    methods: ['create', 'findAll', 'findOne', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/buses',
  },
  {
    controller: new AdminManageRoutesController({} as never),
    methods: [
      'create',
      'findAll',
      'findOne',
      'getDetails',
      'update',
      'remove',
      'findRouteStops',
      'reorderRouteStops',
    ],
    path: 'admin/schools/:schoolId/manage/routes',
  },
  {
    controller: new AdminManageStopsController({} as never),
    methods: ['create', 'findAll', 'findOne', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/stops',
  },
  {
    controller: new AdminManageDriversController({} as never),
    methods: ['create', 'findAll', 'findOne', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/drivers',
  },
  {
    controller: new AdminManageConductorsController({} as never),
    methods: ['create', 'findAll', 'findOne', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/conductors',
  },
  {
    controller: new AdminManageAssignmentsController({} as never),
    methods: ['create', 'findAll', 'findOne', 'update', 'remove'],
    path: 'admin/schools/:schoolId/manage/route-assignments',
  },
  {
    controller: new AdminManageImportsController({} as never, {} as never, {} as never, {} as never, {} as never),
    methods: [
      'listModules',
      'listHistory',
      'findOne',
      'downloadErrorFile',
      'downloadTemplate',
      'validate',
      'commit',
    ],
    path: 'admin/schools/:schoolId/manage/imports',
  },
  {
    controller: new AdminManageExportsController({} as never, {} as never),
    methods: ['listDatasets', 'download'],
    path: 'admin/schools/:schoolId/manage/exports',
  },
  {
    controller: new AdminManageReportsController({} as never, {} as never),
    methods: ['catalogue', 'overview', 'exportReport', 'run'],
    path: 'admin/schools/:schoolId/manage/reports',
  },
];

describe('assisted management controller surface', () => {
  const reflector = new Reflector();

  it('declares the SUPER_ADMIN-only role on every handler', () => {
    for (const { controller, methods } of MANAGE_CONTROLLERS) {
      for (const method of methods) {
        const handler = (
          controller.constructor.prototype as Record<string, (...args: never[]) => unknown>
        )[method];
        assert.ok(handler, `${controller.constructor.name}.${method} exists`);
        // RolesGuard resolves handler-level metadata first, then class-level:
        // the assisted controllers declare the role once at class level.
        const roles = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
          handler,
          controller.constructor,
        ]);
        assert.deepEqual(
          roles,
          [UserRole.SUPER_ADMIN],
          `${controller.constructor.name}.${method} must be SUPER_ADMIN-only`,
        );
      }
    }
  });

  it('mounts every controller under admin/schools/:schoolId/manage/*', () => {
    for (const { controller, path } of MANAGE_CONTROLLERS) {
      const mount = Reflect.getMetadata('path', controller.constructor) as string | undefined;
      assert.equal(mount, path, `${controller.constructor.name} route`);
    }
  });

  it('rejects a SCHOOL_ADMIN token with 403 before the managed-school guard runs', async () => {
    const controller = new AdminManageStudentsController({} as never);
    const handler = AdminManageStudentsController.prototype.findAll;
    const request: MockRequest = {
      headers: {
        authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN, SCHOOL_ID)}`,
      },
      method: 'GET',
      params: { schoolId: SCHOOL_ID },
      user: { id: USER_ID, school_id: SCHOOL_ID, role: UserRole.SCHOOL_ADMIN },
    };
    const context = makeContext(request, handler, controller);

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
    const controller = new AdminManageStudentsController({} as never);
    const handler = AdminManageStudentsController.prototype.findAll;
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN, null)}` },
      method: 'GET',
      params: { schoolId: SCHOOL_ID },
      user: { id: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN },
    };
    const context = makeContext(request, handler, controller);

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
  const handler = AdminManageStudentsController.prototype.findAll;
  const controller = new AdminManageStudentsController({} as never);

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
      handler,
      controller,
    );
    await assert.rejects(
      guard.canActivate(unknown),
      (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 404);
        assert.match(String(error.message), /not found/i);
        return true;
      },
    );

    const malformed = makeContext(requestFor('GET', 'not-a-uuid'), handler, controller);
    await assert.rejects(guard.canActivate(malformed), (error: { status?: number }) => {
      assert.equal(error.status, 400);
      return true;
    });
  });

  it('allows reads on a deactivated school but blocks mutations', async () => {
    const guard = new ManagedSchoolGuard(reflector, schoolLookupStub(false) as never);

    const readRequest = requestFor('GET');
    assert.equal(await guard.canActivate(makeContext(readRequest, handler, controller)), true);
    assert.equal((readRequest.managedSchool as { is_active: boolean }).is_active, false);

    const createHandler = AdminManageStudentsController.prototype.create;
    const write = makeContext(requestFor('POST'), createHandler, controller);
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
    const sessionController = new AdminManageSessionsController({} as never);
    const startHandler = AdminManageSessionsController.prototype.start;
    // The session controller class carries the opt-in metadata.
    const context = makeContext(requestFor('POST'), startHandler, sessionController);
    assert.equal(await guard.canActivate(context), true);
  });
});
