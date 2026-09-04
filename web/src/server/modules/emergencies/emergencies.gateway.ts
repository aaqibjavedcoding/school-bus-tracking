import { Logger } from '../../framework';
import { JwtService } from '../../framework';
import type { Server, Socket } from 'socket.io';
import {
  EMERGENCIES_NAMESPACE,
  UserRole,
  emergencyRoomName,
  type EmergencyEventResponse,
  type EmergencySocketEvent,
} from '@school-bus-tracking/shared-types';
import type { AuthenticatedRequestUser } from '../../common/guards';
import { isAccessTokenPayloadValid } from '../../common/guards';
import { SchoolAccessService } from '../../common/access';
import { EmergenciesService } from './emergencies.service';

/**
 * Socket.IO gateway for the crew SOS feed (Task 44).
 *
 * It reuses the security model of the two existing namespaces in full — there
 * is no second authentication mechanism anywhere in the app:
 *
 * - **Handshake authentication** — the socket must present the same JWT bearer
 *   token as the HTTP API in `handshake.auth.access_token`, verified with the
 *   centrally configured `JwtService` and checked with the shared
 *   `isAccessTokenPayloadValid` rule (the exact payload contract of
 *   `JwtAuthGuard`), plus the centralized inactive-school enforcement.
 * - **Server-owned room assignment** — there is no subscribe event: after a
 *   successful handshake the server itself places the socket into the room of
 *   *its own* JWT tenant (`emergency:school:<schoolId>`). A client can never
 *   name, pick or swap a room, so listening to another school's emergencies
 *   is impossible.
 * - **Broadcast only** — the namespace carries no client commands at all. An
 *   SOS is raised over `POST /api/v1/emergencies/sos` so it is durable and
 *   auditable even if the socket is down; the gateway only pushes what the
 *   service has already persisted.
 *
 * Delivery is entirely self-hosted (Postgres + Socket.IO). No SMS, WhatsApp,
 * push vendor or any other paid third party is involved.
 */
export class EmergenciesGateway {
  /** The socket.io namespace server (Nest injects the namespace). */
  server!: Server;
  private readonly logger = new Logger(EmergenciesGateway.name);

  constructor(
    private readonly emergencies: EmergenciesService,
    private readonly jwtService: JwtService,
    // Centralized inactive-school enforcement at the socket handshake; the
    // global AccessModule injects the same instance the HTTP guard uses.
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  /** Called once the namespace is up — room broadcasts go through it. */
  afterInit(): void {
    this.emergencies.attachBroadcaster(
      (room: string, event: EmergencySocketEvent, payload: EmergencyEventResponse) => {
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
   * Handshake: verify the JWT and join the socket's own tenant room.
   *
   * Every school role that participates in the emergency flow is joined:
   * `SCHOOL_ADMIN` to receive and handle alarms, `DRIVER` / `CONDUCTOR` so
   * their own crew app reflects the state the school set (acknowledged /
   * resolved). Parents and the platform `SUPER_ADMIN` are refused — they have
   * no part in this feed.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = await this.authenticateHandshake(client);
    if (!user) {
      this.logger.warn(`Rejected unauthenticated emergency socket ${client.id}`);
      client.disconnect(true);
      return;
    }
    client.data.user = user;

    // The room is derived exclusively from the verified JWT tenant — the
    // client never names a room and cannot influence this decision.
    if (user.school_id) {
      await client.join(emergencyRoomName(user.school_id));
    }
  }

  /** Disconnect: rooms are per-socket and drop automatically. */
  handleDisconnect(_client: Socket): void {
    // No per-socket state is kept for emergencies; nothing to do.
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

    // A platform SUPER_ADMIN (null tenant) and parents have no emergency
    // feed to follow: they are refused like any unauthenticated socket.
    if (
      payload.school_id === null ||
      payload.school_id === undefined ||
      payload.role === UserRole.PARENT
    ) {
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
