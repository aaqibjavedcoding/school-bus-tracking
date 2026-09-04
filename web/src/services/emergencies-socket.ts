'use client';

import { io, type Socket } from 'socket.io-client';
import { EMERGENCIES_NAMESPACE } from '@school-bus-tracking/shared-types';
import { getAccessToken } from './session';

/**
 * Process-wide Socket.IO client for the emergencies namespace (Task 44).
 *
 * Mirrors the notifications and live-tracking sockets: one shared connection,
 * authenticated at handshake with the same in-memory JWT bearer token. The
 * gateway places the socket into the room of *its own* tenant, so the client
 * never names a room and can never receive another school's incidents.
 *
 * The namespace is broadcast-only — raising an SOS is an HTTP call
 * (`POST /emergencies/sos`) so the event is durable even if the socket is
 * down.
 */
let socket: Socket | null = null;

export function getEmergenciesSocket(): Socket {
  if (socket) {
    return socket;
  }

  socket = io(EMERGENCIES_NAMESPACE, {
    path: '/socket.io',
    addTrailingSlash: false,
    autoConnect: false,
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    auth: (callback: (data: { access_token: string }) => void) => {
      callback({ access_token: getAccessToken() ?? '' });
    },
  });

  return socket;
}

export function disconnectEmergenciesSocket(): void {
  if (!socket) {
    return;
  }
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
