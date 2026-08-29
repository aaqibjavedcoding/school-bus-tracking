import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Stop, TripStopArrival } from '../../database/models';
import { LiveTrackingModule } from '../live-tracking/live-tracking.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EtaController } from './eta.controller';
import { EtaService } from './eta.service';
import { StopArrivalsService } from './stop-arrivals.service';
import { ETA_ARRIVALS_REPOSITORY, ETA_CONFIG, ETA_STOPS_REPOSITORY } from './eta.constants';
import type { EtaConfig } from './eta.service';

/**
 * Task 22 module — approximate ETA + geofence stop-arrival detection.
 *
 * The module reuses the existing infrastructure instead of duplicating it:
 *
 * - the controller authorizes every read through
 *   `LiveTrackingService.authorizeObservation` (the exact observer rule the
 *   location endpoints apply), hence the (forward-ref'd) import of
 *   `LiveTrackingModule`;
 * - `StopArrivalsService` is invoked by `LiveTrackingService` after every
 *   accepted latest fix, so `LiveTrackingModule` imports this module and
 *   exports both services;
 * - arrival broadcasts travel through the *same* authenticated trip room
 *   broadcaster the tracking gateway already owns;
 * - parent notifications go through the Task 21 `NotificationsModule`.
 *
 * The model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable
 * while `DB_AUTO_CONNECT=false`. The `EtaConfig` object is built from the
 * environment-backed `eta` configuration namespace.
 */
@Module({
  imports: [forwardRef(() => LiveTrackingModule), NotificationsModule],
  controllers: [EtaController],
  providers: [
    EtaService,
    StopArrivalsService,
    { provide: ETA_STOPS_REPOSITORY, useValue: Stop },
    { provide: ETA_ARRIVALS_REPOSITORY, useValue: TripStopArrival },
    {
      provide: ETA_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): EtaConfig => ({
        fallbackSpeedKmh: configService.get<number>('eta.fallbackSpeedKmh') ?? 25,
        minSpeedKmh: configService.get<number>('eta.minSpeedKmh') ?? 5,
        maxSpeedKmh: configService.get<number>('eta.maxSpeedKmh') ?? 90,
      }),
    },
  ],
  exports: [EtaService, StopArrivalsService],
})
export class EtaModule {}
