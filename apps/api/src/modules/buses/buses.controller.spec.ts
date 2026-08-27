import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { BusesController } from './buses.controller';
import { BusesService } from './buses.service';
import { CreateBusDto } from './dto/create-bus.dto';
import { ListBusesQueryDto } from './dto/list-buses-query.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: USER_ID, school_id: schoolId, role };
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
    getClass: () => BusesController,
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

const createHandler = BusesController.prototype.create as unknown as (...args: never[]) => unknown;

describe('BusesController (authorization)', () => {
  it('restricts the whole controller to SCHOOL_ADMIN via @Roles metadata', async () => {
    // @Roles is declared at controller level, so it applies to every endpoint.
    const metadata = Reflect.getMetadata(ROLES_KEY, BusesController);
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

  it('passes the authenticated school_id to every service call', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const service = {
      create: async (schoolId: string, dto: CreateBusDto) => {
        seen.push({ method: 'create', schoolId, dto });
        return { id: 'bus-1' };
      },
      findAll: async (schoolId: string, query: ListBusesQueryDto) => {
        seen.push({ method: 'findAll', schoolId, page: query.page, limit: query.limit });
        return { items: [], meta: {} };
      },
      findOne: async (schoolId: string, id: string) => {
        seen.push({ method: 'findOne', schoolId, id });
        return { id };
      },
      update: async (schoolId: string, id: string, dto: UpdateBusDto) => {
        seen.push({ method: 'update', schoolId, id, dto });
        return { id };
      },
      remove: async (schoolId: string, id: string) => {
        seen.push({ method: 'remove', schoolId, id });
        return { id, message: 'deleted' };
      },
    } as unknown as BusesService;
    const controller = new BusesController(service);

    await controller.create(SCHOOL_A, new CreateBusDto());
    await controller.findAll(SCHOOL_A, makeQuery());
    await controller.findOne(SCHOOL_A, 'bus-1');
    await controller.update(SCHOOL_A, 'bus-1', new UpdateBusDto());
    await controller.remove(SCHOOL_A, 'bus-1');

    assert.deepEqual(
      seen.map((call) => call.method),
      ['create', 'findAll', 'findOne', 'update', 'remove'],
    );
    assert.ok(seen.every((call) => call.schoolId === SCHOOL_A));
  });

  it('create delegates the DTO to the service', async () => {
    let receivedDto: CreateBusDto | undefined;
    const service = {
      create: async (_schoolId: string, dto: CreateBusDto) => {
        receivedDto = dto;
        return { id: 'bus-1' };
      },
    } as unknown as BusesService;
    const controller = new BusesController(service);

    const dto = new CreateBusDto();
    dto.registration_number = 'ABC-1234';
    dto.capacity = 48;

    await controller.create(SCHOOL_A, dto);

    assert.equal(receivedDto?.registration_number, 'ABC-1234');
  });
});

function makeQuery(): ListBusesQueryDto {
  const dto = new ListBusesQueryDto();
  dto.page = 2;
  dto.limit = 10;
  return dto;
}
