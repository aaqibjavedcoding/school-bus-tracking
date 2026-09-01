import { Global, Module } from '@nestjs/common';
import { School, User } from '../../database/models';
import { SCHOOLS_PLATFORM_REPOSITORY, USERS_PLATFORM_REPOSITORY } from './access.constants';
import { SchoolAccessService } from './school-access.service';

/**
 * Platform-wide access module.
 *
 * Registered as `@Global` so `SchoolAccessService` is injectable by the
 * shared `JwtAuthGuard` (which guards controllers in every feature module)
 * without each module having to import it. The service encapsulates the
 * single centralized rule for school lifecycle (inactive tenant) access.
 *
 * `School` is provided as the bare model class (same pattern as every feature
 * module). `DatabaseModule.forRoot()` is responsible for attaching it to the
 * live Sequelize connection so `findOne` works at runtime.
 */
@Global()
@Module({
  providers: [
    SchoolAccessService,
    { provide: SCHOOLS_PLATFORM_REPOSITORY, useValue: School },
    { provide: USERS_PLATFORM_REPOSITORY, useValue: User },
  ],
  exports: [SchoolAccessService],
})
export class AccessModule {}
