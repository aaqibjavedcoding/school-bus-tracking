import { Module } from '@nestjs/common';
import { RetentionWorker } from './retention.worker';

/**
 * Workers module for background jobs.
 *
 * Provides PostgreSQL-backed job infrastructure without paid queue services.
 * Uses advisory locks for concurrency safety.
 */
@Module({
  providers: [RetentionWorker],
  exports: [RetentionWorker],
})
export class WorkersModule {}
