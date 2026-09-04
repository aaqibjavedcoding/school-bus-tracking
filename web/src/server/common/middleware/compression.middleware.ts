import type { RequestHandler } from 'express';
// `compression` is a CommonJS module that exports a callable function via
// `module.exports` (declared as `export =` in `@types/compression`). The web
// build runs with `esModuleInterop`, so the default import resolves to that
// callable; the old namespace import is no longer callable under interop.
import compression from 'compression';

export interface CompressionOptions {
  /**
   * `false` returns a pass-through middleware (no compression). Defaults to
   * enabled so every environment benefits; operators can opt out per
   * deployment (e.g. when an upstream reverse proxy already compresses).
   */
  enabled: boolean;
  /**
   * Body size threshold in bytes: responses smaller than this are sent
   * uncompressed, matching `compression`'s default of 1 KiB.
   */
  threshold: number;
}

/**
 * Express gzip/deflate compression middleware factory.
 *
 * Compression is content-negotiated via the request's `Accept-Encoding`
 * header: clients that do not accept compressed bodies (or upgrade
 * connections such as the Socket.IO WebSocket transport) are passed through
 * untouched. Already-compressed responses (e.g. the binary XLSX/CSV
 * exports) are skipped by the `compression` middleware itself via the
 * `Content-Encoding`/`Content-Type` sniffing, so responses are never
 * double-compressed.
 *
 * The middleware is mounted before any response is produced in
 * `main.ts`, so every JSON API response over the size threshold is
 * compressed.
 */
export function createCompressionMiddleware(options: CompressionOptions): RequestHandler {
  if (!options.enabled) {
    return (_req, _res, next) => next();
  }

  return compression({
    threshold: options.threshold,
  });
}
