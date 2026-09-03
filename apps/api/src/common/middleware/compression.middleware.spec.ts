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
      res.setHeader('Content-Type', 'application/json');
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
});
