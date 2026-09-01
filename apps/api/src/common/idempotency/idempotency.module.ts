import { Module, Global } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKey } from '../../database/models';
import { IDEMPOTENCY_REPOSITORY } from './idempotency.constants';

/**
 * Global idempotency module.
 *
 * Provides `IdempotencyService` to any module that needs it. The service
 * is global because idempotent operations span multiple feature modules
 * (attendance, emergencies, trips).
 */
@Global()
@Module({
  providers: [
    IdempotencyService,
    { provide: IDEMPOTENCY_REPOSITORY, useValue: IdempotencyKey },
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
