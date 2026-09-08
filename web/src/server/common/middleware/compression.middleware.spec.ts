import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'http';
import type { Request, Response } from 'express';
import { createCompressionMiddleware } from './compression.middleware';

/**
 * Boots an http server with the compression middleware in front of a handler
 * that sends a fixed body, returning { status, headers, body } for a request
 * with the given Accept-Encoding header.
 */
async function requestWithEncoding(
  acceptEncoding: string | undefined,
  middlewareEnabled: boolean,
  threshold = 1024,
  body = Buffer.alloc(4096, 'a'),
  contentType: string | string[] = 'application/json',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const middleware = createCompressionMiddleware({
    enabled: middlewareEnabled,
    threshold,
  });

  const server = http.createServer((req, res) => {
    // The compression middleware is a plain Express handler; the raw
    // IncomingMessage/ServerResponse from node:http satisfy its runtime
    // contract, so only the static types need bridging here.
    middleware(req as unknown as Request, res as unknown as Response, () => {
      if (Array.isArray(contentType)) {
        // Node >= 18 only keeps array header values when they were
        // *appended* — exactly how the Next.js App Router writes the
        // Content-Type of route-handler responses.
        for (const value of contentType) {
          res.appendHeader('Content-Type', value);
        }
      } else {
        res.setHeader('Content-Type', contentType);
      }
      res.end(body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to start test server');
  }

  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/',
          method: 'GET',
          headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk as Buffer));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('createCompressionMiddleware', () => {
  it('gzip-compresses responses for clients that accept gzip', async () => {
    const res = await requestWithEncoding('gzip, deflate', true);

    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.match(String(res.headers.vary ?? ''), /accept-encoding/i);
    // Compressed body must be smaller than the 4 KiB source.
    assert.ok(res.body.length < 4096, `expected compressed body, got ${res.body.length} bytes`);
    assert.equal(res.body[0], 0x1f);
    assert.equal(res.body[1], 0x8b); // gzip magic number
  });

  it('passes responses through uncompressed when the client sends no Accept-Encoding', async () => {
    const res = await requestWithEncoding(undefined, true);

    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.length, 4096);
    assert.equal(res.body.toString('utf8'), 'a'.repeat(4096));
  });

  it('passes responses through uncompressed when compression is disabled', async () => {
    const res = await requestWithEncoding('gzip', false);

    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.length, 4096);
  });

  it('does not compress bodies below the configured threshold', async () => {
    const smallBody = Buffer.from('{"ok":true}');
    const res = await requestWithEncoding('gzip', true, 1024, smallBody);

    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.toString('utf8'), '{"ok":true}');
  });

  it('compresses bodies at/above the configured threshold', async () => {
    const body = Buffer.alloc(128, 'b');
    const res = await requestWithEncoding('gzip', true, 64, body);

    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.ok(res.body.length < 128);
  });

  it('compresses when Content-Type arrives as an array (Next App Router shape)', async () => {
    // Regression test: the Next.js App Router *appends* the Content-Type
    // header of route-handler responses, so `res.getHeader('Content-Type')`
    // returns `['application/json; charset=utf-8']`. The `compression`
    // default filter feeds arrays into `compressible()` (strings only) and
    // silently skips compression; the custom filter normalizes first.
    const body = Buffer.alloc(4096, 'c');
    const res = await requestWithEncoding('gzip', true, 1024, body, [
      'application/json; charset=utf-8',
    ]);

    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.ok(res.body.length < 4096);
    assert.equal(res.body[0], 0x1f);
    assert.equal(res.body[1], 0x8b); // gzip magic number
  });

  it('negotiates brotli when the client prefers it', async () => {
    const res = await requestWithEncoding('br, gzip', true);

    assert.equal(res.headers['content-encoding'], 'br');
    assert.ok(res.body.length < 4096);
  });

  it('still skips non-compressible content types (binary downloads)', async () => {
    const res = await requestWithEncoding(
      'gzip',
      true,
      64,
      Buffer.alloc(2048, 0),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.length, 2048);
  });

  it('keeps unknown-length bodies under the threshold uncompressed', async () => {
    // Chunked (no Content-Length, several writes then end) — the shape the
    // Next.js App Router produces. The body never crosses the threshold, so
    // the response must go out plain instead of being compressed blindly.
    const middleware = createCompressionMiddleware({ enabled: true, threshold: 1024 });
    const server = http.createServer((req, res) => {
      middleware(req as unknown as Request, res as unknown as Response, () => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.write(Buffer.alloc(200, 'x'));
        res.write(Buffer.alloc(200, 'y'));
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const result = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>(
        (resolve, reject) => {
          const req = http.request(
            { hostname: '127.0.0.1', port: address.port, path: '/', headers: { 'Accept-Encoding': 'gzip' } },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk) => chunks.push(chunk as Buffer));
              res.on('end', () =>
                resolve({ headers: res.headers, body: Buffer.concat(chunks) }),
              );
              res.on('error', reject);
            },
          );
          req.on('error', reject);
          req.end();
        },
      );

      assert.equal(result.headers['content-encoding'], undefined);
      assert.equal(result.body.length, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('compresses unknown-length bodies at/above the threshold', async () => {
    const middleware = createCompressionMiddleware({ enabled: true, threshold: 1024 });
    const server = http.createServer((req, res) => {
      middleware(req as unknown as Request, res as unknown as Response, () => {
        res.setHeader('Content-Type', 'application/json');
        const body = Buffer.alloc(4096, 'a');
        res.write(body.subarray(0, 2048));
        res.write(body.subarray(2048));
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const result = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>(
        (resolve, reject) => {
          const req = http.request(
            { hostname: '127.0.0.1', port: address.port, path: '/', headers: { 'Accept-Encoding': 'gzip' } },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk) => chunks.push(chunk as Buffer));
              res.on('end', () =>
                resolve({ headers: res.headers, body: Buffer.concat(chunks) }),
              );
              res.on('error', reject);
            },
          );
          req.on('error', reject);
          req.end();
        },
      );

      assert.equal(result.headers['content-encoding'], 'gzip');
      assert.ok(result.body.length < 4096);
      assert.equal(result.body[0], 0x1f);
      assert.equal(result.body[1], 0x8b);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
