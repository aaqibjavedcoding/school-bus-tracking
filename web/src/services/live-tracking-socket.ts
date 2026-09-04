import { io, type Socket } from 'socket.io-client';
import { LIVE_TRACKING_NAMESPACE } from '@school-bus-tracking/shared-types';
import { getAccessToken } from './session';

/**
 * Process-wide Socket.IO client for the live-tracking namespace.
 *
 * One connection is shared across the app so navigating between tracking
 * screens cannot open a second socket. Callers join/leave rooms and must
 * remove their own listeners on unmount; they must not disconnect the
 * singleton unless the user is signing out.
 */

let socket: Socket | null = null;

export function getLiveTrackingSocket(): Socket {
  if (socket) {
    return socket;
  }

  socket = io(LIVE_TRACKING_NAMESPACE, {
    path: '/socket.io',
    // Next's rewrite normalizes trailing slashes. Use the same no-slash
    // Engine.IO endpoint on both sides so polling and WebSocket transports
    // are not redirected by the web server.
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

export function disconnectLiveTrackingSocket(): void {
  if (!socket) {
    return;
  }
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
