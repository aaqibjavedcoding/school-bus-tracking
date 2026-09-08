import type { RequestHandler } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  constants,
  createBrotliCompress,
  createDeflate,
  createGzip,
} from 'node:zlib';
import type { Transform } from 'node:stream';
// Same lookup the `compression` middleware uses for its default filter
// (`compressible` is one of its direct dependencies). Importing it directly
// keeps the "is this Content-Type worth compressing?" semantics intact while
// the middleware normalizes the App Router header quirk described below.
import compressible from 'compressible';

export interface CompressionOptions {
  /**
   * `false` returns a pass-through middleware (no compression). Defaults to
   * enabled so every environment benefits; operators can opt out per
   * deployment (e.g. when an upstream reverse proxy already compresses).
   */
  enabled: boolean;
  /**
   * Body size threshold in bytes: responses smaller than this are sent
   * uncompressed, matching the `compression` middleware's default of 1 KiB.
   */
  threshold: number;
}

/** Preferred encoding order when the client accepts several. */
const PREFERRED_ENCODINGS = ['br', 'gzip', 'deflate'] as const;

type NegotiatedEncoding = 'br' | 'gzip' | 'deflate' | 'identity';

/**
 * Upper bound on the prebuffer. A body that never ends while the buffer is
 * still growing is flushed plain instead of being held indefinitely, so a
 * long-lived stream is never blocked by the threshold bookkeeping.
 */
const PREBUFFER_CAP_BYTES = 4 * 1024 * 1024;

const NO_TRANSFORM_REGEXP = /(?:^|,)\s*?no-transform\s*?(?:,|$)/;

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  return Buffer.from(chunk as string, encoding);
}

/**
 * Reads the response's Content-Type, tolerating the header value shape the
 * Next.js App Router produces.
 *
 * Next.js writes the Content-Type of App Router (route-handler) responses by
 * *appending* the header, which makes Node's `ServerResponse.getHeader`
 * return a string array (e.g. `['application/json; charset=utf-8']`) instead
 * of a string. Consumers must normalize before passing the value to a
 * string-only API such as `compressible`.
 */
function contentTypeOf(res: ServerResponse): string | undefined {
  const header = res.getHeader('Content-Type');
  if (Array.isArray(header)) {
    // Same shape Next produced: all entries are the same type; take the last
    // one. A defensive join keeps a hypothetical multi-value header working
    // too — compressible parses parameters itself.
    return header.length > 0 ? String(header[header.length - 1]) : undefined;
  }
  return header === undefined ? undefined : String(header);
}

/** True when `res` already carries a non-identity Content-Encoding. */
function hasExistingEncoding(res: ServerResponse): boolean {
  const header = res.getHeader('Content-Encoding');
  if (header === undefined) {
    return false;
  }
  const value = Array.isArray(header) ? header[header.length - 1] : header;
  return value !== undefined && String(value).toLowerCase() !== 'identity';
}

/** Content-Length as a number, or `null` when it is not set. */
function contentLengthOf(res: ServerResponse): number | null {
  const header = res.getHeader('Content-Length');
  if (header === undefined || header === null) {
    return null;
  }
  const raw = Array.isArray(header) ? header[header.length - 1] : header;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Parses the Accept-Encoding request header and returns the encoding to use
 * (`'identity'` when the client wants an untransformed body, `null` when no
 * compression should happen — no header sent, or everything refused).
 *
 * Respects q-values, wildcards and explicit `identity`; the server prefers
 * br over gzip over deflate on equal preference, mirroring the `compression`
 * middleware defaults.
 */
function negotiateEncoding(req: IncomingMessage): NegotiatedEncoding | null {
  const header = req.headers['accept-encoding'];
  if (typeof header !== 'string' || header.trim() === '') {
    return null;
  }

  const accepted = new Map<string, number>();
  let sawEntry = false;
  for (const part of header.split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const [rawName, ...params] = piece.split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    sawEntry = true;
    let q = 1;
    for (const param of params) {
      const [key, rawValue] = param.trim().split('=');
      if (key && key.trim().toLowerCase() === 'q') {
        const parsed = Number.parseFloat(rawValue ?? '');
        q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
      }
    }
    accepted.set(name, Math.max(accepted.get(name) ?? 0, q));
  }

  if (!sawEntry) {
    return null;
  }

  // RFC 7231 §5.3.4: identity is acceptable unless explicitly excluded.
  const identityQ = accepted.has('identity') ? (accepted.get('identity') as number) : 0.001;
  const wildcardQ = accepted.get('*') ?? 0;
  const rank = (name: string): number => {
    if (name === 'identity') return identityQ;
    return accepted.get(name) ?? wildcardQ;
  };

  let best: NegotiatedEncoding | null = null;
  let bestQ = 0;
  for (const name of [...PREFERRED_ENCODINGS, 'identity'] as const) {
    const q = rank(name);
    if (q > bestQ) {
      bestQ = q;
      best = name;
    }
  }
  if (best === null || bestQ <= 1e-9) {
    return null;
  }
  return best;
}

function createEncoder(encoding: Exclude<NegotiatedEncoding, 'identity'>): Transform {
  if (encoding === 'br') {
    return createBrotliCompress({
      params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
    });
  }
  if (encoding === 'gzip') {
    return createGzip();
  }
  return createDeflate();
}

/** Stored `writeHead` arguments, applied once the mode is decided. */
interface DeferredWriteHead {
  statusCode: number;
  reason?: string;
  headers?: Record<string, string | number | readonly string[]>;
}

/**
 * Express gzip/brotli/deflate compression middleware factory.
 *
 * Why not the `compression` npm middleware? The Next.js App Router streams
 * route-handler responses: headers are flushed before the body size is known,
 * so `compression` can only apply its threshold when a Content-Length (or a
 * single end()-chunk) reveals the size. The production symptom was twofold:
 * JSON responses were **not compressed at all** because the App Router writes
 * Content-Type as an appended header array, which the default filter's
 * `compressible()` check (strings only) rejected; and had that been fixed,
 * the threshold would still have been bypassed for every chunked response.
 *
 * This middleware owns the whole decision instead:
 *
 * - **Threshold honoured on every path.** It holds the response header until
 *   the body size is known, then sends bodies below the threshold plain and
 *   compresses larger ones (br > gzip > deflate by client preference). App
 *   Router JSON responses are fully built before the first write, so the
 *   prebuffer is bounded by the response body itself.
 * - **Streaming/binary untouched.** Responses whose headers already rule out
 *   compression (non-compressible Content-Type such as XLSX/CSV/images, an
 *   existing Content-Encoding, `Cache-Control: no-transform`, a known length
 *   below the threshold, a HEAD request, or no Accept-Encoding) switch to
 *   pass-through at the **first** write — zero buffering, original streaming
 *   and Content-Length preserved. An explicit `flushHeaders()` also switches
 *   to pass-through immediately.
 * - **No double compression** (existing Content-Encoding respected).
 * - **App Router Content-Type arrays normalized** (see {@link contentTypeOf}).
 * - `Vary: Accept-Encoding` is appended so caches treat encodings separately.
 */
export function createCompressionMiddleware(options: CompressionOptions): RequestHandler {
  if (!options.enabled) {
    return (_req, _res, next) => next();
  }
  const threshold = options.threshold > 0 ? options.threshold : 1;

  return (req, res, next) => {
    const realWrite = res.write.bind(res);
    const realEnd = res.end.bind(res);
    const realWriteHead = res.writeHead.bind(res);
    const realFlushHeaders = res.flushHeaders?.bind(res);

    type ModeKind = 'pending' | 'plain' | 'compressing';
    interface Mode {
      kind: ModeKind;
      /** Set while `kind === 'compressing'`. */
      stream?: Transform;
      encoding?: Exclude<NegotiatedEncoding, 'identity'>;
    }

    let mode: Mode = { kind: 'pending' };
    let endCallback: (() => void) | undefined;
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;
    let deferred: DeferredWriteHead | null = null;
    let headersWritten = false;
    let finished = false;

    /** Appends `Accept-Encoding` to Vary, preserving existing tokens. */
    const appendVary = (): void => {
      const existing = res.getHeader('Vary');
      const current = Array.isArray(existing)
        ? existing.join(', ')
        : existing === undefined
          ? ''
          : String(existing);
      const tokens = current
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
      if (!tokens.some((token) => token.toLowerCase() === 'accept-encoding')) {
        tokens.push('Accept-Encoding');
      }
      res.setHeader('Vary', tokens.join(', '));
    };

    /** Applies a stored `writeHead` (or an implicit one) and marks headers sent. */
    const writeStoredHeaders = (): void => {
      if (headersWritten) return;
      headersWritten = true;
      appendVary();
      if (deferred) {
        if (deferred.reason !== undefined) {
          realWriteHead(deferred.statusCode, deferred.reason, deferred.headers as never);
        } else if (deferred.headers) {
          realWriteHead(deferred.statusCode, deferred.headers as never);
        } else {
          realWriteHead(deferred.statusCode);
        }
      } else {
        realWriteHead(res.statusCode || 200);
      }
    };

    /** Flushes stored headers plus everything buffered, uncompressed. */
    const goPlain = (): void => {
      if (mode.kind !== 'pending') return;
      mode = { kind: 'plain' };
      writeStoredHeaders();
      for (const piece of buffered) {
        realWrite(piece);
      }
      buffered = [];
      bufferedBytes = 0;
    };

    /** Flushes headers and pipes the body through a codec stream. */
    const startCompressing = (encoding: Exclude<NegotiatedEncoding, 'identity'>): void => {
      const stream = createEncoder(encoding);
      mode = { kind: 'compressing', stream, encoding };

      stream.on('data', (chunk: Buffer) => {
        if (!realWrite(chunk) && mode.kind === 'compressing') {
          stream.pause();
        }
      });
      stream.on('end', () => {
        if (!finished) {
          finished = true;
          realEnd();
          endCallback?.();
        }
      });
      stream.on('error', () => {
        // A codec failure must never kill the response: send the bytes we
        // still hold plain (headers are not out yet in that window).
        if (mode.kind === 'compressing') {
          mode = { kind: 'plain' };
          try {
            stream.destroy();
          } catch {
            /* noop */
          }
          if (!finished) {
            finished = true;
            writeStoredHeaders();
            realEnd();
            endCallback?.();
          }
        }
      });
      res.on('drain', () => {
        if (mode.kind === 'compressing') {
          stream.resume();
        }
      });

      // Content-Encoding must be on the wire; any stored length hint is void
      // because the byte count changes under a codec.
      res.setHeader('Content-Encoding', encoding);
      res.removeHeader('Content-Length');
      writeStoredHeaders();
      for (const piece of buffered) {
        stream.write(piece);
      }
      buffered = [];
      bufferedBytes = 0;
    };

    /**
     * Inspects the response headers set so far. When they already rule out
     * compression the response switches to pass-through — callers use this
     * at the first body byte so streaming responses are never buffered.
     */
    const earlyDecide = (): void => {
      if (mode.kind !== 'pending' || headersWritten || finished) return;

      const encoding = negotiateEncoding(req);
      if (
        encoding === null ||
        encoding === 'identity' ||
        req.method === 'HEAD' ||
        hasExistingEncoding(res)
      ) {
        goPlain();
        return;
      }

      const cacheControl = res.getHeader('Cache-Control');
      if (
        cacheControl !== undefined &&
        NO_TRANSFORM_REGEXP.test(
          String(Array.isArray(cacheControl) ? cacheControl.join(',') : cacheControl),
        )
      ) {
        goPlain();
        return;
      }

      const type = contentTypeOf(res);
      if (type === undefined || !compressible(type)) {
        goPlain();
        return;
      }

      const length = contentLengthOf(res);
      if (length !== null && length < threshold) {
        goPlain();
        return;
      }
      if (length !== null && length >= threshold) {
        startCompressing(encoding as Exclude<NegotiatedEncoding, 'identity'>);
      }
      // Unknown length with a compressible type: buffer until the size is
      // known (or the cap forces plain pass-through).
    };

    /** Fresh read of the current mode (avoids TS control-flow narrowing). */
    const kindOf = (): ModeKind => mode.kind;

    // ---- Response overrides ----------------------------------------------

    res.writeHead = function (
      this: ServerResponse,
      statusCode: number,
      ...rest: unknown[]
    ): ServerResponse {
      let reason: string | undefined;
      let headers: Record<string, string | number | readonly string[]> | undefined;
      if (typeof rest[0] === 'string') {
        reason = rest[0];
        headers = rest[1] as typeof headers;
      } else {
        headers = rest[0] as typeof headers;
      }
      if (finished || headersWritten) {
        // Response already committed: mirror Node's behaviour by writing now.
        if (reason !== undefined) {
          return realWriteHead(statusCode, reason, headers as never);
        }
        return headers ? realWriteHead(statusCode, headers as never) : realWriteHead(statusCode);
      }
      // While pending we hold the header block; goPlain/startCompressing
      // apply it later through writeStoredHeaders once the mode is decided.
      deferred = { statusCode, reason, headers };
      return res;
    } as unknown as typeof res.writeHead;

    res.flushHeaders = function (this: ServerResponse): void {
      // The Next.js App Router calls flushHeaders() before streaming a route
      // handler's body — at that point the body size is still unknown, so
      // honouring the flush would defeat the threshold (every response would
      // be sent plain, or compressed blind). While the mode is still pending
      // the flush is deferred: the decision lands at the first body byte (or
      // at end()), when the size — and therefore the threshold — is known.
      // Real long-lived streams never sit in pending: their Content-Type is
      // not compressible (SSE, downloads), which switches them to plain at
      // the first write, or they outgrow PREBUFFER_CAP_BYTES.
      if (finished) {
        return;
      }
      if (mode.kind === 'pending') {
        return;
      }
      if (!headersWritten) {
        writeStoredHeaders();
      }
      realFlushHeaders?.call(res);
    } as typeof res.flushHeaders;

    res.write = function (
      this: ServerResponse,
      chunk: unknown,
      encoding?: BufferEncoding,
      // Kept only to mirror the ServerResponse.write signature; buffered
      // writes complete synchronously here (no flush callback is required).
      _callback?: () => void,
    ): boolean {
      if (finished) {
        return false;
      }
      const buffer = toBuffer(chunk, encoding);

      if (kindOf() === 'pending') {
        if (bufferedBytes === 0) {
          earlyDecide();
        }
        if (kindOf() === 'plain') {
          return realWrite(buffer);
        }
        if (kindOf() === 'compressing') {
          mode.stream?.write(buffer);
          return true;
        }
        if (buffer.length > 0) {
          buffered.push(buffer);
          bufferedBytes += buffer.length;
          if (bufferedBytes >= PREBUFFER_CAP_BYTES) {
            // Still streaming past the cap without an end: pass through.
            goPlain();
          }
        }
        return true;
      }

      if (kindOf() === 'plain') {
        return realWrite(buffer);
      }

      if (kindOf() === 'compressing') {
        mode.stream?.write(buffer);
        return true;
      }
      return true;
    } as unknown as typeof res.write;

    res.end = function (
      this: ServerResponse,
      chunk?: unknown,
      encoding?: BufferEncoding,
      callback?: () => void,
    ): ServerResponse {
      if (typeof chunk === 'function') {
        callback = chunk as () => void;
        chunk = undefined;
        encoding = undefined;
      } else if (typeof encoding === 'function') {
        callback = encoding as () => void;
        encoding = undefined;
      }

      if (chunk !== undefined && chunk !== null) {
        const buffer = toBuffer(chunk, encoding);
        if (kindOf() === 'pending') {
          if (bufferedBytes === 0) {
            earlyDecide();
          }
          if (kindOf() === 'plain') {
            realWrite(buffer);
          } else if (kindOf() === 'compressing') {
            mode.stream?.write(buffer);
          } else {
            buffered.push(buffer);
            bufferedBytes += buffer.length;
          }
        } else if (kindOf() === 'plain') {
          realWrite(buffer);
        } else if (kindOf() === 'compressing') {
          mode.stream?.write(buffer);
        }
      }

      if (finished) {
        return res;
      }

      if (kindOf() === 'pending') {
        // Whole body is now in hand: below the threshold we send it plain,
        // at/above it we compress everything that was buffered.
        if (bufferedBytes < threshold) {
          goPlain();
        } else {
          earlyDecide();
          if (kindOf() === 'pending') {
            // Compressible and ≥ threshold but headers not yet flushed.
            const encoding = negotiateEncoding(req);
            if (encoding && encoding !== 'identity') {
              startCompressing(encoding as Exclude<NegotiatedEncoding, 'identity'>);
            } else {
              goPlain();
            }
          }
        }
        if (kindOf() === 'pending') {
          goPlain();
        }
        if (kindOf() === 'plain') {
          writeStoredHeaders();
          for (const piece of buffered) {
            realWrite(piece);
          }
          buffered = [];
          bufferedBytes = 0;
          finished = true;
          const result = realEnd();
          callback?.();
          return result;
        }
        if (kindOf() === 'compressing') {
          endCallback = callback;
          mode.stream?.end();
          return res;
        }
      }

      if (kindOf() === 'plain') {
        if (!headersWritten) {
          writeStoredHeaders();
        }
        finished = true;
        const result = realEnd();
        callback?.();
        return result;
      }

      if (kindOf() === 'compressing') {
        endCallback = callback;
        mode.stream?.end();
        return res;
      }

      finished = true;
      const result = realEnd();
      callback?.();
      return result;
    } as unknown as typeof res.end;

    next();
  };
}
