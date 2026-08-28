import { Module } from '@nestjs/common';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { LiveTrackingModule } from '../live-tracking/live-tracking.module';
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
 *
 * `LiveTrackingModule` is imported (and its service exported back) so every
 * lifecycle transition — including the soft delete that cancels still-open
 * runs — can notify the tracking pipeline: observers get a
 * `trip:tracking:started` / `trip:tracking:stopped` event and the server
 * stops accepting new fixes the moment a trip becomes terminal.
 */
@Module({
  imports: [LiveTrackingModule],
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
