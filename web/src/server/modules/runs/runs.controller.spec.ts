import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, JwtService, Reflector, ValidationPipe } from '../../framework';
import { JwtAccessTokenPayload, RunCrewRole, UserRole } from '@school-bus-tracking/shared-types';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { ShiftsService } from '../shifts/shifts.service';
import { RunsService } from './runs.service';
import { RunCrewService } from '../run-crew/run-crew.service';
import { CreateShiftDto } from '../shifts/dto/create-shift.dto';
import { UpdateShiftDto } from '../shifts/dto/update-shift.dto';
import { CreateRouteRunDto, CreateRunDto } from './dto/create-run.dto';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { UpdateRunDto } from './dto/update-run.dto';
import { CreateRunCrewDto } from '../run-crew/dto/create-run-crew.dto';
import { UpdateRunCrewDto } from '../run-crew/dto/update-run-crew.dto';
import { ListRunCrewQueryDto } from '../run-crew/dto/list-run-crew-query.dto';
import {
  deleteShiftsById,
  getShifts,
  getShiftsById,
  patchShiftsById,
  postShifts,
} from '../../api/shifts';
import {
  deleteRunsById,
  getBusesByIdRuns,
  getRoutesByIdRuns,
  getRuns,
  getRunsById,
  patchRunsById,
  postRoutesByIdRuns,
  postRuns,
} from '../../api/runs';
import {
  deleteRunCrewById,
  getRunCrewById,
  getRunsByIdCrew,
  getUsersByIdRunCrew,
  patchRunCrewById,
  postRunsByIdCrew,
} from '../../api/run-crew';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const ROUTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BUS_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECRET = 'unit-test-jwt-secret';
const ADMIN_USER = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };
const DRIVER_USER = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.DRIVER };

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

function pipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
}

async function expectPipeRejects(
  metatype: new () => object,
  body: Record<string, unknown>,
  type: 'body' | 'query' = 'body',
): Promise<void> {
  await assert.rejects(pipe().transform(body, { metatype, type, data: '' }), (error: unknown) => {
    assert.ok(error instanceof BadRequestException, `expected 400, got ${String(error)}`);
    return true;
  });
}

const WRITE_ENDPOINTS: Array<[string, EndpointDefinition<never, never>]> = [
  ['postShifts', postShifts as EndpointDefinition<never, never>],
  ['patchShiftsById', patchShiftsById as EndpointDefinition<never, never>],
  ['deleteShiftsById', deleteShiftsById as EndpointDefinition<never, never>],
  ['postRuns', postRuns as EndpointDefinition<never, never>],
  ['patchRunsById', patchRunsById as EndpointDefinition<never, never>],
  ['deleteRunsById', deleteRunsById as EndpointDefinition<never, never>],
  ['postRoutesByIdRuns', postRoutesByIdRuns as EndpointDefinition<never, never>],
  ['postRunsByIdCrew', postRunsByIdCrew as EndpointDefinition<never, never>],
  ['patchRunCrewById', patchRunCrewById as EndpointDefinition<never, never>],
  ['deleteRunCrewById', deleteRunCrewById as EndpointDefinition<never, never>],
];

const READ_ENDPOINTS: Array<[string, EndpointDefinition<never, never>]> = [
  ['getShifts', getShifts as EndpointDefinition<never, never>],
  ['getShiftsById', getShiftsById as EndpointDefinition<never, never>],
  ['getRuns', getRuns as EndpointDefinition<never, never>],
  ['getRunsById', getRunsById as EndpointDefinition<never, never>],
  ['getRoutesByIdRuns', getRoutesByIdRuns as EndpointDefinition<never, never>],
  ['getBusesByIdRuns', getBusesByIdRuns as EndpointDefinition<never, never>],
  ['getRunsByIdCrew', getRunsByIdCrew as EndpointDefinition<never, never>],
  ['getRunCrewById', getRunCrewById as EndpointDefinition<never, never>],
  ['getUsersByIdRunCrew', getUsersByIdRunCrew as EndpointDefinition<never, never>],
];

describe('shifts/runs/run-crew endpoints (authorization)', () => {
  it('restricts every write to SCHOOL_ADMIN', () => {
    for (const [name, definition] of WRITE_ENDPOINTS) {
      assert.deepEqual(definition.roles, [UserRole.SCHOOL_ADMIN], name);
    }
  });

  it('lets admins and operational staff read, never parents or the platform admin', async () => {
    for (const [name, definition] of READ_ENDPOINTS) {
      for (const role of [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await activateGuards(request, definition);
        assert.equal(request.user?.role, role, name);
      }
      for (const role of [UserRole.PARENT, UserRole.SUPER_ADMIN]) {
        const request: MockRequest = {
          headers: { authorization: `Bearer ${await signAccessToken(role)}` },
        };
        await assert.rejects(
          activateGuards(request, definition),
          (error: { getStatus?: () => number }) => {
            assert.equal(error.getStatus?.(), 403, `${name} / ${role}`);
            return true;
          },
        );
      }
    }
  });

  it('rejects staff on writes with 403 and anonymous callers with 401', async () => {
    for (const [name, definition] of WRITE_ENDPOINTS) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(UserRole.DRIVER)}` },
      };
      await assert.rejects(
        activateGuards(request, definition),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403, name);
          return true;
        },
      );
      await assert.rejects(
        activateGuards({ headers: {} }, definition),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 401, name);
          return true;
        },
      );
    }
  });
});

describe('shifts/runs/run-crew endpoints (tenant pinning)', () => {
  it('passes the JWT school_id and path ids to every service call', async () => {
    const seen: Array<{ service: string; method: string; args: unknown[] }> = [];
    const record =
      (service: string, method: string) =>
      async (...args: unknown[]) => {
        seen.push({ service, method, args });
        return { id: RUN_ID };
      };
    const shifts = {
      create: record('shifts', 'create'),
      findAll: record('shifts', 'findAll'),
      findOne: record('shifts', 'findOne'),
      update: record('shifts', 'update'),
      remove: record('shifts', 'remove'),
    } as unknown as ShiftsService;
    const runs = {
      create: record('runs', 'create'),
      createForRoute: record('runs', 'createForRoute'),
      findAll: record('runs', 'findAll'),
      findAllForRoute: record('runs', 'findAllForRoute'),
      findAllForBus: record('runs', 'findAllForBus'),
      findOne: record('runs', 'findOne'),
      update: record('runs', 'update'),
      remove: record('runs', 'remove'),
    } as unknown as RunsService;
    const runCrew = {
      create: record('runCrew', 'create'),
      findAllForRun: record('runCrew', 'findAllForRun'),
      findAllForUser: record('runCrew', 'findAllForUser'),
      findOne: record('runCrew', 'findOne'),
      update: record('runCrew', 'update'),
      remove: record('runCrew', 'remove'),
    } as unknown as RunCrewService;
    const restores = [
      overrideContainer('shifts', shifts),
      overrideContainer('runs', runs),
      overrideContainer('runCrew', runCrew),
    ];
    try {
      await callHandler(postShifts, { user: ADMIN_USER, body: new CreateShiftDto() });
      await callHandler(getShifts, { user: ADMIN_USER, query: {} as never });
      await callHandler(getShiftsById, { user: ADMIN_USER, params: { id: RUN_ID } });
      await callHandler(patchShiftsById, {
        user: ADMIN_USER,
        params: { id: RUN_ID },
        body: new UpdateShiftDto(),
      });
      await callHandler(deleteShiftsById, { user: ADMIN_USER, params: { id: RUN_ID } });

      await callHandler(postRuns, { user: ADMIN_USER, body: new CreateRunDto() });
      await callHandler(getRuns, { user: ADMIN_USER, query: new ListRunsQueryDto() });
      await callHandler(getRunsById, { user: ADMIN_USER, params: { id: RUN_ID } });
      await callHandler(patchRunsById, {
        user: ADMIN_USER,
        params: { id: RUN_ID },
        body: new UpdateRunDto(),
      });
      await callHandler(deleteRunsById, { user: ADMIN_USER, params: { id: RUN_ID } });
      await callHandler(getRoutesByIdRuns, {
        user: ADMIN_USER,
        params: { id: ROUTE_ID },
        query: new ListRunsQueryDto(),
      });
      await callHandler(postRoutesByIdRuns, {
        user: ADMIN_USER,
        params: { id: ROUTE_ID },
        body: new CreateRouteRunDto(),
      });
      await callHandler(getBusesByIdRuns, {
        user: ADMIN_USER,
        params: { busId: BUS_ID },
        query: new ListRunsQueryDto(),
      });

      await callHandler(getRunsByIdCrew, {
        user: ADMIN_USER,
        params: { id: RUN_ID },
        query: new ListRunCrewQueryDto(),
      });
      await callHandler(postRunsByIdCrew, {
        user: ADMIN_USER,
        params: { id: RUN_ID },
        body: new CreateRunCrewDto(),
      });
      await callHandler(getRunCrewById, { user: ADMIN_USER, params: { id: RUN_ID } });
      await callHandler(patchRunCrewById, {
        user: ADMIN_USER,
        params: { id: RUN_ID },
        body: new UpdateRunCrewDto(),
      });
      await callHandler(deleteRunCrewById, { user: ADMIN_USER, params: { id: RUN_ID } });
      await callHandler(getUsersByIdRunCrew, {
        user: ADMIN_USER,
        params: { userId: OTHER_USER_ID },
        query: new ListRunCrewQueryDto(),
      });
    } finally {
      restores.forEach((restore) => restore());
    }

    assert.equal(seen.length, 19);
    assert.ok(seen.every((call) => call.args[0] === SCHOOL_A));
    const byMethod = new Map(seen.map((call) => [`${call.service}.${call.method}`, call.args]));
    assert.equal(byMethod.get('runs.createForRoute')?.[1], ROUTE_ID);
    assert.equal(byMethod.get('runs.findAllForRoute')?.[1], ROUTE_ID);
    assert.equal(byMethod.get('runs.findAllForBus')?.[1], BUS_ID);
    assert.equal(byMethod.get('runCrew.create')?.[1], RUN_ID);
    assert.equal(byMethod.get('runCrew.findAllForRun')?.[1], RUN_ID);
    assert.equal(byMethod.get('runCrew.findAllForUser')?.[1], OTHER_USER_ID);
  });

  it('lets staff read only their own roster', async () => {
    const seen: string[] = [];
    const runCrew = {
      findAllForUser: async (_schoolId: string, userId: string) => {
        seen.push(userId);
        return { items: [], meta: {} };
      },
    } as unknown as RunCrewService;
    const restore = overrideContainer('runCrew', runCrew);
    try {
      await callHandler(getUsersByIdRunCrew, {
        user: DRIVER_USER,
        params: { userId: USER_ID },
        query: new ListRunCrewQueryDto(),
      });
      await assert.rejects(
        callHandler(getUsersByIdRunCrew, {
          user: DRIVER_USER,
          params: { userId: OTHER_USER_ID },
          query: new ListRunCrewQueryDto(),
        }),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    } finally {
      restore();
    }
    assert.deepEqual(seen, [USER_ID]);
  });

  it('rejects malformed path ids before reaching the service', async () => {
    const restore = overrideContainer('runs', {
      findOne: async () => {
        throw new Error('must not be called');
      },
    } as unknown as RunsService);
    try {
      await assert.rejects(
        callHandler(getRunsById, { user: ADMIN_USER, params: { id: 'not-a-uuid' } }),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 400);
          return true;
        },
      );
    } finally {
      restore();
    }
  });
});

describe('shifts/runs/run-crew DTOs (validation pipe)', () => {
  it('accepts a well-formed shift and normalises nothing at the pipe', async () => {
    const dto = (await pipe().transform(
      { name: 'Morning', start_time: '06:30', end_time: '09:00' },
      { metatype: CreateShiftDto, type: 'body', data: '' },
    )) as CreateShiftDto;
    assert.equal(dto.start_time, '06:30');
  });

  it('rejects school_id and malformed times on shifts', async () => {
    await expectPipeRejects(CreateShiftDto, {
      name: 'Morning',
      start_time: '06:30',
      end_time: '09:00',
      school_id: SCHOOL_A,
    });
    await expectPipeRejects(CreateShiftDto, {
      name: 'Morning',
      start_time: '6:30',
      end_time: '09:00',
    });
    await expectPipeRejects(CreateShiftDto, {
      name: 'Morning',
      start_time: '06:30',
      end_time: '25:00',
    });
    await expectPipeRejects(CreateShiftDto, { name: '', start_time: '06:30', end_time: '09:00' });
    await expectPipeRejects(UpdateShiftDto, { start_time: '06:30:00:00' });
  });

  it('never accepts is_default or school_id on runs and keeps route_id immutable', async () => {
    const valid = { route_id: ROUTE_ID };
    const dto = (await pipe().transform(valid, {
      metatype: CreateRunDto,
      type: 'body',
      data: '',
    })) as CreateRunDto;
    assert.equal(dto.route_id, ROUTE_ID);

    await expectPipeRejects(CreateRunDto, { ...valid, is_default: true });
    await expectPipeRejects(CreateRunDto, { ...valid, school_id: SCHOOL_A });
    await expectPipeRejects(CreateRunDto, { ...valid, shift_id: 'nope' });
    await expectPipeRejects(CreateRunDto, {});
    await expectPipeRejects(CreateRouteRunDto, { route_id: ROUTE_ID });
    await expectPipeRejects(UpdateRunDto, { route_id: ROUTE_ID });
    await expectPipeRejects(UpdateRunDto, { is_default: false });

    const cleared = (await pipe().transform(
      { shift_id: null, bus_id: null, is_active: 'false' },
      { metatype: UpdateRunDto, type: 'body', data: '' },
    )) as UpdateRunDto;
    assert.equal(cleared.shift_id, null);
    assert.equal(cleared.is_active, false);
  });

  it('coerces run list filters from the query string', async () => {
    const query = (await pipe().transform(
      { page: '2', limit: '5', is_active: 'true', route_id: ROUTE_ID, search: 'north' },
      { metatype: ListRunsQueryDto, type: 'query', data: '' },
    )) as ListRunsQueryDto;
    assert.equal(query.page, 2);
    assert.equal(query.limit, 5);
    assert.equal(query.is_active, true);
    await expectPipeRejects(ListRunsQueryDto, { limit: '500' }, 'query');
    await expectPipeRejects(ListRunsQueryDto, { shift_id: 'x' }, 'query');
  });

  it('validates the crew roster body', async () => {
    const valid = { user_id: USER_ID, role: RunCrewRole.DRIVER, effective_from: '2026-03-01' };
    const dto = (await pipe().transform(valid, {
      metatype: CreateRunCrewDto,
      type: 'body',
      data: '',
    })) as CreateRunCrewDto;
    assert.equal(dto.role, RunCrewRole.DRIVER);

    await expectPipeRejects(CreateRunCrewDto, { ...valid, role: UserRole.SCHOOL_ADMIN });
    await expectPipeRejects(CreateRunCrewDto, { ...valid, run_id: RUN_ID });
    await expectPipeRejects(CreateRunCrewDto, { ...valid, school_id: SCHOOL_A });
    await expectPipeRejects(CreateRunCrewDto, { ...valid, effective_from: '2026-3-1' });
    await expectPipeRejects(CreateRunCrewDto, { ...valid, effective_from: '2026-03-01T00:00:00Z' });
    await expectPipeRejects(CreateRunCrewDto, { ...valid, effective_to: '2026-13-01' });
    await expectPipeRejects(UpdateRunCrewDto, { run_id: RUN_ID });
    await expectPipeRejects(ListRunCrewQueryDto, { role: 'PARENT' }, 'query');
  });
});
