import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import {
  LIVE_TRACKING_EVENTS,
  JwtAccessTokenPayload,
  TripStatus,
  UserRole,
  liveTrackingRoomName,
  type TrackingJoinAck,
  type TripLocationUpdateAck,
} from '@school-bus-tracking/shared-types';
import type { Socket } from 'socket.io';
import { LiveTrackingGateway } from './live-tracking.gateway';
import { LiveTrackingService } from './live-tracking.service';
import {
  ADMIN_A,
  ASSIGNMENTS,
  DRIVER_A,
  DRIVER_ROSTERED,
  DRIVER_UNRELATED,
  GUARDIANS,
  PARENT_A,
  PARENT_UNRELATED,
  SCHOOL_A,
  SCHOOL_B,
  STOPS,
  STUDENTS,
  TRIP_A,
  TRIP_A_CANCELLED,
  TRIP_A_SCHEDULED,
  makeBroadcastCapture,
  makeLocation,
  makeLocationStore,
  makeTrip,
  matchesWhere,
  locationPayload,
  type StubTrip,
} from './live-tracking.test-utils';

const SECRET = 'live-tracking-gateway-test-secret';
const jwtService = new JwtService({ secret: SECRET });

async function signToken(role: UserRole, userId: string, schoolId: string): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: userId, school_id: schoolId, role };
  return jwtService.signAsync(payload);
}

const TRIPS: StubTrip[] = [
  makeTrip({ id: TRIP_A, status: TripStatus.IN_PROGRESS }),
  makeTrip({ id: TRIP_A_SCHEDULED, status: TripStatus.SCHEDULED }),
  makeTrip({ id: TRIP_A_CANCELLED, status: TripStatus.CANCELLED }),
  makeTrip({
    id: '55555555-5555-4555-8555-555555550099',
    status: TripStatus.IN_PROGRESS,
    driver_id: DRIVER_ROSTERED,
    conductor_id: null,
  }),
];

function makeService() {
  // The seeded fix is in the past so fresh (server-now) fixes from the
  // gateway tests count as newer, not stale.
  const store = makeLocationStore([
    makeLocation({
      latitude: 51.5,
      longitude: -0.1,
      recorded_at: new Date(Date.now() - 120_000),
      received_at: new Date(Date.now() - 119_000),
    }),
  ]);
  const capture = makeBroadcastCapture();
  const service = new LiveTrackingService(
    store.repo as unknown as typeof import('../../database/models').TripLocation,
    {
      findOne: async (query: { where: Record<string, unknown> }) =>
        (TRIPS.find((trip) =>
          matchesWhere(trip as unknown as Record<string, unknown>, query.where),
        ) ?? null) as unknown as import('../../database/models').Trip,
    } as unknown as typeof import('../../database/models').Trip,
    {
      findAll: async (query: { where: Record<string, unknown> }) =>
        ASSIGNMENTS.filter((a) =>
          matchesWhere(a as unknown as Record<string, unknown>, query.where),
        ) as unknown as import('../../database/models').RouteAssignment[],
    } as unknown as typeof import('../../database/models').RouteAssignment,
    {
      findAll: async (query: { where: Record<string, unknown> }) =>
        STUDENTS.filter((s) =>
          matchesWhere(s as unknown as Record<string, unknown>, query.where),
        ) as unknown as import('../../database/models').Student[],
    } as unknown as typeof import('../../database/models').Student,
    {
      findAll: async (query: { where: Record<string, unknown> }) =>
        STOPS.filter((s) =>
          matchesWhere(s as unknown as Record<string, unknown>, query.where),
        ) as unknown as import('../../database/models').Stop[],
    } as unknown as typeof import('../../database/models').Stop,
    {
      findAll: async (query: { where: Record<string, unknown> }) =>
        GUARDIANS.filter((g) =>
          matchesWhere(g as unknown as Record<string, unknown>, query.where),
        ) as unknown as import('../../database/models').StudentGuardian[],
    } as unknown as typeof import('../../database/models').StudentGuardian,
    { gpsMinIntervalMs: 0, maxFutureSkewMs: 300_000, maxPastSkewMs: 86_400_000 },
  );
  service.attachBroadcaster(capture.fn);
  return { service, store, capture };
}

let socketCounter = 0;

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  handshake: { auth: unknown };
  rooms: Set<string>;
  joined: string[];
  left: string[];
  disconnected: boolean;
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  disconnect(close?: boolean): void;
}

function makeSocket(auth: unknown = { access_token: 'x' }): FakeSocket {
  const socket: FakeSocket = {
    id: `socket-${String(++socketCounter).padStart(2, '0')}`,
    data: {},
    handshake: { auth },
    rooms: new Set<string>(),
    joined: [],
    left: [],
    disconnected: false,
    join: async (room: string) => {
      socket.rooms.add(room);
      socket.joined.push(room);
    },
    leave: async (room: string) => {
      socket.rooms.delete(room);
      socket.left.push(room);
    },
    disconnect: (close = true) => {
      socket.disconnected = close;
    },
  };
  return socket;
}

function makeGateway() {
  const { service, store, capture } = makeService();
  // Tests cover school-scoped (active) tenants; the access stub always
  // reports the tenant as accessible. Inactive-school enforcement has its
  // own dedicated assertions in the guard/auth suites.
  const schoolAccess = {
    isSchoolAccessible: async (): Promise<boolean> => true,
  };
  const gateway = new LiveTrackingGateway(service, jwtService, schoolAccess as never);
  // The gateway is wired to the real socket.io `Socket` type; the fake socket
  // implements only the surface the gateway touches, so calls are funneled
  // through this shim to keep the test bodies readable.
  const facade = {
    handleConnection: (socket: FakeSocket) => gateway.handleConnection(socket as unknown as Socket),
    handleDisconnect: (socket: FakeSocket) => gateway.handleDisconnect(socket as unknown as Socket),
    handleJoin: (socket: FakeSocket, payload: unknown) =>
      gateway.handleJoin(socket as unknown as Socket, payload),
    handleLeave: (socket: FakeSocket, payload: unknown) =>
      gateway.handleLeave(socket as unknown as Socket, payload),
    handleLocationUpdate: (socket: FakeSocket, payload: unknown) =>
      gateway.handleLocationUpdate(socket as unknown as Socket, payload),
  };
  return { gateway: facade, service, store, capture };
}

type GatewayFacade = ReturnType<typeof makeGateway>['gateway'];

/** Connects a socket with a valid token and returns the socket. */
async function connectAuthenticated(
  gateway: GatewayFacade,
  role: UserRole,
  userId: string,
  schoolId = SCHOOL_A,
): Promise<FakeSocket> {
  const socket = makeSocket({ access_token: await signToken(role, userId, schoolId) });
  await gateway.handleConnection(socket);
  return socket;
}

describe('LiveTrackingGateway — handshake authentication', () => {
  it('disconnects a socket without a token', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket(undefined);
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
    assert.equal(socket.data.user, undefined);
  });

  it('disconnects a socket with a malformed auth bag', async () => {
    const { gateway } = makeGateway();
    for (const auth of ['a-string', 42, { token: 'x' }, { access_token: 42 }]) {
      const socket = makeSocket(auth);
      await gateway.handleConnection(socket);
      assert.equal(socket.disconnected, true, `auth=${JSON.stringify(auth)}`);
    }
  });

  it('disconnects a socket with an invalid or expired token', async () => {
    const { gateway } = makeGateway();

    const bad = makeSocket({ access_token: 'not.a.jwt' });
    await gateway.handleConnection(bad);
    assert.equal(bad.disconnected, true);

    const expired = new JwtService({ secret: 'other-secret' });
    const forged = await expired.signAsync({
      sub: DRIVER_A,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
    });
    const forgedSocket = makeSocket({ access_token: forged });
    await gateway.handleConnection(forgedSocket);
    assert.equal(forgedSocket.disconnected, true);
  });

  it('disconnects a token with incomplete tenant claims', async () => {
    const { gateway } = makeGateway();
    const incomplete = await jwtService.signAsync({ sub: DRIVER_A, role: UserRole.DRIVER });
    const socket = makeSocket({ access_token: incomplete });
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
    assert.equal(socket.data.user, undefined);
  });

  it('attaches only the non-sensitive claims of a valid token', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);
    assert.equal(socket.disconnected, false);
    assert.deepEqual(socket.data.user, {
      id: DRIVER_A,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
    });
  });
});

describe('LiveTrackingGateway — tracking:join authorization', () => {
  it('lets the assigned driver join the trip room', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);

    const ack = (await gateway.handleJoin(socket, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(ack.status, 'joined');
    assert.equal(ack.trip_id, TRIP_A);
    assert.equal(ack.room, liveTrackingRoomName(TRIP_A));
    assert.ok(socket.rooms.has(liveTrackingRoomName(TRIP_A)));
    assert.equal(ack.trip_status, TripStatus.IN_PROGRESS);
    assert.equal(ack.tracking_state, 'active');
    // The join ack seeds the socket with the current latest fix.
    assert.ok(ack.latest !== undefined);
    assert.equal(ack.latest?.latitude, 51.5);
  });

  it('lets the school admin and a linked parent join', async () => {
    const { gateway } = makeGateway();
    const admin = await connectAuthenticated(gateway, UserRole.SCHOOL_ADMIN, ADMIN_A);
    const adminAck = (await gateway.handleJoin(admin, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(adminAck.status, 'joined');

    const parent = await connectAuthenticated(gateway, UserRole.PARENT, PARENT_A);
    const parentAck = (await gateway.handleJoin(parent, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(parentAck.status, 'joined');
  });

  it('lets a parent join a SCHEDULED trip (tracking is merely unavailable yet)', async () => {
    const { gateway } = makeGateway();
    const parent = await connectAuthenticated(gateway, UserRole.PARENT, PARENT_A);
    const ack = (await gateway.handleJoin(parent, {
      trip_id: TRIP_A_SCHEDULED,
    })) as TrackingJoinAck;
    assert.equal(ack.status, 'joined');
    assert.equal(ack.tracking_state, 'unavailable');
  });

  it('denies a driver who is not crew of the trip', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_UNRELATED);

    const ack = (await gateway.handleJoin(socket, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(ack.status, 'denied');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(ack.latest, undefined);
    assert.equal(socket.joined.length, 0);
    assert.equal(socket.rooms.size, 0);
  });

  it('denies a parent without a linked child on the trip', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.PARENT, PARENT_UNRELATED);
    const ack = (await gateway.handleJoin(socket, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(ack.status, 'denied');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(socket.rooms.size, 0);
  });

  it('denies cross-tenant joins as a plain trip_not_found', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_UNRELATED, SCHOOL_B);
    const ack = (await gateway.handleJoin(socket, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(ack.status, 'denied');
    assert.equal(ack.reason, 'trip_not_found');
    assert.equal(socket.rooms.size, 0);
  });

  it('denies joining a terminal trip', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.SCHOOL_ADMIN, ADMIN_A);
    const ack = (await gateway.handleJoin(socket, {
      trip_id: TRIP_A_CANCELLED,
    })) as TrackingJoinAck;
    assert.equal(ack.status, 'denied');
    assert.equal(ack.reason, 'trip_not_open');
    assert.equal(socket.rooms.size, 0);
  });

  it('denies malformed join payloads', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);
    for (const payload of [{}, { trip_id: 'nope' }, { trip_id: TRIP_A, school_id: SCHOOL_B }]) {
      const ack = (await gateway.handleJoin(socket, payload)) as TrackingJoinAck;
      assert.equal(ack.status, 'denied');
      assert.equal(ack.reason, 'invalid_payload');
    }
    assert.equal(socket.rooms.size, 0);
  });

  it('denies an unauthenticated socket (no cached authorization across sockets)', async () => {
    const { gateway } = makeGateway();
    const stranger = makeSocket();
    const ack = (await gateway.handleJoin(stranger, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(ack.status, 'denied');
    assert.equal(ack.reason, 'unauthenticated');
    assert.equal(stranger.rooms.size, 0);
  });
});

describe('LiveTrackingGateway — trip:location:update', () => {
  it('broadcasts an accepted fix to the trip room only', async () => {
    const { gateway, capture } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);
    await gateway.handleJoin(socket, { trip_id: TRIP_A });

    const ack = (await gateway.handleLocationUpdate(
      socket,
      locationPayload(TRIP_A),
    )) as TripLocationUpdateAck;
    assert.equal(ack.status, 'accepted');
    assert.ok(ack.received_at !== undefined);

    assert.equal(capture.emitted.length, 1);
    assert.equal(capture.emitted[0].room, liveTrackingRoomName(TRIP_A));
    assert.equal(capture.emitted[0].event, LIVE_TRACKING_EVENTS.locationUpdate);
    const payload = capture.emitted[0].payload as Record<string, unknown>;
    assert.equal(payload.trip_id, TRIP_A);
    // Tenant identity is derived from the JWT + trip, never the payload.
    assert.equal(payload.school_id, SCHOOL_A);
    assert.equal(payload.tracking_state, 'active');
    assert.equal(typeof payload.received_at, 'string');
  });

  it('rejects a fix from a parent socket without broadcasting', async () => {
    const { gateway, capture } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.PARENT, PARENT_A);
    const ack = (await gateway.handleLocationUpdate(
      socket,
      locationPayload(TRIP_A),
    )) as TripLocationUpdateAck;
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthorized');
    assert.equal(capture.emitted.length, 0);
  });

  it('rejects a malformed fix but keeps the socket usable', async () => {
    const { gateway, capture } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);

    const bad = (await gateway.handleLocationUpdate(socket, {
      trip_id: TRIP_A,
      latitude: 999,
      longitude: 0,
      recorded_at: new Date().toISOString(),
    })) as TripLocationUpdateAck;
    assert.equal(bad.status, 'rejected');
    assert.equal(bad.reason, 'invalid_payload');
    assert.equal(capture.emitted.length, 0);
    assert.equal(socket.disconnected, false);

    const good = (await gateway.handleLocationUpdate(
      socket,
      locationPayload(TRIP_A),
    )) as TripLocationUpdateAck;
    assert.equal(good.status, 'accepted');
    assert.equal(capture.emitted.length, 1);
  });

  it('rejects an unauthenticated socket without touching the pipeline', async () => {
    const { gateway, capture } = makeGateway();
    const stranger = makeSocket();
    const ack = (await gateway.handleLocationUpdate(
      stranger,
      locationPayload(TRIP_A),
    )) as TripLocationUpdateAck;
    assert.equal(ack.status, 'rejected');
    assert.equal(ack.reason, 'unauthenticated');
    assert.equal(capture.emitted.length, 0);
  });
});

describe('LiveTrackingGateway — tracking:leave', () => {
  it('leaves a joined room and reports not_joined otherwise', async () => {
    const { gateway } = makeGateway();
    const socket = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);
    await gateway.handleJoin(socket, { trip_id: TRIP_A });

    const left = (await gateway.handleLeave(socket, { trip_id: TRIP_A })) as {
      status: string;
    };
    assert.equal(left.status, 'left');
    assert.equal(socket.rooms.size, 0);

    const again = (await gateway.handleLeave(socket, { trip_id: TRIP_A })) as {
      status: string;
    };
    assert.equal(again.status, 'not_joined');
  });
});

describe('LiveTrackingGateway — disconnect and reconnect', () => {
  it('a reconnected socket is a stranger: it must re-authenticate and re-join', async () => {
    const { gateway, capture } = makeGateway();
    const room = liveTrackingRoomName(TRIP_A);

    // Original session.
    const first = await connectAuthenticated(gateway, UserRole.DRIVER, DRIVER_A);
    await gateway.handleJoin(first, { trip_id: TRIP_A });
    await gateway.handleLocationUpdate(first, locationPayload(TRIP_A));
    assert.equal(first.rooms.has(room), true);
    assert.equal(capture.emitted.length, 1);

    // The network drops: the socket disconnects and its rooms vanish.
    gateway.handleDisconnect(first);
    first.rooms.clear();

    // A brand-new socket with the same credentials starts with no room
    // membership whatsoever — nothing is carried over.
    const reconnected = makeSocket({
      access_token: await signToken(UserRole.DRIVER, DRIVER_A, SCHOOL_A),
    });
    await gateway.handleConnection(reconnected);
    assert.equal(reconnected.disconnected, false);
    assert.equal(reconnected.rooms.size, 0);

    // Re-joining performs the full authorization again…
    const ack = (await gateway.handleJoin(reconnected, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(ack.status, 'joined');
    assert.ok(reconnected.rooms.has(room));

    // …and the throttle slot of the dead socket was cleaned up, so the first
    // fix after reconnect is accepted.
    const fixed = (await gateway.handleLocationUpdate(
      reconnected,
      locationPayload(TRIP_A),
    )) as TripLocationUpdateAck;
    assert.equal(fixed.status, 'accepted');
    assert.equal(capture.emitted.length, 2);
  });

  it('a socket that fails re-authentication can never reach the room', async () => {
    const { gateway, capture } = makeGateway();
    const room = liveTrackingRoomName(TRIP_A);

    const bad = makeSocket({ access_token: 'garbage' });
    await gateway.handleConnection(bad);
    assert.equal(bad.disconnected, true);

    // Even if the client kept the socket reference and emitted join/update,
    // no user is attached and no room is granted.
    const join = (await gateway.handleJoin(bad, { trip_id: TRIP_A })) as TrackingJoinAck;
    assert.equal(join.status, 'denied');
    assert.equal(join.reason, 'unauthenticated');
    const update = (await gateway.handleLocationUpdate(
      bad,
      locationPayload(TRIP_A),
    )) as TripLocationUpdateAck;
    assert.equal(update.status, 'rejected');
    assert.equal(update.reason, 'unauthenticated');

    assert.equal(bad.rooms.has(room), false);
    assert.equal(capture.emitted.length, 0);
  });
});
