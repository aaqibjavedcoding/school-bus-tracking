import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import {
  TRIPS_BUSES_REPOSITORY,
  TRIPS_REPOSITORY,
  TRIPS_ROUTE_ASSIGNMENTS_REPOSITORY,
  TRIPS_ROUTES_REPOSITORY,
  TRIPS_USERS_REPOSITORY,
} from './trips.constants';

/**
 * Trip management module.
 *
 * The model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable while
 * `DB_AUTO_CONNECT=false`.
 */
@Module({
  controllers: [TripsController],
  providers: [
    TripsService,
    { provide: TRIPS_REPOSITORY, useValue: Trip },
    { provide: TRIPS_ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: TRIPS_ROUTES_REPOSITORY, useValue: Route },
    { provide: TRIPS_BUSES_REPOSITORY, useValue: Bus },
    { provide: TRIPS_USERS_REPOSITORY, useValue: User },
  ],
  exports: [TripsService],
})
export class TripsModule {}
