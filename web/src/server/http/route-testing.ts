/**
 * Test helpers for exercising endpoint definitions.
 *
 * The controller specs used to instantiate a controller with a stub service
 * and call its methods directly. Endpoint definitions are plain objects, so
 * the equivalents are:
 *
 * - {@link callHandler} — invoke a definition's handler with a stub context,
 *   replacing `new Controller(stub).method(...)`.
 * - {@link invokeRoute} — drive a definition through the *whole* route runtime
 *   (guards, validation, envelope) and get the parsed JSON back, for the specs
 *   that asserted on guard behaviour and status codes.
 * - {@link makeGuardContext} — build an `ExecutionContext` carrying a
 *   definition's guard metadata, replacing the hand-rolled `makeContext` that
 *   pointed at a controller class and prototype method.
 */
import type { ExecutionContext } from '../framework';
import { createExecutionContext } from '../framework';
import type { AuthenticatedRequestUser } from '../common/guards';
import { CookieJar } from './cookies';
import {
  createMetadataTarget,
  createRouteHandler,
  type EndpointDefinition,
  type HandlerContext,
} from './route-runtime';

/** Everything a handler may read; all fields optional with sane defaults. */
export interface HandlerCallOptions<TBody = unknown, TQuery = unknown> {
  /**
   * The verified claims the guards would have attached. Accepts a partial so a
   * spec can supply only the fields its handler reads.
   */
  user?: Partial<AuthenticatedRequestUser> | AuthenticatedRequestUser | Record<string, unknown>;

  body?: TBody;
  query?: TQuery;
  params?: Record<string, string>;
  /** Extra properties merged onto the adapted request (ip, managedSchool, …). */
  request?: Record<string, unknown>;
  cookies?: CookieJar;
}

/**
 * Calls a definition's handler directly, bypassing guards and validation.
 *
 * This is the closest analogue of the old `controller.method(schoolId, dto)`
 * call: it asserts what the handler does with already-validated inputs.
 */
export function callHandler<TBody, TQuery>(
  definition: EndpointDefinition<TBody, TQuery>,
  options: HandlerCallOptions<TBody, TQuery> = {},
): Promise<unknown> {
  const cookies = options.cookies ?? new CookieJar();
  const params = options.params ?? {};

  const request = {
    method: 'GET',
    url: '/',
    headers: {},
    cookies: {},
    params,
    query: options.query ?? {},
    body: options.body,
    user: options.user,
    ip: '127.0.0.1',
    secure: false,
    ...options.request,
  };

  const context = {
    user: options.user as AuthenticatedRequestUser,
    body: options.body as TBody,
    query: (options.query ?? {}) as TQuery,
    params,
    request: request as unknown as HandlerContext<TBody, TQuery>['request'],
    raw: new Request('http://localhost/'),
    cookies,
  } satisfies HandlerContext<TBody, TQuery>;

  return Promise.resolve(definition.handler(context));
}

/**
 * Builds an `ExecutionContext` whose handler/class carry the definition's
 * guard metadata (`@Roles`, `@RateLimit`), for driving guards directly.
 */
export function makeGuardContext(
  definition: EndpointDefinition<never, never>,
  request: Record<string, unknown>,
): ExecutionContext {
  const target = createMetadataTarget(definition);
  return createExecutionContext({
    request: request as never,
    response: null,
    handler: target,
    handlerClass: target as never,
  });
}

/** Result of driving a definition through the full route runtime. */
export interface RouteInvocation {
  status: number;
  headers: Headers;
  body: unknown;
  response: Response;
}

/** Options for {@link invokeRoute}; mirrors a real HTTP request. */
export interface InvokeRouteOptions {
  method?: string;
  url?: string;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Drives a definition through the complete route runtime — guard chain,
 * validation, envelope — and returns the parsed response.
 *
 * Use this for the assertions that were about HTTP behaviour (401/403 from
 * guards, status codes, the success/error envelope) rather than about a
 * service call.
 */
export async function invokeRoute(
  definition: EndpointDefinition<never, never>,
  options: InvokeRouteOptions = {},
): Promise<RouteInvocation> {
  const method = options.method ?? 'GET';
  const url = options.url ?? 'http://localhost/api/v1/test';
  const headers = new Headers(options.headers ?? {});

  const init: RequestInit = { method, headers };
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(options.body);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }

  const handler = createRouteHandler(definition);
  const response = await handler(new Request(url, init), { params: options.params ?? {} });

  const text = await response.clone().text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Streaming/file endpoints return non-JSON bodies; hand back the raw text.
  }

  return { status: response.status, headers: response.headers, body: parsed, response };
}
