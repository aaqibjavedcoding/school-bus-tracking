import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripLocation,
} from '../../database/models';
import { EtaModule } from '../eta/eta.module';
import { LiveTrackingController } from './live-tracking.controller';
import { LiveTrackingGateway } from './live-tracking.gateway';
import { LiveTrackingService } from './live-tracking.service';
import {
  LIVE_TRACKING_ASSIGNMENTS_REPOSITORY,
  LIVE_TRACKING_CONFIG,
  LIVE_TRACKING_GUARDIANS_REPOSITORY,
  LIVE_TRACKING_REPOSITORY,
  LIVE_TRACKING_STOPS_REPOSITORY,
  LIVE_TRACKING_STUDENTS_REPOSITORY,
  LIVE_TRACKING_TRIPS_REPOSITORY,
} from './live-tracking.constants';

/**
 * Live GPS tracking module (Phase 5).
 *
 * The model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable
 * while `DB_AUTO_CONNECT=false`. The `LiveTrackingConfig` object is built
 * from the environment-backed configuration in `config/live-tracking.config`,
 * so the throttle interval and clock-skew windows are tunable per deployment.
 *
 * The module exports `LiveTrackingService` so `TripsModule` can notify it
 * about lifecycle transitions (tracking start / stop); nothing else is
 * shared — the gateway's socket surface stays private to this module.
 *
 * Task 22: the module imports `EtaModule` so the accepted-fix pipeline can
 * feed the geofence/arrival evaluation (`StopArrivalsService`) and the
 * gateway can attach its room broadcaster to the arrival/ETA broadcasts.
 */
@Module({
  imports: [EtaModule],
  controllers: [LiveTrackingController],
  providers: [
    LiveTrackingService,
    LiveTrackingGateway,
    { provide: LIVE_TRACKING_REPOSITORY, useValue: TripLocation },
    { provide: LIVE_TRACKING_TRIPS_REPOSITORY, useValue: Trip },
    { provide: LIVE_TRACKING_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: LIVE_TRACKING_STUDENTS_REPOSITORY, useValue: Student },
    { provide: LIVE_TRACKING_STOPS_REPOSITORY, useValue: Stop },
    { provide: LIVE_TRACKING_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    {
      provide: LIVE_TRACKING_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        gpsMinIntervalMs: configService.get<number>('liveTracking.gpsMinIntervalMs') ?? 2500,
        maxFutureSkewMs: configService.get<number>('liveTracking.maxFutureSkewMs') ?? 300_000,
        maxPastSkewMs: configService.get<number>('liveTracking.maxPastSkewMs') ?? 86_400_000,
      }),
    },
  ],
  exports: [LiveTrackingService],
})
export class LiveTrackingModule {}
