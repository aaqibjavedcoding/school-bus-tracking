import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { BusesController } from './buses.controller';
import { BusesService } from './buses.service';
import {
  BUSES_REPOSITORY,
  BUSES_ROUTE_ASSIGNMENTS_REPOSITORY,
  BUSES_ROUTES_REPOSITORY,
  BUSES_TRIPS_REPOSITORY,
  BUSES_USERS_REPOSITORY,
} from './buses.constants';

/**
 * Fleet (bus) management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs. The
 * roster / route / crew / trip repositories are injected for the human-readable
 * assignment enrichment on list and detail responses.
 */
@Module({
  controllers: [BusesController],
  providers: [
    BusesService,
    { provide: BUSES_REPOSITORY, useValue: Bus },
    { provide: BUSES_ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: BUSES_ROUTES_REPOSITORY, useValue: Route },
    { provide: BUSES_USERS_REPOSITORY, useValue: User },
    { provide: BUSES_TRIPS_REPOSITORY, useValue: Trip },
  ],
  exports: [BusesService],
})
export class BusesModule {}
