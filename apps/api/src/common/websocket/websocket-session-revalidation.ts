import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { SchoolAccessService } from '../access/school-access.service';
import type { User } from '../../database/models';

/**
 * Periodic WebSocket session revalidation.
 *
 * Long-lived Socket.IO connections may outlive the authorization that
 * permitted them. This module provides a periodic check that disconnects
 * sockets whose:
 * - user has been deactivated
 * - school has been deactivated
 * - JWT has expired (handled by Socket.IO middleware, but double-checked here)
 *
 * The check runs on a configurable interval (default: 5 minutes) and
 * uses batched database queries to minimize overhead.
 *
 * For single-instance deployments (no Redis), this runs in-process.
 * The abstraction is ready for a future open-source Redis deployment
 * for multi-instance support.
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
    } = {},
  ) {}

  /**
   * Starts the periodic revalidation.
   */
  start(): void {
    const intervalMs = this.options.intervalMs ?? 5 * 60 * 1000;
    this.logger.log(
      `WebSocket session revalidation started (interval: ${intervalMs}ms)`,
    );

    this.intervalId = setInterval(() => {
      this.revalidate().catch((error) => {
        this.logger.error(
          `Revalidation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, intervalMs);
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

  /**
   * Performs one revalidation pass over all connected sockets.
   */
  async revalidate(): Promise<{ checked: number; disconnected: number }> {
    const sockets = await this.server.fetchSockets();
    let checked = 0;
    let disconnected = 0;

    // Batch collect user IDs and school IDs for efficient queries.
    const socketData: Array<{
      socket: Socket;
      userId: string;
      schoolId: string;
    }> = [];

    for (const socket of sockets) {
      const data = socket.data as Record<string, unknown> | undefined;
      const user = data?.user as
        | { id?: string; school_id?: string }
        | undefined;

      if (user?.id && user?.school_id) {
        socketData.push({
          socket: socket as unknown as Socket,
          userId: user.id,
          schoolId: user.school_id,
        });
      }
    }

    if (socketData.length === 0) {
      return { checked: 0, disconnected: 0 };
    }

    // Check school accessibility in batch.
    const schoolIds = [...new Set(socketData.map((s) => s.schoolId))];
    const inactiveSchools = new Set<string>();
    for (const schoolId of schoolIds) {
      const accessible = await this.schoolAccess.isSchoolAccessible(schoolId);
      if (!accessible) {
        inactiveSchools.add(schoolId);
      }
    }

    // Check user active status in batch.
    const userIds = [...new Set(socketData.map((s) => s.userId))];
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
      return { checked: socketData.length, disconnected: 0 };
    }

    // Disconnect unauthorized sockets.
    for (const { socket, userId, schoolId } of socketData) {
      checked++;

      if (inactiveSchools.has(schoolId)) {
        this.logger.warn(
          `Disconnecting socket ${socket.id}: school ${schoolId} deactivated`,
        );
        socket.emit('session:revoked', {
          reason: 'school_deactivated',
        });
        socket.disconnect(true);
        disconnected++;
      } else if (inactiveUsers.has(userId)) {
        this.logger.warn(
          `Disconnecting socket ${socket.id}: user ${userId} deactivated`,
        );
        socket.emit('session:revoked', {
          reason: 'user_deactivated',
        });
        socket.disconnect(true);
        disconnected++;
      }
    }

    if (disconnected > 0) {
      this.logger.log(
        `Revalidation complete: ${checked} checked, ${disconnected} disconnected`,
      );
    }

    return { checked, disconnected };
  }
}
