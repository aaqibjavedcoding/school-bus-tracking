import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { ConductorsController } from './conductors.controller';
import { DriversController } from './drivers.controller';
import { StaffService } from './staff.service';
import {
  STAFF_BUSES_REPOSITORY,
  STAFF_REPOSITORY,
  STAFF_ROUTE_ASSIGNMENTS_REPOSITORY,
  STAFF_ROUTES_REPOSITORY,
  STAFF_TRIPS_REPOSITORY,
} from './staff.constants';

/**
 * Driver and conductor staff management module.
 *
 * One {@link StaffService} backs both the `/drivers` and `/conductors`
 * controllers; the role is pinned per controller instead of per request, so
 * no request path can create or update a user outside its fixed role. The
 * model class is provided behind a token so the app still boots with
 * `DB_AUTO_CONNECT=false` and unit tests can inject stubs. The roster, route,
 * bus and trip repositories power the human-readable assignment enrichment.
 */
@Module({
  controllers: [DriversController, ConductorsController],
  providers: [
    StaffService,
    { provide: STAFF_REPOSITORY, useValue: User },
    { provide: STAFF_ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: STAFF_ROUTES_REPOSITORY, useValue: Route },
    { provide: STAFF_BUSES_REPOSITORY, useValue: Bus },
    { provide: STAFF_TRIPS_REPOSITORY, useValue: Trip },
  ],
  exports: [StaffService],
})
export class StaffModule {}
