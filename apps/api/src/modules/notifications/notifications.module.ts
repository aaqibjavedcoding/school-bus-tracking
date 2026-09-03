import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeviceToken,
  Notification,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../database/models';
import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { createPushProvider } from './providers';
import {
  NOTIFICATIONS_DEVICE_TOKENS_REPOSITORY,
  NOTIFICATIONS_GUARDIANS_REPOSITORY,
  NOTIFICATIONS_PUSH_PROVIDER,
  NOTIFICATIONS_REPOSITORY,
  NOTIFICATIONS_STOPS_REPOSITORY,
  NOTIFICATIONS_STUDENTS_REPOSITORY,
  NOTIFICATIONS_TRIPS_REPOSITORY,
  NOTIFICATIONS_USERS_REPOSITORY,
} from './notifications.constants';

/**
 * Parent notifications + push device registration module (Tasks 21/46).
 *
 * The model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable
 * while `DB_AUTO_CONNECT=false`.
 *
 * The push provider is selected once per process by env:
 * `FIREBASE_SERVICE_ACCOUNT_JSON` set → `FcmPushProvider` (free FCM via
 * firebase-admin); otherwise `NoOpPushProvider`, so local dev and CI without
 * credentials keep working unchanged. The credential value is only parsed by
 * the provider factory and is never logged.
 *
 * The module exports `NotificationsService` so the existing
 * `TripAttendanceModule` and `TripsModule` can create notifications *after*
 * their own operations succeed — the notification flow never duplicates any
 * attendance or trip business logic, it only observes successful outcomes.
 * The gateway's socket surface stays private to this module.
 */
@Module({
  controllers: [NotificationsController, DeviceTokensController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    DeviceTokensService,
    {
      provide: NOTIFICATIONS_PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createPushProvider({
          serviceAccountJson: configService.get<string | null>(
            'notifications.firebaseServiceAccountJson',
          ),
          projectId: configService.get<string | null>('notifications.firebaseProjectId'),
        }),
    },
    { provide: NOTIFICATIONS_REPOSITORY, useValue: Notification },
    { provide: NOTIFICATIONS_USERS_REPOSITORY, useValue: User },
    { provide: NOTIFICATIONS_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: NOTIFICATIONS_STUDENTS_REPOSITORY, useValue: Student },
    { provide: NOTIFICATIONS_STOPS_REPOSITORY, useValue: Stop },
    { provide: NOTIFICATIONS_TRIPS_REPOSITORY, useValue: Trip },
    { provide: NOTIFICATIONS_DEVICE_TOKENS_REPOSITORY, useValue: DeviceToken },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
