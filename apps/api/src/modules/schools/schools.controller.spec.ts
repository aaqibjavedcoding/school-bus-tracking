import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { OnboardSchoolDto } from './dto/onboard-school.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'unit-test-jwt-secret';

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());

async function signAccessToken(role: UserRole): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: USER_ID, school_id: SCHOOL_ID, role };
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
    getClass: () => SchoolsController,
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

const onboardHandler = SchoolsController.prototype.onboard as unknown as (
  ...args: never[]
) => unknown;

describe('SchoolsController (onboarding)', () => {
  it('routes POST /schools through JWT + Roles guards restricted to SUPER_ADMIN', async () => {
    const metadata = Reflect.getMetadata(ROLES_KEY, SchoolsController.prototype.onboard);
    assert.deepEqual(metadata, [UserRole.SUPER_ADMIN]);
  });

  it('allows a SUPER_ADMIN to reach the onboarding handler', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN)}` },
    };
    await activateGuards(request, onboardHandler);

    assert.equal((request.user as AuthenticatedRequestUser).role, UserRole.SUPER_ADMIN);
  });

  it('rejects every non-super-admin role with 403', async () => {
    for (const role of [
      UserRole.SCHOOL_ADMIN,
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await assert.rejects(
        activateGuards(request, onboardHandler),
        (error: { getStatus?: () => number }) => {
          assert.equal(error.getStatus?.(), 403);
          return true;
        },
      );
    }
  });

  it('delegates to SchoolsService.onboard and returns the clean response', async () => {
    const expected = {
      school: {
        id: 'school-1',
        name: 'Lincoln High School',
        code: 'lincoln-high',
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      admin: {
        id: 'user-1',
        school_id: 'school-1',
        role: UserRole.SCHOOL_ADMIN,
        first_name: 'Alicia',
        last_name: 'Adams',
        email: 'admin@lincoln-high.org',
      },
    };
    let receivedDto: OnboardSchoolDto | undefined;
    const service = {
      onboard: async (dto: OnboardSchoolDto) => {
        receivedDto = dto;
        return expected;
      },
    } as unknown as SchoolsService;
    const controllerWithService = new SchoolsController(service);

    const result = await controllerWithService.onboard(makeOnboardDto());

    assert.ok(receivedDto, 'service must receive the validated DTO');
    assert.deepEqual(result, expected);
  });
});

function makeOnboardDto(): OnboardSchoolDto {
  const dto = new OnboardSchoolDto();
  dto.school = { name: 'Lincoln High School', code: 'lincoln-high' };
  dto.admin = {
    name: 'Alicia Adams',
    email: 'admin@lincoln-high.org',
    password: 'correct-horse-battery',
  };
  return dto;
}
