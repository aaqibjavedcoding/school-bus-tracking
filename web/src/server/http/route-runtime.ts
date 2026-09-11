/**
 * The route-handler runtime — the replacement for Nest's request pipeline.
 *
 * A route is declared once as an {@link EndpointDefinition} (auth, roles,
 * rate-limit policy, status code, DTO types, handler) and turned into an App
 * Router handler by {@link createRouteHandler}. The pipeline reproduces
 * Nest's ordering exactly:
 *
 *   CSRF guard → RateLimit guard → JwtAuthGuard → RolesGuard → validation → handler
 *
 * That is the real global-before-controller order Nest applied, and it is
 * load-bearing: the rate limiter runs *before* authentication, so it keys on
 * IP rather than user id (`request.user` is not set yet).
 *
 * Everything after the guards mirrors the old global pipes/interceptors:
 * `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })` on the
 * body and query, `TransformInterceptor`'s success envelope, and
 * `HttpExceptionFilter`'s error envelope.
 */
import type { UserRole } from '@school-bus-tracking/shared-types';
import {
  BadRequestException,
  HttpStatus,
  Logger,
  createExecutionContext,
  globalValidationPipe,
  type Type,
} from '../framework';
import { getContainer } from '../container';
import {
  JwtAuthGuard,
  RolesGuard,
  type AuthenticatedRequestUser,
  type TenantRequestUser,
} from '../common/guards';
import { CsrfGuard } from '../common/security';
import { RateLimitGuard } from '../common/rate-limit';
import type { RateLimitPolicyName } from '../common/rate-limit';
import { ROLES_KEY } from '../common/decorators';
import {
  ManagedSchoolGuard,
  type ManagedSchoolLookup,
} from '../modules/admin/manage/managed-school.guard';
import { ASSISTED_ALLOW_WHEN_INACTIVE_KEY } from '../modules/admin/manage/managed-school.guard';
import {
  AssistedMutationAuditInterceptor,
  type ManagedRequest,
} from '../modules/admin/manage/assisted-mutation-audit.interceptor';
import { School } from '../database/models';
import { RATE_LIMIT_POLICY_KEY } from '../common/rate-limit/rate-limit.constants';
import { AdaptedResponse, adaptRequest, type AdaptedRequest } from './request-adapter';
import {
  applyDeprecationHeaders,
  assertEndpointNotRetired,
  type DeprecationDeclaration,
} from './deprecation';
import { CookieJar } from './cookies';
import { buildErrorEnvelope, wrapSuccess } from './response-envelope';
import {
  structuredLogger,
  type LoggableRequest,
} from '../common/interceptors/structured-logging.interceptor';
import { IDEMPOTENCY_HEADER } from '../common/idempotency/idempotency.constants';
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_PROPERTY,
  resolveRequestId,
} from '../common/middleware/request-id.middleware';

const routeLogger = new Logger('RouteRuntime');

/** Context handed to every endpoint handler. */
export interface HandlerContext<TBody = unknown, TQuery = unknown> {
  /** Verified JWT claims. Non-null whenever `auth` is not `false`. */
  user: AuthenticatedRequestUser;
  /** Validated + transformed body DTO instance. */
  body: TBody;
  /** Validated + transformed query DTO instance. */
  query: TQuery;
  /** Route parameters from the App Router segment. */
  params: Record<string, string>;
  /** The Express-shaped request (cookies, headers, ip). */
  request: AdaptedRequest;
  /** The raw Web request — used by multipart uploads and streaming. */
  raw: Request;
  /** Queue `Set-Cookie` mutations (replaces Express' `res.cookie`). */
  cookies: CookieJar;
}

/** Declarative description of one HTTP endpoint. */
export interface EndpointDefinition<TBody = unknown, TQuery = unknown> {
  /** Requires a valid bearer access token. Defaults to true. */
  auth?: boolean;
  /** Allowed roles. Empty/absent means "any authenticated user". */
  roles?: UserRole[];
  /** Rate-limit policy, equivalent to `@RateLimit('...')`. */
  rateLimit?: RateLimitPolicyName;
  /**
   * Assisted-management route: resolves `:schoolId` through
   * {@link ManagedSchoolGuard} and audits successful mutations, exactly as
   * `@UseGuards(..., ManagedSchoolGuard)` + `@UseInterceptors(
   * AssistedMutationAuditInterceptor)` did.
   */
  managedSchool?: boolean;
  /** Mirrors `@AssistedAllowWhenInactive()` on session-lifecycle handlers. */
  allowWhenInactive?: boolean;
  /** Success status code, equivalent to `@HttpCode(...)`. */
  status?: number;
  /** DTO class validated against the JSON body. */
  bodyType?: Type<TBody>;
  /** DTO class validated against the query string. */
  queryType?: Type<TQuery>;
  /**
   * Idempotency scope for this endpoint (one of `IDEMPOTENCY_ENDPOINTS`).
   *
   * When set, a request carrying an `x-idempotency-key` header is deduplicated
   * against the stored result of the first request with the same key: replays
   * (mobile retries, offline-queue flushes, double submits) return the
   * original response without re-executing the handler, so no duplicate rows,
   * events or notifications are created. Keys are scoped per tenant, user and
   * endpoint. Requests without the header execute normally.
   */
  idempotency?: string;
  /**
   * Set when the handler returns its own `Response` (file streams, exports).
   * Such responses bypass the JSON envelope entirely.
   */
  raw?: boolean;
  /**
   * Retirement signal for a deprecated surface. When set, `Deprecation` and
   * `Sunset` (and, for a declared successor, `Link`) headers are attached to
   * every response; `retiredWrite` additionally makes state-changing verbs
   * fail with 410 Gone while GET keeps serving the readable mirror. See
   * `http/deprecation.ts`.
   */
  deprecation?: DeprecationDeclaration;
  handler: (context: HandlerContext<TBody, TQuery>) => Promise<unknown> | unknown;
}

/**
 * Carries the `@Roles(...)` / `@RateLimit(...)` metadata for one endpoint.
 *
 * The guards read their configuration through a `Reflector` from a metadata
 * target, so each endpoint gets a unique function to hang metadata on. This
 * keeps the guards completely unmodified.
 */
export function createMetadataTarget(definition: EndpointDefinition<never, never>): () => void {
  const target = function endpointMetadata() {};
  if (definition.roles && definition.roles.length > 0) {
    Reflect.defineMetadata(ROLES_KEY, definition.roles, target);
  }
  if (definition.rateLimit) {
    Reflect.defineMetadata(RATE_LIMIT_POLICY_KEY, definition.rateLimit, target);
  }
  if (definition.allowWhenInactive) {
    Reflect.defineMetadata(ASSISTED_ALLOW_WHEN_INACTIVE_KEY, true, target);
  }
  return target;
}

/** Parses the JSON body, tolerating an absent/empty one exactly as Nest did. */
async function readJsonBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // Multipart and urlencoded bodies are consumed by the handler itself.
    return undefined;
  }

  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    // Express' json parser rejects malformed JSON with a 400 before the
    // handler ever runs; the same happens here.
    throw new BadRequestException('Unexpected token in JSON payload');
  }
}

/** Guard singletons — built once, from the shared container. */
function guards() {
  const c = getContainer();
  return {
    csrf: new CsrfGuard(c.config()),
    rateLimit: new RateLimitGuard(c.reflector(), c.config(), c.rateLimitStore()),
    jwtAuth: new JwtAuthGuard(c.jwt(), c.schoolAccess()),
    roles: new RolesGuard(c.reflector()),
    managedSchool: new ManagedSchoolGuard(c.reflector(), School as unknown as ManagedSchoolLookup),
  };
}

/**
 * Turns an endpoint definition into an App Router route handler.
 *
 * The returned function has the `(request, segmentData)` signature Next
 * passes to `GET`/`POST`/`PATCH`/`PUT`/`DELETE` exports.
 */
export function createRouteHandler<TBody, TQuery>(
  definition: EndpointDefinition<TBody, TQuery>,
): (
  request: Request,
  segmentData?: { params: Promise<Record<string, string>> | Record<string, string> },
) => Promise<Response> {
  const metadataTarget = createMetadataTarget(
    definition as unknown as EndpointDefinition<never, never>,
  );

  return async function routeHandler(request, segmentData) {
    const adaptedResponse = new AdaptedResponse();
    const cookieJar = new CookieJar();
    let adapted: AdaptedRequest | undefined;
    const startedAt = structuredLogger.start();

    // Retirement signals ride on every response — success or error — of a
    // deprecated surface (Deprecation / Sunset / Link headers).
    if (definition.deprecation) {
      applyDeprecationHeaders(adaptedResponse.headers, definition.deprecation);
    }

    try {
      // A permanently retired write surface closes state-changing verbs with
      // 410 Gone before any guard/validation work; reads keep mirroring.
      assertEndpointNotRetired(definition.deprecation, request.method);

      const params = segmentData?.params ? await segmentData.params : {};
      const body = await readJsonBody(request);
      adapted = adaptRequest({ request, params, body });

      const context = createExecutionContext({
        request: adapted,
        response: adaptedResponse,
        handler: metadataTarget,
        handlerClass: metadataTarget as unknown as Type,
      });

      const { csrf, rateLimit, jwtAuth, roles, managedSchool: managedSchoolGuard } = guards();

      // 1. CSRF — double-submit cookie + origin check on state-changing verbs.
      csrf.canActivate(context);

      // 2. Rate limit — runs before authentication, therefore keyed by IP.
      await rateLimit.canActivate(context);

      // 3. Authentication — bearer token, payload shape, school/user active.
      if (definition.auth !== false) {
        await jwtAuth.canActivate(context);
      }

      // 4. Authorization — @Roles(...) metadata.
      roles.canActivate(context);

      // 4b. Assisted management — resolve and validate the managed school
      //     from the route parameter (never from body/query/header).
      if (definition.managedSchool) {
        await managedSchoolGuard.canActivate(context);
      }

      // 5. Validation — the exact global ValidationPipe configuration.
      let validatedBody = adapted.body as TBody;
      if (definition.bodyType) {
        validatedBody = (await globalValidationPipe.transform(adapted.body ?? {}, {
          metatype: definition.bodyType as Type,
          type: 'body',
        })) as TBody;
      }

      let validatedQuery = adapted.query as TQuery;
      if (definition.queryType) {
        validatedQuery = (await globalValidationPipe.transform(adapted.query, {
          metatype: definition.queryType as Type,
          type: 'query',
        })) as TQuery;
      }

      // 5b. Idempotency — a replayed key returns the stored response without
      // re-executing the handler; a fresh key runs and its result is stored.
      const idempotency = resolveIdempotencyRequest(definition, adapted);
      let replayed: { status: number; body: Record<string, unknown> } | null = null;
      if (idempotency) {
        replayed = await findStoredIdempotentResponse(idempotency);
      }

      let result: unknown;
      if (replayed) {
        result = replayed.body;
      } else {
        result = await definition.handler({
          user: adapted.user as AuthenticatedRequestUser,
          body: validatedBody,
          query: validatedQuery,
          params,
          request: adapted,
          raw: request,
          cookies: cookieJar,
        });

        // Assisted-management mutations are audited once the handler has
        // succeeded, on the envelope the client will actually receive.
        if (definition.managedSchool) {
          await auditAssistedMutation(adapted, result);
        }

        // Replays never reach this branch, so a stored key always reflects
        // exactly one execution. Streaming/file responses bypass storage —
        // no idempotent endpoint returns one.
        if (idempotency && !(result instanceof Response)) {
          await storeIdempotentResponse(idempotency, successStatusFor(request, definition), result);
        }
      }

      const requestId = adapted[REQUEST_ID_PROPERTY] as string;

      // Streaming/file endpoints return their own Response and must bypass
      // the JSON envelope (exports, report downloads, import error files).
      if (result instanceof Response) {
        adaptedResponse.applyTo(result.headers);
        cookieJar.applyTo(result.headers);
        result.headers.set(REQUEST_ID_HEADER, requestId);
        structuredLogger.logSuccess(
          adapted as unknown as LoggableRequest,
          result.status,
          startedAt,
        );
        return result;
      }

      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      adaptedResponse.applyTo(headers);
      cookieJar.applyTo(headers);
      headers.set(REQUEST_ID_HEADER, requestId);

      const status = replayed?.status ?? successStatusFor(request, definition);

      structuredLogger.logSuccess(adapted as unknown as LoggableRequest, status, startedAt);

      return new Response(JSON.stringify(wrapSuccess(result)), { status, headers });
    } catch (error) {
      const envelope = buildErrorEnvelope(error, {
        method: request.method,
        url: adapted?.url ?? request.url,
      });

      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      // Rate-limit headers (including Retry-After on a 429) were recorded by
      // the guard before it threw, so they must survive onto the error too.
      adaptedResponse.applyTo(headers);
      cookieJar.applyTo(headers);
      // Every response — success or error — carries the correlation id, so a
      // client can quote it when reporting a failure. When the failure
      // happened before the request was adapted (malformed JSON), the id is
      // resolved from the incoming headers with the same rule.
      headers.set(
        REQUEST_ID_HEADER,
        (adapted?.[REQUEST_ID_PROPERTY] as string | undefined) ??
          resolveRequestId(request.headers.get(REQUEST_ID_HEADER)),
      );

      structuredLogger.logError(
        (adapted ?? {
          method: request.method,
          url: request.url,
          headers: {},
        }) as unknown as LoggableRequest,
        envelope.status,
        startedAt,
        error instanceof Error ? error : new Error(String(error)),
      );

      return new Response(JSON.stringify(envelope.body), {
        status: envelope.status,
        headers,
      });
    }
  };
}

/**
 * Convenience wrapper for a route file that serves several verbs.
 *
 * ```ts
 * export const { GET, POST } = createRouteHandlers({ GET: listBuses, POST: createBus });
 * ```
 */
export function createRouteHandlers(
  definitions: Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', EndpointDefinition>>,
): Record<string, ReturnType<typeof createRouteHandler>> {
  const handlers: Record<string, ReturnType<typeof createRouteHandler>> = {};
  for (const [method, definition] of Object.entries(definitions)) {
    if (definition) {
      handlers[method] = createRouteHandler(definition);
    }
  }
  return handlers;
}

/**
 * Records the assisted-mutation audit row.
 *
 * The original interceptor observed the *wrapped* envelope, so the same shape
 * is reconstructed here before handing it over — the entity id is read from
 * `payload.data.id`.
 */
async function auditAssistedMutation(request: AdaptedRequest, result: unknown): Promise<void> {
  const c = getContainer();
  const interceptor = new AssistedMutationAuditInterceptor(c.audit(), c.assistedSession());
  await interceptor.record(
    request as unknown as ManagedRequest,
    wrapSuccess(result) as { success?: boolean; data?: unknown },
  );
}

/** Success status for a freshly executed handler (replays keep their own). */
/**
 * The erased endpoint shape for helpers that only read transport-agnostic
 * metadata (idempotency scope, declared status). `any` keeps the DTO
 * generics from surfacing in these helpers while the strict-mode web
 * typecheck stays honest about handler contravariance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ErasedEndpointDefinition = EndpointDefinition<any, any>;

function successStatusFor(request: Request, definition: ErasedEndpointDefinition): number {
  return definition.status ?? (request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
}

/** One idempotent request: tenant + user + endpoint scope plus the client key. */
interface IdempotencyRequest {
  schoolId: string;
  userId: string;
  endpoint: string;
  idempotencyKey: string;
}

/**
 * Resolves the idempotency scope for this request, or null when idempotency
 * does not apply: the endpoint did not declare it, the client sent no key, or
 * there is no tenant/user scope to isolate the key by (idempotent endpoints
 * are tenant routes, so the guards have already guaranteed both — the check
 * is defence in depth).
 *
 * An oversized key is a client error: the column holds 255 chars and silently
 * truncating would merge distinct operations into one.
 */
function resolveIdempotencyRequest(
  definition: ErasedEndpointDefinition,
  adapted: AdaptedRequest,
): IdempotencyRequest | null {
  if (!definition.idempotency) {
    return null;
  }
  const raw = adapted.headers[IDEMPOTENCY_HEADER];
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  if (key.length === 0) {
    return null;
  }
  if (key.length > 255) {
    throw new BadRequestException('x-idempotency-key must be at most 255 characters long');
  }
  const user = adapted.user;
  const schoolId = user?.school_id;
  const userId = user?.id;
  if (typeof schoolId !== 'string' || schoolId.length === 0) {
    return null;
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    return null;
  }
  return { schoolId, userId, endpoint: definition.idempotency, idempotencyKey: key };
}

/**
 * Returns the stored response for a replayed key, or null for a fresh key.
 *
 * Fail-open by design: when the lookup itself errors (a database blip), the
 * request proceeds as a fresh one instead of failing a mutation the database
 * might still accept. The handler's own guards (unique indexes, 409s) remain
 * the backstop against duplicates.
 */
async function findStoredIdempotentResponse(
  idempotency: IdempotencyRequest,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    const outcome = await getContainer().idempotency().check({
      schoolId: idempotency.schoolId,
      userId: idempotency.userId,
      endpoint: idempotency.endpoint,
      idempotencyKey: idempotency.idempotencyKey,
    });
    if (outcome.status === 'duplicate') {
      return { status: outcome.responseStatus, body: outcome.responseBody };
    }
    return null;
  } catch (error) {
    routeLogger.warn(
      `Idempotency lookup failed, proceeding as a fresh request: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Stores the result of one execution. Best-effort: a storage failure is
 * logged but never fails the already-successful mutation. A concurrent
 * request that stored first wins (unique constraint); the service swallows
 * that race and this request simply returns its own identical result.
 */
async function storeIdempotentResponse(
  idempotency: IdempotencyRequest,
  status: number,
  result: unknown,
): Promise<void> {
  try {
    const serializable = JSON.parse(JSON.stringify(result ?? null)) as Record<string, unknown>;
    await getContainer().idempotency().store({
      schoolId: idempotency.schoolId,
      userId: idempotency.userId,
      endpoint: idempotency.endpoint,
      idempotencyKey: idempotency.idempotencyKey,
      responseStatus: status,
      responseBody: serializable,
    });
  } catch (error) {
    routeLogger.warn(
      `Idempotency store failed for key=${idempotency.idempotencyKey}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Narrows the verified JWT claims to a non-null tenant context.
 *
 * Tenant routes are reachable only by non-platform roles, whose access-token
 * payload validation already guarantees a non-empty `school_id` — the same
 * assumption the `@CurrentUser() user: TenantRequestUser` parameter type
 * encoded, made explicit at the one place it is relied upon.
 */
export function tenantUser(user: AuthenticatedRequestUser): TenantRequestUser {
  return user as TenantRequestUser;
}
