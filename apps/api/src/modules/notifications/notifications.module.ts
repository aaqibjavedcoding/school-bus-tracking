import { Module } from '@nestjs/common';
import { Notification, Stop, Student, StudentGuardian, Trip, User } from '../../database/models';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import {
  NOTIFICATIONS_GUARDIANS_REPOSITORY,
  NOTIFICATIONS_REPOSITORY,
  NOTIFICATIONS_STOPS_REPOSITORY,
  NOTIFICATIONS_STUDENTS_REPOSITORY,
  NOTIFICATIONS_TRIPS_REPOSITORY,
  NOTIFICATIONS_USERS_REPOSITORY,
} from './notifications.constants';

/**
 * Parent notifications module (Task 21).
 *
 * The model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable
 * while `DB_AUTO_CONNECT=false`.
 *
 * The module exports `NotificationsService` so the existing
 * `TripAttendanceModule` and `TripsModule` can create notifications *after*
 * their own operations succeed — the notification flow never duplicates any
 * attendance or trip business logic, it only observes successful outcomes.
 * The gateway's socket surface stays private to this module.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    { provide: NOTIFICATIONS_REPOSITORY, useValue: Notification },
    { provide: NOTIFICATIONS_USERS_REPOSITORY, useValue: User },
    { provide: NOTIFICATIONS_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: NOTIFICATIONS_STUDENTS_REPOSITORY, useValue: Student },
    { provide: NOTIFICATIONS_STOPS_REPOSITORY, useValue: Stop },
    { provide: NOTIFICATIONS_TRIPS_REPOSITORY, useValue: Trip },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
