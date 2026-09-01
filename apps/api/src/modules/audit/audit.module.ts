import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLog, School, User } from '../../database/models';
import { AUDIT_REPOSITORY, AUDIT_SCHOOL_REPOSITORY, AUDIT_USER_REPOSITORY } from './audit.constants';

/**
 * Audit logging module.
 *
 * Provides a fire-and-forget `AuditService` that other modules inject to
 * record security-relevant and operational events. The controller exposes
 * a read-only audit-log listing for the admin UI.
 */
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: AUDIT_REPOSITORY, useValue: AuditLog },
    { provide: AUDIT_USER_REPOSITORY, useValue: User },
    { provide: AUDIT_SCHOOL_REPOSITORY, useValue: School },
  ],
  exports: [AuditService],
})
export class AuditModule {}
