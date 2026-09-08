import { Logger } from '../../framework';
import type { Server, Socket } from 'socket.io';
import type { SchoolAccessService } from '../access/school-access.service';
import type { User } from '../../database/models';

/**
 * Periodic WebSocket session revalidation.
 *
 * Long-lived Socket.IO connections may outlive the authorization that
 * permitted them. This module provides a periodic check that disconnects
 * sockets whose:
 * - access token has expired since the handshake (pure in-memory check —
 *   `token_exp` is captured from the verified JWT at handshake time, so this
 *   pass costs no database round-trip)
 * - user has been deactivated (one batched query over all connected users)
 * - school has been deactivated (one query per distinct connected tenant)
 *
 * The check runs on a configurable interval (default: 5 minutes) and is
 * wired by `realtime/wireRealtimeGateways` alongside the gateway wiring —
 * the same `getContainer()` singletons, started exactly once per process.
 *
 * Disconnect semantics deliberately mirror the handshake: the socket receives
 * a `session:revoked` event with a reason and is then force-disconnected.
 * Every first-party client (web + mobile) reconnects automatically and
 * re-runs its `auth` callback, so a reconnect re-presents the *current*
 * in-memory access token — a live session is transparently re-established, a
 * revoked one is refused at the handshake exactly as a fresh connect would
 * be. Room membership never survives a disconnect, so no authorization state
 * leaks across the re-authentication.
 *
 * For single-instance deployments (no Redis), this runs in-process and only
 * sweeps its own connections. Running it in every instance of a future
 * multi-instance deployment is safe (each process sweeps its own sockets)
 * and the batched queries keep the shared database load bounded.
 */
export class WebSocketSessionRevalidation {
  private readonly logger = new Logger(WebSocketSessionRevalidation.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly server: Server,
    private readonly schoolAccess: SchoolAccessService,
    private readonly users: typeof User,
    private readonly options: {
      /** How often to revalidate (ms). Default: 5 minutes. */
      intervalMs?: number;
      /** Namespace to revalidate. Default: '/' (all). */
      namespace?: string;
      /**
       * All namespaces to revalidate. The realtime wiring passes the three
       * gateway namespaces; sockets on namespaces outside this list (and the
       * root, which hosts none) are never swept by this instance.
       */
      namespaces?: string[];
    } = {},
  ) {}

  /** The namespaces this instance sweeps. */
  private get namespaces(): string[] {
    if (this.options.namespaces && this.options.namespaces.length > 0) {
      return this.options.namespaces;
    }
    return [this.options.namespace ?? '/'];
  }

  /**
   * Starts the periodic revalidation. Idempotent: a second `start()` on an
   * already-running instance is ignored (the realtime wiring is guarded the
   * same way, so this only matters for direct callers).
   */
  start(): void {
    if (this.intervalId) {
      return;
    }
    const intervalMs = this.options.intervalMs ?? 5 * 60 * 1000;
    this.logger.log(
      `WebSocket session revalidation started (interval: ${intervalMs}ms, namespaces: ${this.namespaces.join(', ')})`,
    );

    this.intervalId = setInterval(() => {
      this.revalidate().catch((error) => {
        this.logger.error(
          `Revalidation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, intervalMs);
    // A background sweep must never be the handle keeping the process alive;
    // graceful shutdown clears it explicitly.
    this.intervalId.unref?.();
  }

  /**
   * Stops the periodic revalidation.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log('WebSocket session revalidation stopped');
    }
  }

  /** True between `start()` and `stop()`. */
  isStarted(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Performs one revalidation pass over all connected sockets.
   */
  async revalidate(): Promise<{ checked: number; disconnected: number }> {
    let checked = 0;
    let disconnected = 0;

    // Batch collect user IDs and school IDs for efficient queries.
    const socketData: Array<{
      socket: Socket;
      userId: string;
      schoolId: string | null;
      tokenExpired: boolean;
    }> = [];
    const now = Date.now();

    for (const namespace of this.namespaces) {
      const nsp = this.server.of(namespace);
      if (!nsp) {
        continue;
      }
      const sockets = await nsp.fetchSockets();
      for (const socket of sockets) {
        const data = socket.data as Record<string, unknown> | undefined;
        const user = data?.user as { id?: string; school_id?: string | null } | undefined;

        if (!user?.id) {
          continue;
        }

        // Expired access token: verified at handshake, expired since. Decided
        // purely from the stored claim — no database round-trip.
        const tokenExp = data?.token_exp;
        const tokenExpired =
          typeof tokenExp === 'number' && Number.isFinite(tokenExp) && now >= tokenExp * 1000;

        socketData.push({
          socket: socket as unknown as Socket,
          userId: user.id,
          schoolId: user.school_id ?? null,
          tokenExpired,
        });
      }
    }

    if (socketData.length === 0) {
      return { checked: 0, disconnected: 0 };
    }

    // Token-expired sockets are disconnected before any database work.
    for (const entry of [...socketData]) {
      if (entry.tokenExpired) {
        checked++;
        disconnected += this.revoke(entry.socket, 'token_expired');
      }
    }
    const pending = socketData.filter((entry) => !entry.tokenExpired);
    if (pending.length === 0) {
      return { checked, disconnected };
    }

    // Check school accessibility — one query per distinct connected tenant.
    const schoolIds = [
      ...new Set(pending.map((s) => s.schoolId).filter((id): id is string => id !== null)),
    ];
    const inactiveSchools = new Set<string>();
    try {
      for (const schoolId of schoolIds) {
        const accessible = await this.schoolAccess.isSchoolAccessible(schoolId);
        if (!accessible) {
          inactiveSchools.add(schoolId);
        }
      }
    } catch (error) {
      this.logger.warn(
        `School batch check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Skip this pass rather than disconnecting everyone.
      return { checked: pending.length, disconnected };
    }

    // Check user active status in batch.
    const userIds = [...new Set(pending.map((s) => s.userId))];
    const inactiveUsers = new Set<string>();
    try {
      const users = await this.users.findAll({
        where: { id: userIds } as never,
        attributes: ['id', 'is_active'],
      });
      for (const user of users) {
        if (user.is_active === false) {
          inactiveUsers.add(user.id);
        }
      }
      // Users not found in the database are also considered inactive.
      for (const userId of userIds) {
        if (!users.find((u) => u.id === userId)) {
          inactiveUsers.add(userId);
        }
      }
    } catch (error) {
      this.logger.warn(
        `User batch check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Skip this pass rather than disconnecting everyone.
      return { checked: pending.length, disconnected };
    }

    // Disconnect unauthorized sockets.
    for (const { socket, userId, schoolId } of pending) {
      checked++;

      if (schoolId !== null && inactiveSchools.has(schoolId)) {
        disconnected += this.revoke(socket, 'school_deactivated', schoolId);
      } else if (inactiveUsers.has(userId)) {
        disconnected += this.revoke(socket, 'user_deactivated', undefined, userId);
      }
    }

    if (disconnected > 0) {
      this.logger.log(`Revalidation complete: ${checked} checked, ${disconnected} disconnected`);
    }

    return { checked, disconnected };
  }

  /**
   * Notifies and force-disconnects one socket. Returns 1 so callers can count
   * the revocation; the emit failure of a dying socket is deliberately
   * ignored.
   */
  private revoke(
    socket: Socket,
    reason: 'token_expired' | 'school_deactivated' | 'user_deactivated',
    schoolId?: string,
    userId?: string,
  ): number {
    const detail =
      reason === 'school_deactivated'
        ? `school ${schoolId} deactivated`
        : reason === 'user_deactivated'
          ? `user ${userId} deactivated`
          : 'access token expired';
    this.logger.warn(`Disconnecting socket ${socket.id}: ${detail}`);
    socket.emit('session:revoked', { reason });
    socket.disconnect(true);
    return 1;
  }
}

/**
 * Extracts the standard `exp` claim (epoch seconds) from a *verified* JWT
 * payload so the handshake can pin the token lifetime onto the socket
 * (`socket.data.token_exp`). Gateways call this right after
 * `jwtService.verifyAsync` succeeds.
 */
export function resolveTokenExpiry(payload: unknown): number | null {
  const exp = (payload as { exp?: unknown } | null | undefined)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

/**
 * `globalThis` key holding the revalidation sweep started for this process.
 *
 * The realtime wiring registers the instance there so the custom server
 * (`server.js`) can stop it during graceful shutdown **without importing this
 * module** — `server.js` and Next's `instrumentation.ts` are separate module
 * graphs, and whichever graph wires the gateways first owns the instance.
 */
export const WEBSOCKET_SESSION_REVALIDATION_KEY = Symbol.for(
  'school-bus-tracking.websocket-session-revalidation',
);

/** Structural surface `server.js` needs at shutdown (no socket.io import). */
export interface WebSocketSessionRevalidationLike {
  stop(): void;
}

type GlobalWithRevalidation = typeof globalThis & {
  [WEBSOCKET_SESSION_REVALIDATION_KEY]?: WebSocketSessionRevalidationLike;
};

/** Registers (or clears) the process-wide sweep instance. */
export function registerWebSocketSessionRevalidation(
  instance: WebSocketSessionRevalidationLike | null,
): void {
  const globalRef = globalThis as GlobalWithRevalidation;
  if (instance) {
    globalRef[WEBSOCKET_SESSION_REVALIDATION_KEY] = instance;
  } else {
    delete globalRef[WEBSOCKET_SESSION_REVALIDATION_KEY];
  }
}

/** The sweep registered for this process, if any (shutdown seam). */
export function getRegisteredWebSocketSessionRevalidation(): WebSocketSessionRevalidationLike | null {
  return (globalThis as GlobalWithRevalidation)[WEBSOCKET_SESSION_REVALIDATION_KEY] ?? null;
}
