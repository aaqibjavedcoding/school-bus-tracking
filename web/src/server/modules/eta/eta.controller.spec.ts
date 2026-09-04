import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException, Reflector } from '../../framework';
import { JwtService } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../../common/decorators';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import {
  getTripsByTripIdArrivals,
  getTripsByTripIdEta,
  getTripsByTripIdProgress,
} from '../../api/eta';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
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

function makeContext(request: MockRequest, definition: EndpointDefinition<never, never>) {
  return makeGuardContext(definition, request as unknown as Record<string, unknown>);
}

async function activateGuards(
  request: MockRequest,
  definition: EndpointDefinition<never, never>,
): Promise<void> {
  const context = makeContext(request, definition);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

const getEtaHandler = getTripsByTripIdEta as EndpointDefinition<never, never>;
const listArrivalsHandler = getTripsByTripIdArrivals as EndpointDefinition<never, never>;
const getProgressHandler = getTripsByTripIdProgress as EndpointDefinition<never, never>;

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

  // The handlers resolve these three services through the container, so the
  // doubles are installed there and removed by the returned `restore`.
  const restores = [
    overrideContainer('liveTracking', liveTracking),
    overrideContainer('eta', eta),
    overrideContainer('stopArrivals', arrivals),
  ];

  return {
    etaCalls,
    arrivalCalls,
    restore: () => restores.forEach((undo) => undo()),
  };
}

const PARENT = { id: USER_ID, school_id: SCHOOL_A, role: UserRole.PARENT };

describe('EtaController authorization', () => {
  it('declares the read roles on the controller for all three endpoints', () => {
    assert.deepEqual(getTripsByTripIdEta.roles, READ_ROLES);
    // The controller-level @Roles applied to all three endpoints; each
    // definition now carries the identical set explicitly.
    for (const definition of [getEtaHandler, listArrivalsHandler, getProgressHandler]) {
      assert.deepEqual(definition.roles, READ_ROLES);
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
    const { etaCalls, restore } = makeController({ observation: { ok: true } });
    try {
      const response = (await callHandler(getTripsByTripIdEta, {
        user: PARENT,
        params: { tripId: TRIP_A },
      })) as { trip_id: string };
      assert.equal(response.trip_id, TRIP_A);
      assert.equal(etaCalls.length, 1);
    } finally {
      restore();
    }
  });

  it('collapses unauthorized observation into the generic 404', async () => {
    const { etaCalls, restore } = makeController({
      observation: { ok: false, reason: 'unauthorized' },
    });
    try {
      await assert.rejects(callHandler(getTripsByTripIdEta, { user: PARENT, params: { tripId: TRIP_A } }), (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).message, ETA_TRIP_NOT_FOUND_MESSAGE);
        return true;
      });
      assert.equal(etaCalls.length, 0);
    } finally {
      restore();
    }
  });

  it('collapses a cross-school trip into the same generic 404', async () => {
    const { etaCalls, restore } = makeController({
      observation: { ok: false, reason: 'trip_not_found' },
    });
    try {
      const otherTenantParent = { id: USER_ID, school_id: SCHOOL_B, role: UserRole.PARENT };
      await assert.rejects(callHandler(getTripsByTripIdEta, { user: otherTenantParent, params: { tripId: TRIP_A } }), (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).message, ETA_TRIP_NOT_FOUND_MESSAGE);
        return true;
      });
      assert.equal(etaCalls.length, 0);
    } finally {
      restore();
    }
  });

  it('delegates the arrivals and progress reads to the arrival service', async () => {
    const { arrivalCalls, restore } = makeController({ observation: { ok: true } });
    try {
      const arrivals = (await callHandler(getTripsByTripIdArrivals, {
        user: PARENT,
        params: { tripId: TRIP_A },
      })) as { trip_id: string };
      assert.equal(arrivals.trip_id, TRIP_A);
      const progress = (await callHandler(getTripsByTripIdProgress, {
        user: PARENT,
        params: { tripId: TRIP_A },
      })) as { trip_id: string };
      assert.equal(progress.trip_id, TRIP_A);
      assert.deepEqual(
        arrivalCalls.map((call) => call.method),
        ['listArrivals', 'getProgress'],
      );
    } finally {
      restore();
    }
  });

  it('feeds the latest location into the ETA computation', async () => {
    const latest = makeFix();
    const { etaCalls, restore } = makeController({
      observation: { ok: true },
      latest,
    });
    try {
      await callHandler(getTripsByTripIdEta, { user: PARENT, params: { tripId: TRIP_A } });
      const input = etaCalls[0] as { latest?: { id?: string } };
      assert.equal(input.latest?.id, latest.id);
    } finally {
      restore();
    }
  });
});
