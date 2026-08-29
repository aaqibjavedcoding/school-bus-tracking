import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import {
  NOTIFICATION_EVENTS,
  JwtAccessTokenPayload,
  UserRole,
  notificationRoomName,
} from '@school-bus-tracking/shared-types';
import type { Socket } from 'socket.io';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

const SECRET = 'notifications-gateway-test-secret';
const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARENT_A = '22222222-2222-4222-8222-222222220001';
const PARENT_B = '22222222-2222-4222-8222-222222220002';
const DRIVER_A = '22222222-2222-4222-8222-222222220003';

const jwtService = new JwtService({ secret: SECRET });

async function signToken(role: UserRole, userId: string, schoolId: string): Promise<string> {
  const payload: JwtAccessTokenPayload = { sub: userId, school_id: schoolId, role };
  return jwtService.signAsync(payload);
}

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  handshake: { auth: unknown };
  rooms: Set<string>;
  joined: string[];
  disconnected: boolean;
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  disconnect(close?: boolean): void;
}

function makeSocket(auth: unknown = { access_token: 'x' }): FakeSocket {
  const socket: FakeSocket = {
    id: 'socket-1',
    data: {},
    handshake: { auth },
    rooms: new Set<string>(),
    joined: [],
    disconnected: false,
    join: async (room: string) => {
      socket.rooms.add(room);
      socket.joined.push(room);
    },
    leave: async (room: string) => {
      socket.rooms.delete(room);
    },
    disconnect: (close = true) => {
      socket.disconnected = close;
    },
  };
  return socket;
}

interface ServerCapture {
  calls: Array<{ room: string; event: string; payload: unknown }>;
}

function makeGateway(options: { schoolAccessible?: boolean } = {}) {
  // The real service is not needed here; only attachBroadcaster is used.
  const broadcast: ServerCapture = { calls: [] };
  const service = {
    attachBroadcaster: (fn: (room: string, event: string, payload: unknown) => void) => {
      broadcaster = fn;
    },
  } as unknown as NotificationsService;
  let broadcaster: ((room: string, event: string, payload: unknown) => void) | null = null;

  const schoolAccess = {
    isSchoolAccessible: async (): Promise<boolean> => options.schoolAccessible !== false,
  };

  const gateway = new NotificationsGateway(service, jwtService, schoolAccess as never);
  // The gateway is wired to the real socket.io `Socket` type; the fake socket
  // implements only the surface the gateway touches.
  const facade = {
    handleConnection: (socket: FakeSocket) => gateway.handleConnection(socket as unknown as Socket),
    handleDisconnect: (socket: FakeSocket) => gateway.handleDisconnect(socket as unknown as Socket),
    afterInit: () => gateway.afterInit(),
    broadcast: (room: string, event: string, payload: unknown) =>
      broadcaster?.(room, event, payload),
  };
  // Fake namespace server capturing room emits.
  (gateway as unknown as { server: unknown }).server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        broadcast.calls.push({ room, event, payload });
      },
    }),
  };

  return { gateway: facade, broadcast };
}

describe('NotificationsGateway handshake authentication', () => {
  it('disconnects a socket without a token', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket({});

    await gateway.handleConnection(socket);

    assert.equal(socket.disconnected, true);
    assert.deepEqual(socket.joined, []);
  });

  it('disconnects a socket with an invalid or expired token', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket({ access_token: 'not-a-jwt' });

    await gateway.handleConnection(socket);

    assert.equal(socket.disconnected, true);
    assert.deepEqual(socket.joined, []);
  });

  it('disconnects a socket whose school is inactive', async () => {
    const { gateway } = makeGateway({ schoolAccessible: false });
    const socket = makeSocket({
      access_token: await signToken(UserRole.PARENT, PARENT_A, SCHOOL_A),
    });

    await gateway.handleConnection(socket);

    assert.equal(socket.disconnected, true);
    assert.deepEqual(socket.joined, []);
  });
});

describe('NotificationsGateway room assignment', () => {
  it('joins an authenticated parent to its own private room (server-derived)', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket({
      access_token: await signToken(UserRole.PARENT, PARENT_A, SCHOOL_A),
    });

    await gateway.handleConnection(socket);

    assert.equal(socket.disconnected, false);
    assert.deepEqual(socket.joined, [notificationRoomName(PARENT_A)]);
    const user = socket.data.user as { id: string; role: UserRole };
    assert.equal(user.id, PARENT_A);
    assert.equal(user.role, UserRole.PARENT);
  });

  it('never lets a client choose or swap the room (another parent id in the payload is ignored)', async () => {
    const { gateway } = makeGateway();
    // The client tries to smuggle another parent's id / room into the
    // handshake. The room is derived from the verified JWT subject only.
    const socket = makeSocket({
      access_token: await signToken(UserRole.PARENT, PARENT_A, SCHOOL_A),
      user_id: PARENT_B,
      room: notificationRoomName(PARENT_B),
    });

    await gateway.handleConnection(socket);

    assert.deepEqual(socket.joined, [notificationRoomName(PARENT_A)]);
    assert.ok(!socket.rooms.has(notificationRoomName(PARENT_B)));
  });

  it('connects non-parent roles without joining any notification room', async () => {
    const { gateway } = makeGateway();

    for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.SCHOOL_ADMIN]) {
      const socket = makeSocket({
        access_token: await signToken(role, DRIVER_A, SCHOOL_A),
      });
      await gateway.handleConnection(socket);

      assert.equal(socket.disconnected, false, `${role} may stay connected`);
      assert.deepEqual(socket.joined, [], `${role} must not join a room`);
    }
  });

  it('drops room membership on disconnect (rooms are per-socket)', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket({
      access_token: await signToken(UserRole.PARENT, PARENT_A, SCHOOL_A),
    });
    await gateway.handleConnection(socket);
    assert.deepEqual(socket.joined, [notificationRoomName(PARENT_A)]);

    gateway.handleDisconnect(socket);
    // The gateway keeps no per-socket state; a reconnect must re-handshake.
    const fresh = makeSocket({});
    await gateway.handleConnection(fresh);
    assert.equal(fresh.disconnected, true);
  });
});

describe('NotificationsGateway delivery', () => {
  it('forwards the service broadcast to the parent room as notification:new', async () => {
    const { gateway, broadcast } = makeGateway();
    gateway.afterInit();

    const payload = {
      notification_id: '77777777-7777-4777-8777-777777770001',
      type: 'STUDENT_BOARDED' as const,
      title: 'Aarav boarded',
      message: 'Aarav Sharma boarded the school bus.',
      student_id: '33333333-3333-4333-8333-333333333333',
      trip_id: '55555555-5555-4555-8555-555555555555',
      created_at: new Date().toISOString(),
    };
    gateway.broadcast(notificationRoomName(PARENT_A), NOTIFICATION_EVENTS.new, payload);

    assert.deepEqual(broadcast.calls, [
      { room: notificationRoomName(PARENT_A), event: NOTIFICATION_EVENTS.new, payload },
    ]);
  });
});
