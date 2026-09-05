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
const fs = require('node:fs');
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
  const serverDist = path.join(__dirname, 'dist');
  if (!fs.existsSync(serverDist)) {
    throw new Error(
      'web/dist is missing. Run `npm run build:server` (or `npm run build`) before starting the server.',
    );
  }

  const { getContainer } = require(path.join(serverDist, 'container'));
  const {
    buildCorsOptions,
    createSecurityHeadersMiddleware,
    resolveCorsPolicy,
  } = require(path.join(serverDist, 'common/security'));
  const {
    createCompressionMiddleware,
  } = require(path.join(serverDist, 'common/middleware/compression.middleware'));
  const { RequestIdMiddleware } = require(path.join(serverDist, 'common/middleware/request-id.middleware'));
  const { parseOriginList } = require(path.join(serverDist, 'config'));
  const { Logger } = require(path.join(serverDist, 'framework'));
  const { bootstrapDatabase } = require(path.join(serverDist, 'database/bootstrap'));

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
  await bootstrapDatabase();

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
  const cors = require('cors')(buildCorsOptions(corsPolicy));
  const compression = createCompressionMiddleware({
    enabled: configService.get('app.compression.enabled') ?? true,
    threshold: configService.get('app.compression.thresholdBytes') ?? 1024,
  });
  const securityHeaders = createSecurityHeadersMiddleware({
    enabled: configService.get('security.headers.enabled') ?? true,
    isProduction: configService.get('security.isProduction') ?? false,
    hstsMaxAge: configService.get('security.headers.hstsMaxAge') ?? 15552000,
    hstsIncludeSubDomains: configService.get('security.headers.hstsIncludeSubDomains') ?? true,
    hstsPreload: configService.get('security.headers.hstsPreload') ?? false,
    cspEnabled: configService.get('security.headers.cspEnabled') ?? true,
    frameAncestors: configService.get('security.headers.frameAncestors') ?? "'none'",
    referrerPolicy:
      configService.get('security.headers.referrerPolicy') ?? 'strict-origin-when-cross-origin',
    permissionsPolicy: configService.get('security.headers.permissionsPolicy') ?? '',
  });
  const cookieParser = require('cookie-parser')();
  const requestId = new RequestIdMiddleware();
  const requestIdMiddleware = requestId.use.bind(requestId);

  const apiChain = [cors, compression, securityHeaders, cookieParser, requestIdMiddleware];

  /** Runs the Express-style chain, then resolves. */
  function runChain(req, res) {
    return new Promise((resolve, reject) => {
      let index = 0;
      const nextFn = (err) => {
        if (err) {
          reject(err);
          return;
        }
        const middleware = apiChain[index++];
        if (!middleware) {
          resolve(true);
          return;
        }
        try {
          middleware(req, res, nextFn);
        } catch (error) {
          reject(error);
        }
      };
      nextFn();
    });
  }

  const server = http.createServer((req, res) => {
    const isApi = req.url === `/${apiPrefix}` || req.url.startsWith(`/${apiPrefix}/`);

    if (!isApi) {
      handle(req, res);
      return;
    }

    runChain(req, res)
      .then(() => {
        // A middleware may have already answered (CORS preflight, a blocked
        // origin); in that case Next must not also write to the socket.
        if (!res.writableEnded && !res.headersSent) {
          handle(req, res);
        } else if (!res.writableEnded) {
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
    logger.warn(
      `Deferred realtime wiring to instrumentation: ${error?.message ?? String(error)}`,
    );
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

  server.listen(port, hostname, () => {
    logger.log(`Application is running on: http://${hostname}:${port}`);
    logger.log(`API available at: http://${hostname}:${port}/${apiPrefix}`);
    logger.log(`Health endpoint available at: http://${hostname}:${port}/${apiPrefix}/health`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
