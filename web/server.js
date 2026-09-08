/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Custom Next.js server.
 *
 * Next's own `next start` cannot host a Socket.IO server, so the HTTP server
 * is created here and Next is asked to handle everything that is not
 * `/api/*` or `/socket.io/*`.
 *
 * Responsibilities, in order:
 *
 * 1. **Express middleware on `/api/*` only** — CORS, compression, security
 *    headers, cookie parsing and request-id. Next owns its own responses
 *    (HTML, RSC payloads, static assets) and must not have these applied, so
 *    the chain is deliberately scoped to the API prefix. This mirrors the old
 *    `main.ts`, which only ever served the API.
 * 2. **Socket.IO** with exactly the options the old `LiveTrackingIoAdapter`
 *    applied. The io server is published on `globalThis` so that
 *    `instrumentation.ts` — which runs inside Next's module graph, and
 *    therefore shares the route handlers' service singletons — can attach the
 *    gateways to it. Wiring them here instead would create a second, separate
 *    copy of every service and broadcasts triggered by REST calls would
 *    silently go nowhere.
 * 3. **Fail fast** if any Sequelize model class is still detached, turning a
 *    login-time `Model not initialized` 500 into a clear startup error.
 */
const http = require('node:http');
const path = require('node:path');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? process.env.APP_PORT ?? 3001);
const hostname = process.env.HOST ?? '0.0.0.0';

async function main() {
  require('dotenv').config();

  // The backend is compiled to CommonJS by `npm run build:server`; `next build`
  // marks the same tree external and points at this output, so the custom
  // server, the route handlers and the gateways all load one copy of every
  // module — and therefore one Sequelize model registry.
  //
  // `dist` is therefore a build artefact the route handlers depend on at
  // runtime, and it can silently fall behind `src/server` (a `git pull` that
  // adds a module, a branch switch, an edit without `build:server`). A partial
  // tree does NOT fail at boot: the server starts, login works, and the first
  // route that requires a missing module throws `Cannot find module
  // '…/dist/api/<x>'` *inside* the handler — before the JSON error envelope —
  // so Next answers with its generic 500 page and the UI shows that raw
  // payload instead of, say, the dashboard. Verify (and, in dev, repair) the
  // tree up front so it either runs the current code or fails loudly here.
  const serverDist = path.join(__dirname, 'dist');
  const { ensureServerBuild } = require('./server-build-check');
  const buildCheck = ensureServerBuild({
    webDir: __dirname,
    dev,
    log: (message) => console.log(`[ServerBuild] ${message}`),
  });
  if (buildCheck.rebuilt) {
    console.log('[ServerBuild] web/dist is now in sync with src/server.');
  }

  const { getContainer } = require(path.join(serverDist, 'container'));
  const { resolveCorsPolicy } = require(path.join(serverDist, 'common/security'));
  const { createApiMiddlewareChain, isApiPath } = require(
    path.join(serverDist, 'http/api-middleware-chain'),
  );
  const { parseOriginList } = require(path.join(serverDist, 'config'));
  const { Logger } = require(path.join(serverDist, 'framework'));
  const { bootstrapDatabase } = require(path.join(serverDist, 'database/bootstrap'));
  const { RetentionWorker } = require(path.join(serverDist, 'workers'));
  const { startRetentionScheduler, stopRegisteredRetentionScheduler } = require(
    path.join(serverDist, 'workers/retention.scheduler'),
  );

  const logger = new Logger('Bootstrap');
  const container = getContainer();
  const configService = container.config();

  const apiPrefix = configService.get('app.apiPrefix') ?? 'api/v1';

  // --- connect PostgreSQL and register every Sequelize model ----------------
  // Nothing else in this file (nor any route handler, nor the realtime
  // gateways wired further down) may touch a model before this resolves:
  // Sequelize model classes are static, so until `addModels` runs they are
  // detached and every query throws `Model not initialized`. The old Nest
  // bootstrap did this inside `DatabaseModule.forRoot()`; the plain-TypeScript
  // replacement exposes it as `bootstrapDatabase()`, which this entry point is
  // responsible for awaiting.
  //
  // Idempotent — it reuses `container.sequelize` when already connected.
  // The returned connection is what the retention scheduler below runs on.
  const sequelize = await bootstrapDatabase();

  // Explicit, allowlisted CORS. `resolveCorsPolicy` throws in production when
  // the allowlist is missing or wildcarded, so a misconfigured deployment
  // fails to boot instead of serving a wide-open API.
  const corsPolicy = resolveCorsPolicy({
    isProduction: configService.get('security.isProduction') ?? false,
    corsOrigins: configService.get('security.corsOrigins') ?? [],
    credentials: configService.get('security.corsCredentials') ?? true,
  });

  const app = next({ dev, dir: __dirname });
  const handle = app.getRequestHandler();
  await app.prepare();

  // --- the `/api/*` middleware chain -------------------------------------
  // CORS → compression → security headers → cookie parsing → request-id.
  // The chain lives in `src/server/http/api-middleware-chain.ts` — shared
  // verbatim with the E2E test harness, so the suites exercise exactly this
  // pipeline — and is built from configuration, never inline.
  const chain = createApiMiddlewareChain(corsPolicy, configService);

  const server = http.createServer((req, res) => {
    if (!isApiPath(req.url, apiPrefix)) {
      handle(req, res);
      return;
    }

    chain
      .run(req, res)
      .then((outcome) => {
        // A middleware may have already answered (CORS preflight, a blocked
        // origin); in that case Next must not also write to the socket.
        if (outcome === 'continue') {
          handle(req, res);
        }
      })
      .catch((error) => {
        logger.error(`API middleware failed: ${error?.message ?? String(error)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        if (!res.writableEnded) {
          res.end(
            JSON.stringify({
              success: false,
              error: { code: 'HTTP_500', message: 'Internal server error', details: null },
              timestamp: new Date().toISOString(),
            }),
          );
        }
      });
  });

  // --- Socket.IO ----------------------------------------------------------
  // The socket server honours exactly the same allowlist as the HTTP API: an
  // explicit `liveTracking.corsOrigin` override wins, otherwise the validated
  // `CORS_ORIGIN` allowlist is reused (production therefore rejects a
  // wildcard here too).
  const override = parseOriginList(configService.get('liveTracking.corsOrigin'));
  const configured =
    override.length > 0 ? override : (configService.get('security.corsOrigins') ?? []);
  const socketPolicy = resolveCorsPolicy({
    isProduction: configService.get('security.isProduction') ?? false,
    corsOrigins: configured,
    credentials: configService.get('security.corsCredentials') ?? true,
  });

  const { Server: IoServer } = require('socket.io');
  const io = new IoServer(server, {
    cors: {
      origin: socketPolicy.allowAll ? '*' : socketPolicy.origins,
      credentials: socketPolicy.credentials,
    },
    // Keep Engine.IO's endpoint at `/socket.io` without a trailing slash;
    // trailing-slash redirects break both WebSocket handshakes and the
    // polling fallback.
    addTrailingSlash: false,
    maxHttpBufferSize: 100 * 1024,
    pingInterval: 25_000,
    pingTimeout: 30_000,
  });

  // Published for `instrumentation.ts`, which wires the gateways from inside
  // Next's module graph so they share the route handlers' service singletons.
  globalThis.__socketIoServer = io;

  // Some deployments run instrumentation before the server finishes booting;
  // wiring is idempotent, so attaching here as well is safe and covers the
  // case where `register()` ran before the io server existed.
  try {
    const { wireRealtimeGateways } = require(path.join(serverDist, 'realtime'));
    wireRealtimeGateways(io);
  } catch (error) {
    logger.warn(`Deferred realtime wiring to instrumentation: ${error?.message ?? String(error)}`);
  }

  // --- fail fast on detached models --------------------------------------
  // Turns what would otherwise be a login-time `Model not initialized` 500
  // into a clear startup error. `DB_ALLOW_NO_CONNECT=true` is the same
  // stubbed-bootstrap escape hatch the smoke scripts use and must never be
  // set for a real deployment.
  const { models } = require(path.join(serverDist, 'database/models'));
  const uninitialized =
    process.env.DB_ALLOW_NO_CONNECT === 'true'
      ? []
      : models.filter((model) => !model.isInitialized).map((model) => model.name);
  if (uninitialized.length > 0) {
    throw new Error(
      `Database models were not initialized (${uninitialized.join(
        ', ',
      )}). Start the server with database connectivity enabled; DB_AUTO_CONNECT=false is only for stubbed tests/smoke scripts.`,
    );
  }

  // --- background retention worker ---------------------------------------
  // Schedules the data-retention cleanup (GPS locations, notifications,
  // refresh tokens, audit logs, resolved emergencies, expired idempotency
  // keys) inside this process. The scheduler is idempotent (one instance per
  // process, enforced again via a globalThis guard), keeps the configured
  // cadence (`RETENTION_INTERVAL_MS`, first pass after
  // `RETENTION_INITIAL_DELAY_MS`), never lets a failed pass crash the server,
  // and relies on the worker's PostgreSQL advisory lock so multiple instances
  // never double-delete. Stubbed bootstraps (`sequelize === null`) never
  // schedule it.
  startRetentionScheduler(
    { configService, sequelize },
    new RetentionWorker(configService, sequelize),
  );

  server.listen(port, hostname, () => {
    logger.log(`Application is running on: http://${hostname}:${port}`);
    logger.log(`API available at: http://${hostname}:${port}/${apiPrefix}`);
    logger.log(`Health endpoint available at: http://${hostname}:${port}/${apiPrefix}/health`);
  });

  // --- graceful shutdown ---------------------------------------------------
  // SIGTERM/SIGINT (container stop, `kill`, Ctrl-C): stop the background
  // timers first, then disconnect the Socket.IO clients, stop accepting HTTP
  // connections and close the database pool. A force-exit timer bounds the
  // wait so a stuck keep-alive connection can never hang the container.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log(`${signal} received — starting graceful shutdown`);
    const forceExit = setTimeout(() => {
      logger.warn('Graceful shutdown timed out — forcing exit.');
      process.exit(0);
    }, 10_000);
    if (typeof forceExit.unref === 'function') {
      forceExit.unref();
    }

    // 1. Background workers/timers.
    try {
      await stopRegisteredRetentionScheduler();
    } catch (error) {
      logger.error(`Retention scheduler stop failed: ${error?.message ?? String(error)}`);
    }
    try {
      const { getRegisteredWebSocketSessionRevalidation } = require(
        path.join(serverDist, 'common/websocket/websocket-session-revalidation'),
      );
      getRegisteredWebSocketSessionRevalidation()?.stop();
    } catch {
      // Realtime (and its sweep) may never have been wired in this process.
    }

    // 2. Realtime: close the Socket.IO server (also closes the HTTP server).
    try {
      const io = globalThis.__socketIoServer;
      if (io) {
        await new Promise((resolve) => io.close(() => resolve()));
      }
    } catch (error) {
      logger.error(`Socket.IO close failed: ${error?.message ?? String(error)}`);
    }

    // 3. HTTP listener (no-op when Socket.IO already closed it).
    try {
      if (server.listening) {
        await new Promise((resolve) => {
          server.closeIdleConnections?.();
          server.close(() => resolve());
        });
      }
    } catch (error) {
      logger.error(`HTTP server close failed: ${error?.message ?? String(error)}`);
    }

    // 4. Database pool.
    try {
      if (sequelize) {
        await sequelize.close();
      }
    } catch (error) {
      logger.error(`Database close failed: ${error?.message ?? String(error)}`);
    }

    logger.log('Graceful shutdown complete.');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
