/**
 * Minimal HTTP host for endpoint definitions.
 *
 * Replaces `NestFactory.create(...)` + `app.listen(0)` in the tests that need
 * a real socket: the CSRF web flow, the e2e suites and `test/support/app.ts`.
 *
 * It reproduces the parts of the production stack that those tests actually
 * depend on:
 *
 * - the `api/v1` global prefix and Express-style `:param` matching, so route
 *   parameters reach the handler exactly as Next's segment data would;
 * - `cookie-parser`, since the auth handlers read `request.cookies`;
 * - the route runtime itself, which brings the guard chain, validation and
 *   the success/error envelope with it.
 *
 * It is deliberately *not* a second router implementation for production use —
 * Next owns that. Requests here are matched against the same definitions the
 * `route.ts` files export, so what is under test is still the real handler.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRouteHandler, type EndpointDefinition } from './route-runtime';

/** One mounted endpoint: verb + Express-style path, e.g. `/auth/login`. */
export interface TestRoute {
  method: string;
  /** Path *without* the global prefix, with `:param` segments. */
  path: string;
  // Definitions are heterogeneous in their DTO types; the runtime only needs
  // the erased shape to build a handler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: EndpointDefinition<any, any>;
}

export interface TestServerOptions {
  routes: TestRoute[];
  /** Defaults to `api/v1`, matching the production global prefix. */
  apiPrefix?: string;
}

export interface RunningTestServer {
  origin: string;
  baseUrl: string;
  server: Server;
  close(): Promise<void>;
}

interface CompiledRoute extends TestRoute {
  pattern: RegExp;
  paramNames: string[];
  handler: ReturnType<typeof createRouteHandler>;
}

function compile(route: TestRoute, apiPrefix: string): CompiledRoute {
  const paramNames: string[] = [];
  const source = `/${apiPrefix}${route.path}`
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      paramNames.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');

  return {
    ...route,
    paramNames,
    pattern: new RegExp(`^${source}/?$`),
    handler: createRouteHandler(route.definition),
  };
}

/** Reads the raw request body, or undefined when there is none. */
function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on('error', reject);
  });
}

/** Starts the server on an ephemeral port bound to loopback. */
export async function startTestServer(
  options: TestServerOptions,
): Promise<RunningTestServer> {
  const apiPrefix = options.apiPrefix ?? 'api/v1';
  // Next's file-system router resolves a static segment before a dynamic one,
  // so `/emergencies/active` wins over `/emergencies/:id` regardless of
  // declaration order. Matching here is first-wins, so the table is sorted to
  // reproduce that precedence: fewer parameters first, then longer paths.
  const routes = options.routes
    .map((route) => compile(route, apiPrefix))
    .sort((a, b) => {
      if (a.paramNames.length !== b.paramNames.length) {
        return a.paramNames.length - b.paramNames.length;
      }
      const aSegments = a.path.split('/').length;
      const bSegments = b.path.split('/').length;
      if (aSegments !== bSegments) {
        return bSegments - aSegments;
      }
      return a.path.localeCompare(b.path);
    });

  const server = createServer((incoming, response) => {
    void handle(incoming, response);
  });

  async function handle(incoming: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
      const match = routes.find(
        (route) =>
          route.method === (incoming.method ?? 'GET').toUpperCase() &&
          route.pattern.test(url.pathname),
      );

      if (!match) {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            success: false,
            error: { code: 'HTTP_404', message: 'Not Found', details: null },
            timestamp: new Date().toISOString(),
          }),
        );
        return;
      }

      const captured = match.pattern.exec(url.pathname) ?? [];
      const params: Record<string, string> = {};
      match.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(captured[index + 1] ?? '');
      });

      const body = await readBody(incoming);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        for (const entry of Array.isArray(value) ? value : [value]) {
          headers.append(key, entry);
        }
      }

      const request = new Request(url.toString(), {
        method: incoming.method,
        headers,
        body: body && body.length ? new Uint8Array(body) : undefined,
      });

      const result = await match.handler(request, { params });

      response.statusCode = result.status;
      result.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        response.setHeader(key, value);
      });
      const setCookies = result.headers.getSetCookie?.() ?? [];
      if (setCookies.length) {
        response.setHeader('Set-Cookie', setCookies);
      }

      const payload = Buffer.from(await result.arrayBuffer());
      response.end(payload);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'HTTP_500',
            message: error instanceof Error ? error.message : String(error),
            details: null,
          },
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    baseUrl: `${origin}/${apiPrefix}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
