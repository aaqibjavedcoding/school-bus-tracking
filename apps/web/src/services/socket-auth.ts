'use client';

import { connectSocketWithToken, type ConnectableSocket } from '../lib/socket-auth';
import { getAccessToken } from './session';

export type { ConnectableSocket };

/**
 * Connects a namespace socket with the session's in-memory access token, or
 * leaves it closed when the app is anonymous.
 *
 * See `../lib/socket-auth` for the rule and why an unauthenticated handshake
 * is worth avoiding client-side.
 */
export function connectAuthenticatedSocket(socket: ConnectableSocket): boolean {
  return connectSocketWithToken(socket, getAccessToken());
}
