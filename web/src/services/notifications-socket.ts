'use client';

import { io, type Socket } from 'socket.io-client';
import { NOTIFICATIONS_NAMESPACE } from '@school-bus-tracking/shared-types';
import { getAccessToken } from './session';

/**
 * Process-wide Socket.IO client for the notifications namespace.
 *
 * Mirrors the live-tracking socket: one connection shared across the app,
 * authenticated with the same in-memory JWT bearer token at handshake time.
 * The server places an authenticated parent into its own private room —
 * the client never subscribes to anything.
 */
let socket: Socket | null = null;

export function getNotificationsSocket(): Socket {
  if (socket) {
    return socket;
  }

  socket = io(NOTIFICATIONS_NAMESPACE, {
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

export function disconnectNotificationsSocket(): void {
  if (!socket) {
    return;
  }
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
