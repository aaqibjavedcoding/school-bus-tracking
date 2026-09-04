import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import {
  deleteBusesById,
  getBuses,
  getBusesById,
  patchBusesById,
  postBuses,
} from '../../api/buses';
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

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

/** Every buses endpoint carries the same role restriction. */
const ALL_ENDPOINTS = [postBuses, getBuses, getBusesById, patchBusesById, deleteBusesById];

describe('Buses endpoints (authorization)', () => {
  it('restricts every endpoint to SCHOOL_ADMIN', () => {
    // `@Roles` was declared at controller level, so it applied to every
    // endpoint; each definition now carries the same restriction explicitly.
    for (const definition of ALL_ENDPOINTS) {
      assert.deepEqual(definition.roles, [UserRole.SCHOOL_ADMIN]);
    }
  });

  it('exposes the roles through guard metadata', () => {
    const context = makeGuardContext(postBuses as EndpointDefinition<never, never>, {
      headers: {},
    });
    const metadata = new Reflector().getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    assert.deepEqual(metadata, [UserRole.SCHOOL_ADMIN]);
  });

  it('allows a SCHOOL_ADMIN with a token-scoped school_id', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SCHOOL_ADMIN)}` },
    };
    await activateGuards(request, postBuses as EndpointDefinition<never, never>);

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
        activateGuards(request, postBuses as EndpointDefinition<never, never>),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('rejects an unauthenticated request with 401', async () => {
    await assert.rejects(
      activateGuards({ headers: {} }, postBuses as EndpointDefinition<never, never>),
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

    const restore = overrideBuses(service);
    try {
      const user = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };
      const busId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

      await callHandler(postBuses, { user, body: new CreateBusDto() });
      await callHandler(getBuses, { user, query: makeQuery() });
      await callHandler(getBusesById, { user, params: { busId: busId } });
      await callHandler(patchBusesById, {
        user,
        params: { busId: busId },
        body: new UpdateBusDto(),
      });
      await callHandler(deleteBusesById, { user, params: { busId: busId } });
    } finally {
      restore();
    }

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

    const restore = overrideBuses(service);
    try {
      const dto = new CreateBusDto();
      dto.registration_number = 'ABC-1234';
      dto.capacity = 48;

      await callHandler(postBuses, {
        user: { id: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN },
        body: dto,
      });
    } finally {
      restore();
    }

    assert.equal(receivedDto?.registration_number, 'ABC-1234');
  });
});

function overrideBuses(service: BusesService): () => void {
  // Imported lazily so the container is only touched by the tests that stub it.
  const { overrideContainer } = require('../../container') as typeof import('../../container');
  return overrideContainer('buses', service);
}

function makeQuery(): ListBusesQueryDto {
  const dto = new ListBusesQueryDto();
  dto.page = 2;
  dto.limit = 10;
  return dto;
}
