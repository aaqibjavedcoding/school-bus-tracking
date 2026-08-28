import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter for the live-tracking gateway.
 *
 * `@nestjs/websockets` v10 has no `@WebSocketOptions()` decorator and no
 * `WSAdapter` provider token, so server-level options (CORS, buffer caps,
 * keep-alive timing) are applied here and the adapter is registered once in
 * `main.ts` via `app.useWebSocketAdapter(...)`.
 *
 * - **CORS** reuses the application-wide `app.corsOrigin` policy so the
 *   tracking socket honours exactly the same origin rule as the HTTP API.
 * - **maxHttpBufferSize** caps a single client packet at 100 KiB: a GPS fix
 *   is a few hundred bytes, so anything larger is abuse, not a fix.
 * - **ping/pong timing** keeps idle sockets pruned quickly so a dead
 *   driver device cannot pin a room membership forever.
 */
export class LiveTrackingIoAdapter extends IoAdapter {
  private readonly app: INestApplicationContext | undefined;

  constructor(app?: INestApplicationContext) {
    super(app);
    this.app = app;
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const configService = this.app?.get(ConfigService);
    const corsOrigin =
      configService?.get<string>('liveTracking.corsOrigin') ??
      configService?.get<string>('app.corsOrigin') ??
      '*';
    return super.createIOServer(port, {
      cors: {
        origin: corsOrigin ?? '*',
        credentials: true,
      },
      maxHttpBufferSize: 100 * 1024,
      pingInterval: 25_000,
      pingTimeout: 30_000,
      ...options,
    } as ServerOptions);
  }
}
