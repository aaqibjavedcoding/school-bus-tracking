/**
 * Endpoint definitions for the `health` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, ServiceUnavailableException } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
/** `GET /api/v1/health` */
export const getHealth: EndpointDefinition = {
  // Liveness probes (load balancers, container orchestrators, uptime monitors)
  // call this endpoint without credentials. It must stay public: requiring
  // auth here turns every production health check into a 401.
  auth: false,
  status: HttpStatus.OK,
  handler: async () => {
    return container().health().getHealth();
  },
};

/** `GET /api/v1/health/ready` */
export const getHealthReady: EndpointDefinition = {
  // Readiness probes are unauthenticated by design, same as liveness above.
  // The response carries no tenant data — only aggregate dependency state.
  auth: false,
  status: HttpStatus.OK,
  handler: async () => {
    const readiness = await container().health().getReadiness();
    if (readiness.status !== 'ready') {
      // The exception body must be a real error shape (`message`/`error`/
      // `details`): throwing the readiness object verbatim used to surface a
      // misleading "Internal server error" message while dropping the very
      // per-dependency states the probe exists to report. Only the aggregate
      // `checks` map ('ok'/'fail' per dependency) is forwarded — the raw
      // `reason` string can carry driver internals (host, port, query
      // fragments) and stays server-side, where `HealthService` already logs
      // it. This endpoint is unauthenticated, so nothing else may leak here.
      throw new ServiceUnavailableException({
        message: 'Service not ready',
        error: 'SERVICE_NOT_READY',
        details: { checks: readiness.checks },
      });
    }
    return readiness;
  },
};
