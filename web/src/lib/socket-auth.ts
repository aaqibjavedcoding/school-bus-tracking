/**
 * Minimal shape of the socket handles the app drives. Declared structurally
 * so the rule can be unit-tested without opening a connection
 * (`socket.io-client` sockets satisfy it).
 */
export interface ConnectableSocket {
  connected: boolean;
  connect: () => unknown;
}

/**
 * Opens a namespace socket only when the caller actually holds an access
 * token.
 *
 * Every gateway (`/live-tracking`, `/notifications`, `/emergencies`)
 * authenticates the handshake with the in-memory JWT and disconnects sockets
 * that arrive without one, logging `Rejected unauthenticated … socket`.
 * Connecting anyway — after a logout, after a failed refresh, or from a
 * screen that mounted before the session was restored — produces exactly
 * those warnings and a socket that can never deliver anything.
 *
 * Returns true when a connection was requested, false when the caller is
 * anonymous and the socket was deliberately left closed. The server-side
 * check is untouched: this only stops the client from making a handshake it
 * already knows will be refused.
 */
export function connectSocketWithToken(
  socket: ConnectableSocket,
  accessToken: string | null,
): boolean {
  if (!accessToken) {
    return false;
  }
  if (!socket.connected) {
    socket.connect();
  }
  return true;
}
