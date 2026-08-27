import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthResponse } from '@school-bus-tracking/shared-types';

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  constructor(private readonly configService: ConfigService) {}

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
}
