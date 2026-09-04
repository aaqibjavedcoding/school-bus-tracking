import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { NotFoundException, Reflector } from '../../framework';
import { JwtService } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
import { EtaController } from './eta.controller';
import { EtaService } from './eta.service';
import { StopArrivalsService } from './stop-arrivals.service';
import { ETA_TRIP_NOT_FOUND_MESSAGE } from './eta.constants';
import {
  SCHOOL_A,
  SCHOOL_B,
  TRIP_A,
  asTrip,
  makeFix,
  makeTrip,
  minimalEtaResponse,
} from './eta.test-utils';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'eta-controller-test-secret';

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
    getClass: () => EtaController,
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

const getEtaHandler = EtaController.prototype.getEta as unknown as (...args: never[]) => unknown;
const listArrivalsHandler = EtaController.prototype.listArrivals as unknown as (
  ...args: never[]
) => unknown;
const getProgressHandler = EtaController.prototype.getProgress as unknown as (
  ...args: never[]
) => unknown;

const READ_ROLES = [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT];

/** Controller wired to doubles; every observation decision is delegated. */
function makeController(options: {
  observation: { ok: true } | { ok: false; reason: 'trip_not_found' | 'unauthorized' };
  latest?: unknown;
}) {
  const liveTracking = {
    authorizeObservation: async () => ({
      ...options.observation,
      trip: options.observation.ok ? asTrip(makeTrip({ id: TRIP_A })) : undefined,
    }),
    getLatestLocationResponse: async () => options.latest ?? null,
  } as unknown as LiveTrackingService;

  const etaCalls: unknown[] = [];
  const eta = {
    computeTripEta: async (input: unknown) => {
      etaCalls.push(input);
      return minimalEtaResponse(makeTrip({ id: TRIP_A }), null);
    },
  } as unknown as EtaService;

  const arrivalCalls: Array<{ method: string }> = [];
  const arrivals = {
    listArrivals: async () => {
      arrivalCalls.push({ method: 'listArrivals' });
      return { trip_id: TRIP_A, school_id: SCHOOL_A, items: [] };
    },
    getProgress: async () => {
      arrivalCalls.push({ method: 'getProgress' });
      const trip = makeTrip({ id: TRIP_A });
      return {
        trip_id: TRIP_A,
        school_id: SCHOOL_A,
        trip_status: trip.status,
        tracking_state: 'active',
        current_stop: null,
        next_stop: null,
        arrivals: [],
        eta: minimalEtaResponse(trip, null),
      };
    },
  } as unknown as StopArrivalsService;

  return {
    controller: new EtaController(liveTracking, eta, arrivals),
    etaCalls,
    arrivalCalls,
  };
}

const PARENT = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.PARENT };

describe('EtaController authorization', () => {
  it('declares the read roles on the controller for all three endpoints', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, EtaController), READ_ROLES);
    for (const handler of [getEtaHandler, listArrivalsHandler, getProgressHandler]) {
      assert.equal(Reflect.getMetadata(ROLES_KEY, handler), undefined);
    }
  });

  it('lets every allowed role through the guards', async () => {
    for (const role of READ_ROLES) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await activateGuards(request, getEtaHandler);
      assert.equal(request.user?.role, role);
    }
  });

  it('refuses platform roles (SUPER_ADMIN) for trip reads', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN)}` },
    };
    await assert.rejects(activateGuards(request, getEtaHandler));
  });

  it('computes the ETA only for an observable trip', async () => {
    const { controller, etaCalls } = makeController({ observation: { ok: true } });
    const response = await controller.getEta(PARENT, TRIP_A);
    assert.equal(response.trip_id, TRIP_A);
    assert.equal(etaCalls.length, 1);
  });

  it('collapses unauthorized observation into the generic 404', async () => {
    const { controller, etaCalls } = makeController({
      observation: { ok: false, reason: 'unauthorized' },
    });
    await assert.rejects(controller.getEta(PARENT, TRIP_A), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error as NotFoundException).message, ETA_TRIP_NOT_FOUND_MESSAGE);
      return true;
    });
    assert.equal(etaCalls.length, 0);
  });

  it('collapses a cross-school trip into the same generic 404', async () => {
    const { controller, etaCalls } = makeController({
      observation: { ok: false, reason: 'trip_not_found' },
    });
    const otherTenantParent = { id: USER_ID, school_id: SCHOOL_B, role: UserRole.PARENT };
    await assert.rejects(controller.getEta(otherTenantParent, TRIP_A), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error as NotFoundException).message, ETA_TRIP_NOT_FOUND_MESSAGE);
      return true;
    });
    assert.equal(etaCalls.length, 0);
  });

  it('delegates the arrivals and progress reads to the arrival service', async () => {
    const { controller, arrivalCalls } = makeController({ observation: { ok: true } });
    const arrivals = await controller.listArrivals(PARENT, TRIP_A);
    assert.equal(arrivals.trip_id, TRIP_A);
    const progress = await controller.getProgress(PARENT, TRIP_A);
    assert.equal(progress.trip_id, TRIP_A);
    assert.deepEqual(
      arrivalCalls.map((call) => call.method),
      ['listArrivals', 'getProgress'],
    );
  });

  it('feeds the latest location into the ETA computation', async () => {
    const latest = makeFix();
    const { controller, etaCalls } = makeController({
      observation: { ok: true },
      latest,
    });
    await controller.getEta(PARENT, TRIP_A);
    const input = etaCalls[0] as { latest?: { id?: string } };
    assert.equal(input.latest?.id, latest.id);
  });
});
