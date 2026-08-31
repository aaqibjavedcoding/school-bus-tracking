import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import {
  EMERGENCY_EVENTS,
  JwtAccessTokenPayload,
  UserRole,
  emergencyRoomName,
} from '@school-bus-tracking/shared-types';
import type { Socket } from 'socket.io';
import { EmergenciesGateway } from './emergencies.gateway';
import { EmergenciesService } from './emergencies.service';

const SECRET = 'emergencies-gateway-test-secret';
const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const PARENT_A = '22222222-2222-4222-8222-222222220001';

const jwtService = new JwtService({ secret: SECRET });

async function signToken(role: UserRole, userId: string, schoolId: string | null): Promise<string> {
  const payload = { sub: userId, school_id: schoolId, role } as JwtAccessTokenPayload;
  return jwtService.signAsync(payload as unknown as object);
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

function makeGateway(options: { schoolAccessible?: boolean } = {}) {
  const calls: Array<{ room: string; event: string; payload: unknown }> = [];
  let broadcaster: ((room: string, event: string, payload: unknown) => void) | null = null;
  const service = {
    attachBroadcaster: (fn: (room: string, event: string, payload: unknown) => void) => {
      broadcaster = fn;
    },
  } as unknown as EmergenciesService;

  const schoolAccess = {
    isSchoolAccessible: async (): Promise<boolean> => options.schoolAccessible !== false,
  };

  const gateway = new EmergenciesGateway(service, jwtService, schoolAccess as never);
  (gateway as unknown as { server: unknown }).server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        calls.push({ room, event, payload });
      },
    }),
  };

  return {
    handleConnection: (socket: FakeSocket) => gateway.handleConnection(socket as unknown as Socket),
    handleDisconnect: (socket: FakeSocket) => gateway.handleDisconnect(socket as unknown as Socket),
    afterInit: () => gateway.afterInit(),
    broadcast: (room: string, event: string, payload: unknown) =>
      broadcaster?.(room, event, payload),
    calls,
  };
}

describe('EmergenciesGateway handshake authentication', () => {
  it('disconnects a socket without a token', async () => {
    const gateway = makeGateway();
    const socket = makeSocket({});
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
    assert.deepEqual(socket.joined, []);
  });

  it('disconnects a socket with an invalid or expired token', async () => {
    const gateway = makeGateway();
    const socket = makeSocket({ access_token: 'not-a-jwt' });
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
  });

  it('disconnects a socket whose school is inactive', async () => {
    const gateway = makeGateway({ schoolAccessible: false });
    const socket = makeSocket({
      access_token: await signToken(UserRole.DRIVER, DRIVER_A, SCHOOL_A),
    });
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
  });

  it('refuses the platform SUPER_ADMIN, who belongs to no tenant', async () => {
    const gateway = makeGateway();
    const socket = makeSocket({
      access_token: await signToken(UserRole.SUPER_ADMIN, 'platform', null),
    });
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
  });

  it('refuses parents — they have no part in the emergency feed', async () => {
    const gateway = makeGateway();
    const socket = makeSocket({
      access_token: await signToken(UserRole.PARENT, PARENT_A, SCHOOL_A),
    });
    await gateway.handleConnection(socket);
    assert.equal(socket.disconnected, true);
  });
});

describe('EmergenciesGateway room assignment', () => {
  it('joins crew and school admins to their own tenant room', async () => {
    const gateway = makeGateway();
    for (const role of [UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.SCHOOL_ADMIN]) {
      const socket = makeSocket({
        access_token: await signToken(role, DRIVER_A, SCHOOL_A),
      });
      await gateway.handleConnection(socket);
      assert.equal(socket.disconnected, false, `${role} may stay connected`);
      assert.deepEqual(socket.joined, [emergencyRoomName(SCHOOL_A)]);
    }
  });

  it('never lets a client choose or swap the room', async () => {
    const gateway = makeGateway();
    // A driver tries to listen to another school's emergency feed.
    const socket = makeSocket({
      access_token: await signToken(UserRole.DRIVER, DRIVER_A, SCHOOL_A),
      school_id: SCHOOL_B,
      room: emergencyRoomName(SCHOOL_B),
    });
    await gateway.handleConnection(socket);
    assert.deepEqual(socket.joined, [emergencyRoomName(SCHOOL_A)]);
    assert.ok(!socket.rooms.has(emergencyRoomName(SCHOOL_B)));
  });

  it('drops membership on disconnect — a reconnect must re-handshake', async () => {
    const gateway = makeGateway();
    const socket = makeSocket({
      access_token: await signToken(UserRole.DRIVER, DRIVER_A, SCHOOL_A),
    });
    await gateway.handleConnection(socket);
    assert.deepEqual(socket.joined, [emergencyRoomName(SCHOOL_A)]);

    gateway.handleDisconnect(socket);
    const anonymous = makeSocket({});
    await gateway.handleConnection(anonymous);
    assert.equal(anonymous.disconnected, true);
  });
});

describe('EmergenciesGateway delivery', () => {
  it('forwards the persisted event to the tenant room as emergency:new', async () => {
    const gateway = makeGateway();
    gateway.afterInit();

    const payload = { id: 'event-1', school_id: SCHOOL_A, status: 'OPEN' };
    gateway.broadcast(emergencyRoomName(SCHOOL_A), EMERGENCY_EVENTS.new, payload);

    assert.deepEqual(gateway.calls, [
      { room: emergencyRoomName(SCHOOL_A), event: EMERGENCY_EVENTS.new, payload },
    ]);
  });

  it('forwards a status change as emergency:updated', async () => {
    const gateway = makeGateway();
    gateway.afterInit();
    const payload = { id: 'event-1', school_id: SCHOOL_A, status: 'RESOLVED' };
    gateway.broadcast(emergencyRoomName(SCHOOL_A), EMERGENCY_EVENTS.updated, payload);
    assert.equal(gateway.calls[0].event, EMERGENCY_EVENTS.updated);
  });
});
