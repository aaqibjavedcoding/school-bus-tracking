import { Module } from '@nestjs/common';
import { School, User } from '../../database/models';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { SCHOOLS_REPOSITORY, SCHOOLS_USERS_REPOSITORY } from './schools.constants';

/**
 * School onboarding module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
 */
@Module({
  controllers: [SchoolsController],
  providers: [
    SchoolsService,
    { provide: SCHOOLS_REPOSITORY, useValue: School },
    { provide: SCHOOLS_USERS_REPOSITORY, useValue: User },
  ],
  exports: [SchoolsService],
})
export class SchoolsModule {}
