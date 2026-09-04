import { io, type Socket } from 'socket.io-client';
import { LIVE_TRACKING_NAMESPACE } from '@school-bus-tracking/shared-types';
import { buildNamespaceSocketConfig } from './socket-options.ts';

/**
 * Process-wide Socket.IO client for the live-tracking namespace (mobile
 * counterpart of the web service, adapted for React Native).
 *
 * One connection is shared across the app so moving between trip, manifest
 * and stops screens never opens a second socket. The handshake carries the
 * same JWT bearer token the HTTP API uses (`handshake.auth.access_token`);
 * room joins (`tracking:join`) are authorized per trip by the server, and
 * crew GPS fixes travel back over `trip:location:update`. Callers manage
 * their own listeners and must not disconnect the singleton unless the user
 * signs out.
 */

let socket: Socket | null = null;

export function getLiveTrackingSocket(): Socket {
  if (socket) {
    return socket;
  }

  const { url, options } = buildNamespaceSocketConfig(LIVE_TRACKING_NAMESPACE);
  socket = io(url, options);

  return socket;
}

export function isLiveTrackingSocketConnected(): boolean {
  return socket?.connected ?? false;
}

export function disconnectLiveTrackingSocket(): void {
  if (!socket) {
    return;
  }
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
