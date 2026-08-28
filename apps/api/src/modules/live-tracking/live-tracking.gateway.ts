import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  LIVE_TRACKING_EVENTS,
  LIVE_TRACKING_NAMESPACE,
  TrackingJoinAck,
  TrackingLeaveAck,
  TripLocationUpdateAck,
  liveTrackingRoomName,
} from '@school-bus-tracking/shared-types';
import { getTripTrackingState, trackingJoinSchema } from '@school-bus-tracking/validation';
import type { AuthenticatedRequestUser, TenantRequestUser } from '../../common/guards';
import { isAccessTokenPayloadValid } from '../../common/guards';
import { SchoolAccessService } from '../../common/access';
import { LiveTrackingService, extractTripId } from './live-tracking.service';

/**
 * Socket.IO gateway for live GPS tracking (Phase 5).
 *
 * The gateway lives in its own namespace (`/live-tracking`) and is the only
 * entry point for real-time tracking. Security model:
 *
 * - **Handshake authentication** — every socket must present the same JWT
 *   bearer token as the HTTP API in `handshake.auth.access_token`. The token
 *   is verified with the centrally configured `JwtService` and checked with
 *   the shared `isAccessTokenPayloadValid` rule (the exact payload contract
 *   of `JwtAuthGuard`). A socket without a valid token is disconnected
 *   immediately and can never receive anything.
 * - **Room authorization** — the only broadcast target is the trip room
 *   (`trip:<tripId>`), and a socket enters it only after
 *   `LiveTrackingService.authorizeObservation` has proven that its user may
 *   observe that specific trip. Room membership is per-socket: after a
 *   reconnect the socket is a stranger again and must re-authenticate and
 *   re-join. The server never assumes a previously authorized socket stays
 *   authorized.
 * - **Payload validation** — every event body is re-validated with the
 *   strict Zod schemas; nothing a client sends is trusted (no `school_id`,
 *   no crew ids, no server timestamps).
 *
 * Rejected events never drop the connection — they return a `rejected` /
 * `denied` ack so a mobile client can surface the reason and retry.
 */
@WebSocketGateway({ namespace: LIVE_TRACKING_NAMESPACE })
export class LiveTrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /**
   * The socket.io namespace server for this gateway (Nest injects the
   * namespace, which shares the `to()` / `emit()` surface of a root server).
   */
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveTrackingGateway.name);

  constructor(
    private readonly liveTracking: LiveTrackingService,
    private readonly jwtService: JwtService,
    // Centralized inactive-school enforcement at the socket handshake; the
    // global AccessModule injects the same instance the HTTP guard uses.
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  /** Called once the namespace is up — room broadcasts go through it. */
  afterInit(): void {
    this.liveTracking.attachBroadcaster((room, event, payload) => {
      this.server.to(room).emit(event, payload);
    });
  }

  /**
   * Handshake: verify the JWT and attach the non-sensitive user claims.
   * Any failure mode (missing token, bad signature, expired token, malformed
   * claims) disconnects the socket before it can join a room or emit.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = await this.authenticateHandshake(client);
    if (!user) {
      this.logger.warn(`Rejected unauthenticated tracking socket ${client.id}`);
      client.disconnect(true);
      return;
    }
    client.data.user = user;
  }

  /**
   * Disconnect: rooms are per-socket and drop automatically, so only the
   * per-socket throttle bookkeeping is cleaned up. Authorization state is
   * intentionally *not* carried across sockets — a reconnect must pass
   * `handleConnection` and `tracking:join` again.
   */
  handleDisconnect(client: Socket): void {
    this.liveTracking.cleanupSocket(client.id);
  }

  /**
   * `tracking:join` — the only way into a trip room.
   *
   * The server re-verifies authorization for the requested trip on every
   * call (no cached "already joined" shortcut), and a terminal trip is
   * refused: its last position stays readable over REST, but a room for a
   * finished run would only deliver stale state.
   */
  @SubscribeMessage({ cmd: LIVE_TRACKING_EVENTS.join, ack: true })
  async handleJoin(client: Socket, payload: unknown): Promise<TrackingJoinAck> {
    const tripId = extractTripId(payload);
    const room = tripId ? liveTrackingRoomName(tripId) : 'unknown';

    if (!trackingJoinSchema.safeParse(payload).success) {
      return {
        status: 'denied',
        trip_id: tripId ?? 'unknown',
        room,
        reason: 'invalid_payload',
      };
    }

    const user = this.userOf(client);
    if (!user) {
      return {
        status: 'denied',
        trip_id: tripId as string,
        room,
        reason: 'unauthenticated',
      };
    }

    const auth = await this.liveTracking.authorizeObservation(user, tripId as string);
    if (!auth.ok) {
      return {
        status: 'denied',
        trip_id: tripId as string,
        room,
        reason: auth.reason,
      };
    }

    const trackingState = getTripTrackingState(auth.trip.status);
    if (trackingState === 'stopped') {
      return {
        status: 'denied',
        trip_id: tripId as string,
        room,
        reason: 'trip_not_open',
      };
    }

    await client.join(room);
    const latest = await this.liveTracking.getLatestLocationResponse(
      auth.trip.school_id,
      tripId as string,
    );

    return {
      status: 'joined',
      trip_id: tripId as string,
      room,
      trip_status: auth.trip.status,
      tracking_state: trackingState,
      latest,
    };
  }

  /** `tracking:leave` — leaving a room is always allowed for its members. */
  @SubscribeMessage({ cmd: LIVE_TRACKING_EVENTS.leave, ack: true })
  async handleLeave(client: Socket, payload: unknown): Promise<TrackingLeaveAck> {
    const tripId = extractTripId(payload);
    if (!tripId) {
      return { status: 'not_joined', trip_id: 'unknown' };
    }

    const room = liveTrackingRoomName(tripId);
    if (client.rooms.has(room)) {
      await client.leave(room);
      return { status: 'left', trip_id: tripId };
    }
    return { status: 'not_joined', trip_id: tripId };
  }

  /**
   * `trip:location:update` — one GPS fix from a crew device.
   *
   * All authorization, validation, throttling, timestamp bounds and
   * persistence happen in `LiveTrackingService.recordLocation`; the gateway
   * only maps the result to the ack. The service itself emits the accepted,
   * latest fix to the trip room, so a rejected fix never reaches anyone.
   */
  @SubscribeMessage({ cmd: LIVE_TRACKING_EVENTS.locationUpdate, ack: true })
  async handleLocationUpdate(client: Socket, payload: unknown): Promise<TripLocationUpdateAck> {
    const user = this.userOf(client);
    if (!user) {
      return {
        status: 'rejected',
        trip_id: extractTripId(payload) ?? 'unknown',
        reason: 'unauthenticated',
      };
    }

    const { ack } = await this.liveTracking.recordLocation(user, payload, {
      socketId: client.id,
    });
    return ack;
  }

  /** The tenant user claims attached during `handleConnection`, or `null`. */
  private userOf(client: Socket): TenantRequestUser | null {
    const data = client.data as Record<string, unknown> | undefined;
    const user = data?.user as Partial<TenantRequestUser> | undefined;
    if (
      user &&
      typeof user.id === 'string' &&
      user.id.length > 0 &&
      typeof user.school_id === 'string' &&
      user.school_id.length > 0 &&
      typeof user.role === 'string'
    ) {
      return user as TenantRequestUser;
    }
    return null;
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
    // tenant is deactivated, its crews/parents must not open new tracking
    // sockets. The platform SUPER_ADMIN (null school) has no tenant to
    // observe and is refused like any other non-tenant socket.
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
