import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, Stop, Student, Trip, User } from '../../database/models';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import {
  ROUTES_BUSES_REPOSITORY,
  ROUTES_REPOSITORY,
  ROUTES_ROUTE_ASSIGNMENTS_REPOSITORY,
  ROUTES_STOPS_REPOSITORY,
  ROUTES_STUDENTS_REPOSITORY,
  ROUTES_TRIPS_REPOSITORY,
  ROUTES_USERS_REPOSITORY,
} from './routes.constants';

/**
 * Route management module.
 *
 * Model classes are provided behind tokens (like AuthModule) so the app still
 * boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs. The
 * roster / crew / bus / trip / student repositories power the human-readable
 * route list and detail enrichment.
 */
@Module({
  controllers: [RoutesController],
  providers: [
    RoutesService,
    { provide: ROUTES_REPOSITORY, useValue: Route },
    { provide: ROUTES_STOPS_REPOSITORY, useValue: Stop },
    { provide: ROUTES_ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: ROUTES_USERS_REPOSITORY, useValue: User },
    { provide: ROUTES_BUSES_REPOSITORY, useValue: Bus },
    { provide: ROUTES_TRIPS_REPOSITORY, useValue: Trip },
    { provide: ROUTES_STUDENTS_REPOSITORY, useValue: Student },
  ],
  exports: [RoutesService],
})
export class RoutesModule {}
