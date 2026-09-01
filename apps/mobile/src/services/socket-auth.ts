import { getAccessToken } from './session.ts';

/**
 * Minimal shape of the socket handles this module drives. Declared
 * structurally so the rule can be unit-tested without opening a connection
 * (`socket.io-client` sockets satisfy it).
 */
export interface ConnectableSocket {
  connected: boolean;
  connect: () => unknown;
}

/**
 * Opens a namespace socket only when the app actually holds an access token.
 *
 * Mobile authenticates every namespace (`/live-tracking`, `/notifications`,
 * `/emergencies`) with the in-memory JWT in `handshake.auth.access_token`;
 * the gateways disconnect handshakes that arrive without one and log
 * `Rejected unauthenticated … socket`. Connecting while signed out — after a
 * logout, or from a screen that mounted before the session was restored —
 * only produces those warnings and a socket that can never deliver anything.
 *
 * Returns true when a connection was requested, false when the caller is
 * anonymous and the socket was deliberately left closed.
 */
export function connectAuthenticatedSocket(socket: ConnectableSocket): boolean {
  if (!getAccessToken()) {
    return false;
  }
  if (!socket.connected) {
    socket.connect();
  }
  return true;
}
