import { Module } from '@nestjs/common';
import {
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripStudentAttendance,
} from '../../database/models';
import { NotificationsModule } from '../notifications/notifications.module';
import { TripAttendanceController } from './trip-attendance.controller';
import { TripAttendanceService } from './trip-attendance.service';
import {
  TRIP_ATTENDANCE_GUARDIANS_REPOSITORY,
  TRIP_ATTENDANCE_REPOSITORY,
  TRIP_ATTENDANCE_ROUTE_ASSIGNMENTS_REPOSITORY,
  TRIP_ATTENDANCE_STOPS_REPOSITORY,
  TRIP_ATTENDANCE_STUDENTS_REPOSITORY,
  TRIP_ATTENDANCE_TRIPS_REPOSITORY,
} from './trip-attendance.constants';

/**
 * Trip student attendance module.
 *
 * The model repositories are token-backed so this feature follows the
 * existing migration-driven Sequelize pattern and remains unit-testable while
 * `DB_AUTO_CONNECT=false`. No model or guard is redeclared here — the trip,
 * route assignment, stop, student and guardian tables are the ones created by
 * the earlier phases.
 *
 * `NotificationsModule` is imported (its service is best-effort and never
 * throws) so a committed boarding/drop can notify the linked parents — the
 * notification is created strictly after the attendance transaction succeeds.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [TripAttendanceController],
  providers: [
    TripAttendanceService,
    { provide: TRIP_ATTENDANCE_REPOSITORY, useValue: TripStudentAttendance },
    { provide: TRIP_ATTENDANCE_TRIPS_REPOSITORY, useValue: Trip },
    { provide: TRIP_ATTENDANCE_STOPS_REPOSITORY, useValue: Stop },
    { provide: TRIP_ATTENDANCE_STUDENTS_REPOSITORY, useValue: Student },
    { provide: TRIP_ATTENDANCE_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: TRIP_ATTENDANCE_ROUTE_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
  ],
  exports: [TripAttendanceService],
})
export class TripAttendanceModule {}
