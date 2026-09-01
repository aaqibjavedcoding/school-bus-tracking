import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import type { HealthResponse, ReadinessResponse } from '@school-bus-tracking/shared-types';

/**
 * Health and readiness endpoints.
 *
 * - `GET /health` — liveness probe (always 200 if process is alive).
 * - `GET /health/ready` — readiness probe (503 when not ready).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness probe. Returns 200 if the process is alive.
   * Used by container orchestrators to detect hung processes.
   */
  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  /**
   * Readiness probe. Returns 200 only when the API can serve traffic.
   * Returns 503 when database or schema is not ready.
   * Used by load balancers to route traffic only to healthy instances.
   */
  @Get('ready')
  async getReadiness(): Promise<ReadinessResponse> {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status !== 'ready') {
      throw new ServiceUnavailableException(readiness);
    }
    return readiness;
  }
}
