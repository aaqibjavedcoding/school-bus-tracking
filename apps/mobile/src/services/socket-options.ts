import { socketOrigin } from './api.ts';
import { getAccessToken } from './session.ts';

/**
 * Shared Socket.IO client configuration for both namespaces the mobile app
 * consumes (`/live-tracking`, `/notifications`).
 *
 * The builder is a pure module so the exact wiring the API gateways expect —
 * engine.io path, transports, reconnection policy and the JWT in the
 * handshake auth bag — is unit-testable without opening a connection.
 */

export type SocketTransport = 'websocket' | 'polling';

export interface NamespaceSocketAuthBag {
  access_token: string;
}

export interface NamespaceSocketConfig {
  /** `<api-origin><namespace>`, e.g. `http://localhost:3001/live-tracking`. */
  url: string;
  namespace: string;
  options: {
    path: string;
    addTrailingSlash: boolean;
    autoConnect: boolean;
    transports: SocketTransport[];
    reconnection: boolean;
    reconnectionAttempts: number;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    /** Reads the in-memory access token at handshake time, never before. */
    auth: (callback: (data: NamespaceSocketAuthBag) => void) => void;
  };
}

export function buildNamespaceSocketConfig(
  namespace: string,
  apiBaseUrl?: string,
): NamespaceSocketConfig {
  return {
    url: `${socketOrigin(apiBaseUrl)}${namespace}`,
    namespace,
    options: {
      path: '/socket.io',
      addTrailingSlash: false,
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      auth: (callback) => {
        callback({ access_token: getAccessToken() ?? '' });
      },
    },
  };
}
