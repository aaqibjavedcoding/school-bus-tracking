/**
 * The `/api/*` middleware chain — the single implementation shared by the
 * production custom server (`web/server.js`) and the E2E test harness
 * (`src/server/http/test-server.ts`).
 *
 * Before this module existed, `server.js` built the chain inline and the test
 * harness skipped it entirely, so E2E suites exercised the route runtime but
 * not the response decoration production applies (CORS, compression, security
 * headers, request-id). The chain is deliberately scoped to the API prefix:
 * Next owns its own responses (HTML, RSC payloads, static assets) and must
 * not have these applied — that was true in `main.ts` and stays true here.
 *
 * Chain order (mirrors the old Nest `main.ts`):
 *
 *   CORS → compression → security headers → cookie parser → request id
 *
 * Everything the chain needs is derivable from the {@link ConfigService} via
 * {@link createApiMiddlewareChainFromConfig}, so both entry points stay
 * configuration-driven and identical by construction.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction, RequestHandler } from 'express';

/**
 * The chain middlewares are Express `RequestHandler`s, but — exactly like in
 * `http.createServer` — they are invoked against the raw Node pair. They only
 * consume what `IncomingMessage`/`ServerResponse` expose.
 */
type RawRequestHandler = (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void;
import cors from 'cors';
import cookieParser from 'cookie-parser';

import type { ConfigService } from '../framework';
import {
  buildCorsOptions,
  createSecurityHeadersMiddleware,
  type CorsPolicy,
} from '../common/security';
import { createCompressionMiddleware } from '../common/middleware/compression.middleware';
import { RequestIdMiddleware } from '../common/middleware/request-id.middleware';

export interface ApiMiddlewareChain {
  /** The ordered Express-style middlewares of the API chain. */
  middlewares: RequestHandler[];
  /**
   * Runs the chain against a raw Node request/response. Resolves with
   * `'answered'` when a middleware fully answered the request (CORS
   * preflight, a blocked origin) — the caller must then not write to the
   * socket again — and `'continue'` when the request should proceed (to the
   * route runtime in tests, to Next in production).
   */
  run(req: IncomingMessage, res: ServerResponse): Promise<'answered' | 'continue'>;
}

/**
 * True when `url` targets the API mount (the prefix itself or anything under
 * it), mirroring the check `server.js` applies before running the chain.
 */
export function isApiPath(url: string | undefined, apiPrefix: string): boolean {
  if (!url) {
    return false;
  }
  return url === `/${apiPrefix}` || url.startsWith(`/${apiPrefix}/`);
}

/**
 * Builds the chain from an already-resolved CORS policy (the production
 * server resolves and validates the policy once at boot, failing fast on a
 * misconfigured allowlist).
 */
export function createApiMiddlewareChain(
  policy: CorsPolicy,
  config: ConfigService,
): ApiMiddlewareChain {
  const corsHandler = cors(buildCorsOptions(policy));
  const compression = createCompressionMiddleware({
    enabled: config.get('app.compression.enabled') ?? true,
    threshold: config.get('app.compression.thresholdBytes') ?? 1024,
  });
  const securityHeaders = createSecurityHeadersMiddleware({
    enabled: config.get('security.headers.enabled') ?? true,
    isProduction: config.get('security.isProduction') ?? false,
    hstsMaxAge: config.get('security.headers.hstsMaxAge') ?? 15552000,
    hstsIncludeSubDomains: config.get('security.headers.hstsIncludeSubDomains') ?? true,
    hstsPreload: config.get('security.headers.hstsPreload') ?? false,
    cspEnabled: config.get('security.headers.cspEnabled') ?? true,
    frameAncestors: config.get('security.headers.frameAncestors') ?? "'none'",
    referrerPolicy:
      config.get('security.headers.referrerPolicy') ?? 'strict-origin-when-cross-origin',
    permissionsPolicy: config.get('security.headers.permissionsPolicy') ?? '',
  });
  const cookieParserHandler = cookieParser();
  const requestId = new RequestIdMiddleware();
  const requestIdHandler = requestId.use.bind(requestId);

  const middlewares: RequestHandler[] = [
    corsHandler,
    compression,
    securityHeaders,
    cookieParserHandler,
    requestIdHandler,
  ];

  return {
    middlewares,
    run(req, res) {
      return new Promise((resolve, reject) => {
        let index = 0;
        const nextFn = (err?: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const middleware = middlewares[index++] as unknown as RawRequestHandler | undefined;
          if (!middleware) {
            resolve('continue');
            return;
          }
          try {
            // The Express-style middlewares only read what a raw
            // `IncomingMessage` provides (method, url, headers, socket) and
            // answer through the `ServerResponse`; production passes exactly
            // the same pair from `http.createServer`.
            middleware(req as never, res as never, nextFn);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        nextFn();
      }).then(() => {
        // A middleware may have already answered (CORS preflight, a blocked
        // origin); the caller must not also write to the socket.
        return res.writableEnded ? ('answered' as const) : ('continue' as const);
      });
    },
  };
}
