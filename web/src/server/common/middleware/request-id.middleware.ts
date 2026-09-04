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
    const raw = req.headers[REQUEST_ID_HEADER];
    const incoming = typeof raw === 'string' ? raw.trim().slice(0, 64) : '';
    const requestId = incoming.length > 0 ? incoming : randomUUID();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[REQUEST_ID_PROPERTY] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
