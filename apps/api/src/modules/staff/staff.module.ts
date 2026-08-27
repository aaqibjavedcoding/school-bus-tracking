import { Module } from '@nestjs/common';
import { User } from '../../database/models';
import { ConductorsController } from './conductors.controller';
import { DriversController } from './drivers.controller';
import { StaffService } from './staff.service';
import { STAFF_REPOSITORY } from './staff.constants';

/**
 * Driver and conductor staff management module.
 *
 * One {@link StaffService} backs both the `/drivers` and `/conductors`
 * controllers; the role is pinned per controller instead of per request, so
 * no request path can create or update a user outside its fixed role. The
 * model class is provided behind a token so the app still boots with
 * `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
 */
@Module({
  controllers: [DriversController, ConductorsController],
  providers: [StaffService, { provide: STAFF_REPOSITORY, useValue: User }],
  exports: [StaffService],
})
export class StaffModule {}
