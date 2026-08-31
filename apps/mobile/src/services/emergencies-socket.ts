import { io, type Socket } from 'socket.io-client';
import { EMERGENCIES_NAMESPACE } from '@school-bus-tracking/shared-types';
import { buildNamespaceSocketConfig } from './socket-options.ts';

/**
 * Process-wide Socket.IO client for the emergencies namespace (Task 44) — the
 * mobile counterpart of the web service.
 *
 * One shared connection, authenticated at handshake with the same JWT bearer
 * token the HTTP API uses (`handshake.auth.access_token`). After a successful
 * handshake the gateway itself places the socket into the room of *its own*
 * tenant, so the client never names a room and can never receive another
 * school's incidents.
 *
 * The namespace is broadcast-only: raising an SOS is an HTTP call
 * (`POST /emergencies/sos`) so the event is durable even if the socket is
 * down. Callers manage their own listeners.
 */
let socket: Socket | null = null;

export function getEmergenciesSocket(): Socket {
  if (socket) {
    return socket;
  }

  const { url, options } = buildNamespaceSocketConfig(EMERGENCIES_NAMESPACE);
  socket = io(url, options);

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
