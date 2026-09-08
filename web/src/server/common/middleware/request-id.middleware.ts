import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Header name used by clients to pass a request/correlation ID.
 * If absent or empty, the middleware generates a UUIDv4.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Property name on the Express request where the resolved ID is stored.
 */
export const REQUEST_ID_PROPERTY = 'requestId';

/**
 * Injects a request/correlation ID into every API request.
 *
 * - Accepts a client-supplied `x-request-id` header (trimmed, max 64 chars).
 * - Falls back to a server-generated UUIDv4.
 * - Stores the ID on `req.requestId` for downstream interceptors and services.
 * - Returns the ID in the `x-request-id` response header.
 */
export class RequestIdMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[REQUEST_ID_PROPERTY] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    // The App Router route handlers run behind this chain (see `server.js`):
    // they rebuild the request from `req.headers`, so the resolved id is
    // echoed back into the headers. That makes the *same* id visible to the
    // route runtime (`adaptRequest`), the structured logs and the audit trail
    // instead of each layer minting its own.
    req.headers[REQUEST_ID_HEADER] = requestId;

    next();
  }
}

/**
 * Resolves the request/correlation id for one request: a client-supplied
 * `x-request-id` (trimmed, max 64 chars) wins, otherwise a UUIDv4 is minted.
 *
 * Shared by the Express middleware above and by `adaptRequest`, so the
 * standalone test server and plain `next dev` (no custom server) resolve ids
 * with exactly the same rule production uses.
 */
export function resolveRequestId(raw: unknown): string {
  const incoming = typeof raw === 'string' ? raw.trim().slice(0, 64) : '';
  return incoming.length > 0 ? incoming : randomUUID();
}
