import { io, type Socket } from 'socket.io-client';
import { NOTIFICATIONS_NAMESPACE } from '@school-bus-tracking/shared-types';
import { buildNamespaceSocketConfig } from './socket-options.ts';

/**
 * Process-wide Socket.IO client for the notifications namespace — the mobile
 * counterpart of the web service. After the authenticated handshake the
 * server itself places an authenticated PARENT socket into its own private
 * room; there is no client-driven subscribe event, so this client only ever
 * listens for `notification:new`.
 */
let socket: Socket | null = null;

export function getNotificationsSocket(): Socket {
  if (socket) {
    return socket;
  }

  const { url, options } = buildNamespaceSocketConfig(NOTIFICATIONS_NAMESPACE);
  socket = io(url, options);

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
