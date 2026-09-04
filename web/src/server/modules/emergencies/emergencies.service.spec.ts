import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import {
  EMERGENCY_EVENTS,
  EmergencyStatus,
  EmergencyType,
  TripStatus,
  UserRole,
  emergencyRoomName,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';
import { EmergenciesService } from './emergencies.service';
import {
  EMERGENCY_COORDINATES_PAIR_MESSAGE,
  EMERGENCY_NOT_FOUND_MESSAGE,
  EMERGENCY_STATUS_FORBIDDEN_MESSAGE,
  EMERGENCY_STATUS_TRANSITION_MESSAGE,
  EMERGENCY_TRIP_NOT_FOUND_MESSAGE,
} from './emergencies.constants';
import { ListEmergenciesQueryDto, SosDto, UpdateEmergencyStatusDto } from './dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const CONDUCTOR_A = '07070707-0707-4707-8707-070707070702';
const ADMIN_A = '01010101-0101-4101-8101-010101010101';
const DRIVER_B = '07070707-0707-4707-8707-070707070703';
const TRIP_A = '09090909-0909-4909-8909-090909090901';
const TRIP_B = '09090909-0909-4909-8909-090909090902';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const ROUTE_A = '05050505-0505-4505-8505-050505050501';

/** Midday today — comfortably inside the "today" window used by the service. */
function todayNoon(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

interface Row {
  [key: string]: unknown;
}

let sequence = 0;

function makeRepository(prefix: string) {
  const rows: Row[] = [];
  /**
   * Sequelize operator keys are ES symbols (`Op.or`, `Op.in`, …), which
   * `Object.entries` silently drops — so they are folded in explicitly.
   * Ignoring them would make a stub accept rows the real query rejects.
   */
  const entriesOf = (where: Record<string, unknown>): Array<[string, unknown]> => {
    const named = Object.entries(where) as Array<[string, unknown]>;
    const symbolic = Object.getOwnPropertySymbols(where).map((symbol): [string, unknown] => [
      String(symbol).replace(/^Symbol\(|\)/g, ''),
      (where as Record<symbol, unknown>)[symbol],
    ]);
    return [...named, ...symbolic];
  };

  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    entriesOf(where).every(([key, value]) => {
      if (key === 'or') {
        // `[Op.or]` — at least one alternative must match.
        return (value as Record<string, unknown>[]).some((alternative) =>
          matches(row, alternative),
        );
      }
      const cell = row[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return entriesOf(value as Record<string, unknown>).every(([op, operand]) => {
          if (op === 'in') return (operand as unknown[]).includes(cell);
          if (op === 'gte') return (cell as Date) >= (operand as Date);
          if (op === 'lt') return (cell as Date) < (operand as Date);
          return cell === operand;
        });
      }
      return cell === value;
    });

  return {
    rows,
    repo: {
      create: async (values: Row) => {
        const row: Row = {
          id: `${prefix}-${(sequence += 1)}`,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
          ...values,
        };
        row.update = async (patch: Row) => {
          Object.assign(row, patch);
          return row;
        };
        rows.push(row);
        return row;
      },
      findOne: async (options: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, options.where)) ?? null,
      findAll: async (options: { where?: Record<string, unknown>; limit?: number } = {}) => {
        const found = rows.filter((row) => (options.where ? matches(row, options.where) : true));
        return options.limit ? found.slice(0, options.limit) : found;
      },
      findAndCountAll: async (options: {
        where?: Record<string, unknown>;
        limit?: number;
        offset?: number;
      }) => {
        const found = rows.filter((row) => (options.where ? matches(row, options.where) : true));
        const offset = options.offset ?? 0;
        return {
          rows: options.limit ? found.slice(offset, offset + options.limit) : found.slice(offset),
          count: found.length,
        };
      },
    },
  };
}

interface Harness {
  service: EmergenciesService;
  events: ReturnType<typeof makeRepository>;
  trips: ReturnType<typeof makeRepository>;
  buses: ReturnType<typeof makeRepository>;
  routes: ReturnType<typeof makeRepository>;
  users: ReturnType<typeof makeRepository>;
  broadcasts: Array<{ room: string; event: string; payload: EmergencyEventResponse }>;
}

function makeHarness(): Harness {
  sequence = 0;
  const events = makeRepository('ev');
  const trips = makeRepository('trip');
  const buses = makeRepository('bus');
  const routes = makeRepository('route');
  const users = makeRepository('user');

  trips.repo.create({
    id: TRIP_A,
    school_id: SCHOOL_A,
    route_id: ROUTE_A,
    bus_id: BUS_A,
    driver_id: DRIVER_A,
    conductor_id: CONDUCTOR_A,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: todayNoon(),
  });
  trips.repo.create({
    id: TRIP_B,
    school_id: SCHOOL_B,
    route_id: 'route-b',
    bus_id: 'bus-b',
    driver_id: DRIVER_B,
    conductor_id: null,
    status: TripStatus.IN_PROGRESS,
    scheduled_start_at: todayNoon(),
  });
  buses.repo.create({ id: BUS_A, school_id: SCHOOL_A, registration_number: 'BUS-A-1' });
  routes.repo.create({ id: ROUTE_A, school_id: SCHOOL_A, name: 'North Loop' });
  users.repo.create({
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    first_name: 'Asha',
    last_name: 'Rane',
  });
  users.repo.create({
    id: CONDUCTOR_A,
    school_id: SCHOOL_A,
    role: UserRole.CONDUCTOR,
    first_name: 'Cory',
    last_name: 'Duta',
  });
  users.repo.create({
    id: ADMIN_A,
    school_id: SCHOOL_A,
    role: UserRole.SCHOOL_ADMIN,
    first_name: 'Nina',
    last_name: 'Principal',
  });

  const service = new EmergenciesService(
    events.repo as never,
    trips.repo as never,
    buses.repo as never,
    routes.repo as never,
    users.repo as never,
  );

  const broadcasts: Harness['broadcasts'] = [];
  service.attachBroadcaster((room, event, payload) => {
    broadcasts.push({ room, event, payload });
  });

  return { service, events, trips, buses, routes, users, broadcasts };
}

const sos = (overrides: Partial<SosDto> = {}): SosDto =>
  ({
    trip_id: null,
    type: EmergencyType.ACCIDENT,
    message: null,
    latitude: null,
    longitude: null,
    accuracy: null,
    ...overrides,
  }) as SosDto;

const listQuery = (overrides: Partial<ListEmergenciesQueryDto> = {}): ListEmergenciesQueryDto =>
  ({ page: 1, limit: 20, ...overrides }) as ListEmergenciesQueryDto;

const statusBody = (
  status: EmergencyStatus,
  note: string | null = null,
): UpdateEmergencyStatusDto => ({ status, note }) as UpdateEmergencyStatusDto;

const driverActor = { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER };
const conductorActor = { id: CONDUCTOR_A, school_id: SCHOOL_A, role: UserRole.CONDUCTOR };
const adminActor = { id: ADMIN_A, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };

describe('EmergenciesService.raiseSos', () => {
  it('records an SOS against the crew member’s own trip', async () => {
    const harness = makeHarness();
    const before = Date.now();
    const event = await harness.service.raiseSos(
      driverActor,
      sos({
        trip_id: TRIP_A,
        message: 'Bus hit a divider',
        latitude: 28.6,
        longitude: 77.2,
        accuracy: 10,
      }),
    );

    assert.equal(event.school_id, SCHOOL_A);
    assert.equal(event.trip_id, TRIP_A);
    // The trip context is snapshotted, not looked up on every read.
    assert.equal(event.bus_id, BUS_A);
    assert.equal(event.route_id, ROUTE_A);
    assert.equal(event.raised_by_user_id, DRIVER_A);
    assert.equal(event.raised_by_name, 'Asha Rane');
    assert.equal(event.raised_by_role, UserRole.DRIVER);
    assert.equal(event.type, EmergencyType.ACCIDENT);
    assert.equal(event.status, EmergencyStatus.OPEN);
    assert.equal(event.latitude, 28.6);
    assert.equal(event.longitude, 77.2);

    // The event time is the server clock, never a client value.
    const triggered = new Date(event.triggered_at).getTime();
    assert.ok(triggered >= before - 1000 && triggered <= Date.now() + 1000);
  });

  it('enriches the projection with the bus and route names', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_A }));
    assert.equal(event.bus_registration_number, 'BUS-A-1');
    assert.equal(event.route_name, 'North Loop');
  });

  it('broadcasts the new event to the school’s own room only', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_A }));
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(harness.broadcasts[0].room, emergencyRoomName(SCHOOL_A));
    assert.equal(harness.broadcasts[0].event, EMERGENCY_EVENTS.new);
    assert.equal(harness.broadcasts[0].payload.id, event.id);
  });

  it('resolves the caller’s current trip when no trip id is given', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(conductorActor, sos());
    assert.equal(event.trip_id, TRIP_A);
    assert.equal(event.raised_by_role, UserRole.CONDUCTOR);
  });

  it('still records an off-duty SOS when the crew has no trip today', async () => {
    const harness = makeHarness();
    const stranger = { id: 'no-trip-user', school_id: SCHOOL_A, role: UserRole.DRIVER };
    const event = await harness.service.raiseSos(stranger, sos());
    assert.equal(event.trip_id, null);
    assert.equal(event.bus_id, null);
    assert.equal(event.route_id, null);
    assert.equal(event.status, EmergencyStatus.OPEN);
  });

  it('refuses a trip of another tenant', async () => {
    const harness = makeHarness();
    await assert.rejects(
      harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_B })),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, EMERGENCY_TRIP_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('refuses a trip the caller is not rostered on', async () => {
    const harness = makeHarness();
    const outsider = { id: 'unassigned', school_id: SCHOOL_A, role: UserRole.DRIVER };
    await assert.rejects(
      harness.service.raiseSos(outsider, sos({ trip_id: TRIP_A })),
      (error: unknown) => {
        assert.equal((error as { message: string }).message, EMERGENCY_TRIP_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('rejects a half coordinate pair instead of storing 0,0', async () => {
    const harness = makeHarness();
    await assert.rejects(
      harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_A, latitude: 28.6 })),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.message, EMERGENCY_COORDINATES_PAIR_MESSAGE);
        return true;
      },
    );
  });

  it('records an SOS with no position at all', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_A }));
    assert.equal(event.latitude, null);
    assert.equal(event.longitude, null);
  });
});

describe('EmergenciesService — reading events', () => {
  it('lists the school’s events newest first with pagination metadata', async () => {
    const harness = makeHarness();
    for (let index = 0; index < 3; index += 1) {
      await harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_A }));
    }
    const page = await harness.service.listForSchool(SCHOOL_A, listQuery({ limit: 2 }));
    assert.equal(page.items.length, 2);
    assert.equal(page.meta.total, 3);
    assert.equal(page.meta.totalPages, 2);
    assert.equal(page.meta.hasNextPage, true);
  });

  it('never returns another tenant’s events', async () => {
    const harness = makeHarness();
    await harness.service.raiseSos(driverActor, sos({ trip_id: TRIP_A }));
    const otherSchool = await harness.service.listForSchool(SCHOOL_B, listQuery());
    assert.equal(otherSchool.items.length, 0);
    assert.equal(otherSchool.meta.total, 0);
  });

  it('filters by status and type', async () => {
    const harness = makeHarness();
    await harness.service.raiseSos(driverActor, sos({ type: EmergencyType.ACCIDENT }));
    const medical = await harness.service.raiseSos(
      driverActor,
      sos({ type: EmergencyType.MEDICAL }),
    );
    await harness.service.updateStatus(
      adminActor,
      medical.id,
      statusBody(EmergencyStatus.RESOLVED),
    );

    assert.equal(
      (await harness.service.listForSchool(SCHOOL_A, listQuery({ type: EmergencyType.MEDICAL })))
        .meta.total,
      1,
    );
    assert.equal(
      (await harness.service.listForSchool(SCHOOL_A, listQuery({ status: EmergencyStatus.OPEN })))
        .meta.total,
      1,
    );
    assert.equal(
      (
        await harness.service.listForSchool(
          SCHOOL_A,
          listQuery({ status: EmergencyStatus.RESOLVED }),
        )
      ).meta.total,
      1,
    );
  });

  it('lists only the events that still need attention', async () => {
    const harness = makeHarness();
    const first = await harness.service.raiseSos(driverActor, sos());
    await harness.service.raiseSos(driverActor, sos());
    await harness.service.updateStatus(adminActor, first.id, statusBody(EmergencyStatus.RESOLVED));

    const active = await harness.service.listActive(SCHOOL_A);
    assert.equal(active.items.length, 1);
    assert.equal(active.items[0].status, EmergencyStatus.OPEN);
  });

  it('gives a crew member only their own history', async () => {
    const harness = makeHarness();
    await harness.service.raiseSos(driverActor, sos());
    await harness.service.raiseSos(conductorActor, sos());

    const mine = await harness.service.listMine(driverActor, listQuery());
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].raised_by_user_id, DRIVER_A);
  });

  it('hides another tenant’s event behind the generic not-found message', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());
    await assert.rejects(harness.service.findOne(SCHOOL_B, event.id), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, EMERGENCY_NOT_FOUND_MESSAGE);
      return true;
    });
  });
});

describe('EmergenciesService.updateStatus', () => {
  it('lets the school acknowledge and then resolve an open event', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());

    const acknowledged = await harness.service.updateStatus(
      adminActor,
      event.id,
      statusBody(EmergencyStatus.ACKNOWLEDGED, 'School van dispatched'),
    );
    assert.equal(acknowledged.status, EmergencyStatus.ACKNOWLEDGED);
    assert.ok(acknowledged.acknowledged_at);
    assert.equal(acknowledged.acknowledged_by_name, 'Nina Principal');
    assert.equal(acknowledged.resolution_note, 'School van dispatched');
    assert.equal(acknowledged.resolved_at, null);

    const resolved = await harness.service.updateStatus(
      adminActor,
      event.id,
      statusBody(EmergencyStatus.RESOLVED, 'All students safe'),
    );
    assert.equal(resolved.status, EmergencyStatus.RESOLVED);
    assert.ok(resolved.resolved_at);
    assert.equal(resolved.resolved_by_name, 'Nina Principal');
    assert.equal(resolved.resolution_note, 'All students safe');

    // Every transition is pushed to the school's room.
    assert.equal(harness.broadcasts.length, 3);
    assert.equal(harness.broadcasts[1].event, EMERGENCY_EVENTS.updated);
    assert.equal(harness.broadcasts[2].payload.status, EmergencyStatus.RESOLVED);
  });

  it('refuses to reopen or re-handle a terminal event', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());
    await harness.service.updateStatus(adminActor, event.id, statusBody(EmergencyStatus.RESOLVED));

    await assert.rejects(
      harness.service.updateStatus(adminActor, event.id, statusBody(EmergencyStatus.OPEN)),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.message, EMERGENCY_STATUS_TRANSITION_MESSAGE);
        return true;
      },
    );
  });

  it('lets a crew member retract their own alarm only', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());

    const cancelled = await harness.service.updateStatus(
      driverActor,
      event.id,
      statusBody(EmergencyStatus.CANCELLED, 'Pressed by mistake'),
      { requireOwnership: true },
    );
    assert.equal(cancelled.status, EmergencyStatus.CANCELLED);
    assert.equal(cancelled.resolution_note, 'Pressed by mistake');
  });

  it('stops a crew member from resolving on behalf of the school', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());
    await assert.rejects(
      harness.service.updateStatus(driverActor, event.id, statusBody(EmergencyStatus.RESOLVED), {
        requireOwnership: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.message, EMERGENCY_STATUS_FORBIDDEN_MESSAGE);
        return true;
      },
    );
  });

  it('hides somebody else’s event from a crew member', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());
    await assert.rejects(
      harness.service.updateStatus(
        conductorActor,
        event.id,
        statusBody(EmergencyStatus.CANCELLED),
        {
          requireOwnership: true,
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, EMERGENCY_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('hides another tenant’s event from an admin update', async () => {
    const harness = makeHarness();
    const event = await harness.service.raiseSos(driverActor, sos());
    const otherAdmin = { id: 'admin-b', school_id: SCHOOL_B, role: UserRole.SCHOOL_ADMIN };
    await assert.rejects(
      harness.service.updateStatus(otherAdmin, event.id, statusBody(EmergencyStatus.RESOLVED)),
      (error: unknown) => {
        assert.equal((error as { message: string }).message, EMERGENCY_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });
});
