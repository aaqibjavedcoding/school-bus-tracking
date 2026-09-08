import { REQUEST_ID_PROPERTY } from '../../common/middleware/request-id.middleware';
import type { HandlerContext } from '../../http/route-runtime';

/**
 * Request-scoped fields every handler-level audit event should carry.
 *
 * `request_id` joins the audit row to the request logs (the runtime resolves
 * the client-supplied `x-request-id` or mints one for every response), and
 * `ip_address` records the client IP the adapter resolved from the proxy
 * headers. Both degrade to `null` outside the HTTP runtime (CLI, tests)
 * rather than throwing.
 */
export function auditRequestContext(ctx: Pick<HandlerContext, 'request'>): {
  request_id: string | null;
  ip_address: string | null;
} {
  const request = ctx.request as unknown as Record<string, unknown> | undefined;
  const requestId = request?.[REQUEST_ID_PROPERTY];
  const ip = request?.['ip'];
  return {
    request_id: typeof requestId === 'string' && requestId.length > 0 ? requestId : null,
    ip_address: typeof ip === 'string' && ip.length > 0 ? ip : null,
  };
}
