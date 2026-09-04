import { Logger } from '../../framework';
import { JwtService } from '../../framework';
import type { Server, Socket } from 'socket.io';
import {
  NOTIFICATIONS_NAMESPACE,
  UserRole,
  notificationRoomName,
  type NotificationEvent,
  type NotificationRealtimeEvent,
} from '@school-bus-tracking/shared-types';
import type { AuthenticatedRequestUser } from '../../common/guards';
import { isAccessTokenPayloadValid } from '../../common/guards';
import { SchoolAccessService } from '../../common/access';
import { NotificationsService } from './notifications.service';

/**
 * Socket.IO gateway for parent notifications (Task 21).
 *
 * The gateway lives in its own namespace (`/notifications`) and reuses the
 * live-tracking security model in full — there is no second authentication
 * mechanism:
 *
 * - **Handshake authentication** — the socket must present the same JWT
 *   bearer token as the HTTP API in `handshake.auth.access_token`. The token
 *   is verified with the centrally configured `JwtService` and checked with
 *   the shared `isAccessTokenPayloadValid` rule (the exact payload contract
 *   of `JwtAuthGuard`), plus the same centralized inactive-school enforcement.
 *   A socket without a valid token is disconnected immediately.
 * - **Server-owned room assignment** — there is no subscribe event at all.
 *   After a successful handshake the server itself places an authenticated
 *   `PARENT` socket into the private room of *its own* JWT subject
 *   (`notification:user:<sub>`). A client can never name, pick or swap a
 *   room, so subscribing to another parent's notification room is impossible.
 *   Non-parent roles connect but are never joined to any room, so nothing is
 *   ever delivered to them.
 * - **Per-socket membership** — rooms are per-socket: after a reconnect the
 *   socket must pass the handshake again, and room membership never survives
 *   a disconnect.
 */
export class NotificationsGateway {
  /**
   * The socket.io namespace server for this gateway (Nest injects the
   * namespace, which shares the `to()` / `emit()` surface of a root server).
   */
  server!: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly jwtService: JwtService,
    // Centralized inactive-school enforcement at the socket handshake; the
    // global AccessModule injects the same instance the HTTP guard uses.
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  /** Called once the namespace is up — room broadcasts go through it. */
  afterInit(): void {
    this.notifications.attachBroadcaster(
      (room: string, event: NotificationEvent, payload: NotificationRealtimeEvent) => {
        // Headless boots (smoke scripts) may never wire a socket server;
        // skipping delivery there keeps the REST flows fully functional.
        if (!this.server) {
          return;
        }
        this.server.to(room).emit(event, payload);
      },
    );
  }

  /**
   * Handshake: verify the JWT and — for parents only — join the socket's own
   * private notification room. Any authentication failure disconnects the
   * socket before it can receive anything.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = await this.authenticateHandshake(client);
    if (!user) {
      this.logger.warn(`Rejected unauthenticated notification socket ${client.id}`);
      client.disconnect(true);
      return;
    }
    client.data.user = user;

    // The room is derived exclusively from the verified JWT subject — the
    // client never names a room and cannot influence this decision.
    if (user.role === UserRole.PARENT) {
      await client.join(notificationRoomName(user.id));
    }
  }

  /**
   * Disconnect: rooms are per-socket and drop automatically, so there is no
   * per-socket bookkeeping to clean up. Authorization state is intentionally
   * *not* carried across sockets — a reconnect must pass the handshake again.
   */
  handleDisconnect(_client: Socket): void {
    // No per-socket state is kept for notifications; nothing to do.
  }

  /** Verifies the handshake token and returns the non-sensitive claims. */
  private async authenticateHandshake(client: Socket): Promise<AuthenticatedRequestUser | null> {
    const token = extractHandshakeToken(client.handshake.auth);
    if (!token) {
      return null;
    }

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      // Bad signature, expired or malformed — indistinguishable on purpose.
      return null;
    }

    if (!isAccessTokenPayloadValid(payload)) {
      return null;
    }

    // Centralized lifecycle enforcement mirrors the HTTP JwtAuthGuard: once a
    // tenant is deactivated, its parents must not open new notification
    // sockets. The platform SUPER_ADMIN (null school) has no tenant to
    // receive notifications for and is refused like any other non-tenant
    // socket.
    if (payload.school_id === null || payload.school_id === undefined) {
      return null;
    }
    const accessible = await this.schoolAccess.isSchoolAccessible(payload.school_id);
    if (!accessible) {
      return null;
    }

    return {
      id: payload.sub,
      school_id: payload.school_id,
      role: payload.role,
    };
  }
}

/** The access token carried in the Socket.IO handshake auth bag, if any. */
function extractHandshakeToken(auth: unknown): string | null {
  if (typeof auth !== 'object' || auth === null) {
    return null;
  }
  const token = (auth as Record<string, unknown>).access_token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}
