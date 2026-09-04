import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, StudentGender, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
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
    getClass: () => StudentsController,
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

const createHandler = StudentsController.prototype.create as unknown as (
  ...args: never[]
) => unknown;

describe('StudentsController (authorization)', () => {
  it('restricts the whole controller to SCHOOL_ADMIN via @Roles metadata', async () => {
    // @Roles is declared at controller level, so it applies to every endpoint.
    const metadata = Reflect.getMetadata(ROLES_KEY, StudentsController);
    assert.deepEqual(metadata, [UserRole.SCHOOL_ADMIN]);
  });

  it('allows a SCHOOL_ADMIN with a token-scoped school_id', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
    };
    await activateGuards(request, createHandler);

    const user = request.user as AuthenticatedRequestUser;
    assert.equal(user.role, UserRole.SCHOOL_ADMIN);
    assert.equal(user.school_id, SCHOOL_A);
  });

  it('rejects non-admin roles with 403', async () => {
    for (const role of [
      UserRole.SUPER_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await assert.rejects(
        activateGuards(request, createHandler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, createHandler),
      (error: { getStatus?: () => number }) => {
        assert.equal(error.getStatus?.(), 401);
        return true;
      },
    );
  });

  it('passes the authenticated school_id to every service call (create)', async () => {
    const calls: Array<{ schoolId: string }> = [];
    const service = {
      create: async (schoolId: string) => {
        calls.push({ schoolId });
        return { id: 'student-1' };
      },
    } as unknown as StudentsService;
    const controller = new StudentsController(service);

    await controller.create(SCHOOL_A, new CreateStudentDto());

    assert.deepEqual(calls, [{ schoolId: SCHOOL_A }]);
  });

  it('passes school_id and query to list, and school_id + params to scoped routes', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const service = {
      findAll: async (schoolId: string, query: ListStudentsQueryDto) => {
        seen.push({ method: 'findAll', schoolId, page: query.page, limit: query.limit });
        return { items: [], meta: {} };
      },
      findOneForActor: async (user: AuthenticatedRequestUser, id: string) => {
        seen.push({ method: 'findOne', schoolId: user.school_id, id });
        return { id };
      },
      update: async (schoolId: string, id: string, dto: UpdateStudentDto) => {
        seen.push({ method: 'update', schoolId, id, dto });
        return { id };
      },
      remove: async (schoolId: string, id: string) => {
        seen.push({ method: 'remove', schoolId, id });
        return { id, message: 'deleted' };
      },
    } as unknown as StudentsService;
    const controller = new StudentsController(service);

    const actor: AuthenticatedRequestUser = {
      id: USER_ID,
      school_id: SCHOOL_A,
      role: UserRole.SCHOOL_ADMIN,
    };
    await controller.findAll(SCHOOL_A, makeQuery());
    await controller.findOne(actor, 'student-1');
    await controller.update(SCHOOL_A, 'student-1', new UpdateStudentDto());
    await controller.remove(SCHOOL_A, 'student-1');

    assert.deepEqual(
      seen.map((call) => call.method),
      ['findAll', 'findOne', 'update', 'remove'],
    );
    assert.ok(seen.every((call) => call.schoolId === SCHOOL_A));
  });

  it('create delegates the DTO to the service', async () => {
    let receivedDto: CreateStudentDto | undefined;
    const service = {
      create: async (_schoolId: string, dto: CreateStudentDto) => {
        receivedDto = dto;
        return { id: 'student-1' };
      },
    } as unknown as StudentsService;
    const controller = new StudentsController(service);

    const dto = new CreateStudentDto();
    dto.admission_number = 'STU-101';
    dto.first_name = 'Alice';
    dto.last_name = 'Adams';
    dto.gender = StudentGender.FEMALE;

    await controller.create(SCHOOL_A, dto);

    assert.equal(receivedDto?.admission_number, 'STU-101');
  });
});

function makeQuery(): ListStudentsQueryDto {
  const dto = new ListStudentsQueryDto();
  dto.page = 2;
  dto.limit = 10;
  return dto;
}
