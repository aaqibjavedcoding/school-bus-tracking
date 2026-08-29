import { io, type Socket } from 'socket.io-client';
import {
  LIVE_TRACKING_NAMESPACE,
  NOTIFICATIONS_NAMESPACE,
} from '@school-bus-tracking/shared-types';
import { resolveSocketOrigin } from '../api/client';
import { getGlobalSession } from '../auth/global-session';

/**
 * Mobile Socket.IO access to the *existing* realtime infrastructure:
 *
 * - `/live-tracking` — crew GPS uploads + trip room broadcasts (same events,
 *   same ack contract as the web client).
 * - `/notifications` — parents' private notification stream.
 *
 * Authentication reuses the verified session: the handshake presents the
 * current JWT via `auth.access_token`, obtained *lazily* so every (re)connect
 * — including after a background resume — uses a fresh token. There is no
 * client-supplied school id, parent id or role anywhere on this socket; the
 * server derives all authorization from the token and the join ack.
 *
 * One socket per namespace is shared across screens so navigating never
 * doubles subscriptions; reconnect + re-join semantics live with the room
 * hooks (`src/socket/use-trip-room.ts`).
 */

export type MobileSocketNamespace = typeof LIVE_TRACKING_NAMESPACE | typeof NOTIFICATIONS_NAMESPACE;

export interface SocketHubOptions {
  /** `http(s)://host:port` of the API — sockets attach at the same origin. */
  origin: string;
  getAccessToken: () => string | null | Promise<string | null>;
  transports?: ('websocket' | 'polling')[];
}

export class SocketHub {
  private readonly sockets = new Map<MobileSocketNamespace, Socket>();

  constructor(private readonly options: SocketHubOptions) {}

  /** Lazily creates (and connects) the shared socket for a namespace. */
  socketFor(namespace: MobileSocketNamespace): Socket {
    const existing = this.sockets.get(namespace);
    if (existing) {
      if (!existing.connected) {
        existing.connect();
      }
      return existing;
    }

    const socket = io(`${this.options.origin}${namespace}`, {
      path: '/socket.io',
      // Keep Engine.IO's endpoint identical to the API's (no redirect on
      // either transport), matching the web client's configuration.
      addTrailingSlash: false,
      autoConnect: false,
      transports: this.options.transports ?? ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      // Async on purpose: the session may need to refresh the access token
      // (e.g. a cold-started background task) before the handshake.
      auth: (callback: (data: { access_token: string }) => void) => {
        void Promise.resolve(this.options.getAccessToken())
          .then((token) => callback({ access_token: token ?? '' }))
          .catch(() => callback({ access_token: '' }));
      },
    });

    this.sockets.set(namespace, socket);
    socket.connect();
    return socket;
  }

  disconnectAll(): void {
    this.sockets.forEach((socket) => {
      socket.removeAllListeners();
      socket.disconnect();
    });
    this.sockets.clear();
  }
}

let hub: SocketHub | null = null;

/** Production hub bound to the global session. */
export function getSocketHub(): SocketHub {
  if (hub) {
    return hub;
  }
  hub = new SocketHub({
    origin: resolveSocketOrigin(),
    getAccessToken: () => getGlobalSession().getFreshAccessToken(),
  });
  return hub;
}

export function disconnectAllSockets(): void {
  hub?.disconnectAll();
}

/** Test seam. */
export function __resetSocketHubForTests(): void {
  hub = null;
}
