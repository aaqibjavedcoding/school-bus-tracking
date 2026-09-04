/**
 * Endpoint definitions for the `health` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, ServiceUnavailableException, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { HealthService } from '../modules/health/health.service';
import type { HealthResponse, ReadinessResponse } from '@school-bus-tracking/shared-types';

/** `GET /api/v1/health` */
export const getHealth: EndpointDefinition = {
  status: HttpStatus.OK,
  handler: async () => {
    return container().health().getHealth();
  },
};

/** `GET /api/v1/health/ready` */
export const getHealthReady: EndpointDefinition = {
  status: HttpStatus.OK,
  handler: async () => {
    const readiness = await container().health().getReadiness();
    if (readiness.status !== 'ready') {
    throw new ServiceUnavailableException(readiness as unknown as Record<string, unknown>);
    }
    return readiness;
  },
};
