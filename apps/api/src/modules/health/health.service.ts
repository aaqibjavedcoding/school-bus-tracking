import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import type { HealthResponse, ReadinessResponse } from '@school-bus-tracking/shared-types';

/**
 * Health and readiness checks.
 *
 * **Liveness** (`/health`) — confirms the API process is alive. Always returns
 * 200 if the process can handle HTTP requests.
 *
 * **Readiness** (`/health/ready`) — confirms the API can serve traffic:
 * - application initialized
 * - PostgreSQL connection alive
 * - Sequelize usable
 * - migrations applied (schema exists)
 *
 * Returns 503 when any readiness check fails.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectConnection()
    private readonly sequelize?: Sequelize,
  ) {}

  /**
   * Liveness probe. Always returns 200 if the process is running.
   */
  getHealth(): HealthResponse {
    const environment = this.configService.get<string>('app.nodeEnv', 'development');
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: 'ok',
      service: 'school-bus-tracking-api',
      version: '0.1.0',
      uptime: uptimeSeconds,
      timestamp: new Date().toISOString(),
      environment,
    };
  }

  /**
   * Readiness probe. Returns 200 only when all checks pass.
   */
  async getReadiness(): Promise<ReadinessResponse> {
    const checks: ReadinessResponse['checks'] = {
      database: 'fail',
      sequelize: 'fail',
      schema: 'fail',
    };

    try {
      // 1. PostgreSQL connection.
      if (!this.sequelize) {
        return { status: 'not_ready', checks, reason: 'No database connection configured' };
      }

      await this.sequelize.authenticate();
      checks.database = 'ok';

      // 2. Sequelize usable (raw query).
      await this.sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
      checks.sequelize = 'ok';

      // 3. Schema/migration readiness — check that core tables exist.
      const result = await this.sequelize.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'schools'
        ) as exists`,
        { type: QueryTypes.SELECT },
      );
      if (result[0]?.exists) {
        checks.schema = 'ok';
      }

      const allOk = Object.values(checks).every((v) => v === 'ok');
      return {
        status: allOk ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        status: 'not_ready',
        checks,
        reason: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
