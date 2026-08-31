import { Module } from '@nestjs/common';
import { Bus, EmergencyEvent, Route, Trip, User } from '../../database/models';
import { EmergenciesController } from './emergencies.controller';
import { EmergenciesGateway } from './emergencies.gateway';
import { EmergenciesService } from './emergencies.service';
import {
  EMERGENCIES_BUS_REPOSITORY,
  EMERGENCIES_REPOSITORY,
  EMERGENCIES_ROUTE_REPOSITORY,
  EMERGENCIES_TRIP_REPOSITORY,
  EMERGENCIES_USER_REPOSITORY,
} from './emergencies.constants';

/**
 * Crew SOS / emergency events (Task 44).
 *
 * The REST controller records and serves the events; the Socket.IO gateway
 * pushes them to the tenant's own room over the self-hosted namespace. Model
 * classes are provided behind tokens so the app still boots with
 * `DB_AUTO_CONNECT=false` and unit tests can inject in-memory stubs.
 *
 * No paid third-party service is wired here — delivery is database +
 * Socket.IO only.
 */
@Module({
  controllers: [EmergenciesController],
  providers: [
    EmergenciesService,
    EmergenciesGateway,
    { provide: EMERGENCIES_REPOSITORY, useValue: EmergencyEvent },
    { provide: EMERGENCIES_TRIP_REPOSITORY, useValue: Trip },
    { provide: EMERGENCIES_BUS_REPOSITORY, useValue: Bus },
    { provide: EMERGENCIES_ROUTE_REPOSITORY, useValue: Route },
    { provide: EMERGENCIES_USER_REPOSITORY, useValue: User },
  ],
  exports: [EmergenciesService],
})
export class EmergenciesModule {}
