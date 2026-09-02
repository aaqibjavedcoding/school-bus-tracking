import { Module } from '@nestjs/common';
import {
  Bus,
  BusDocument,
  DriverDocument,
  Notification,
  Route,
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripStudentAttendance,
  User,
} from '../../database/models';
import { AuditModule } from '../audit';
import {
  REPORTS_ASSIGNMENTS_REPOSITORY,
  REPORTS_ATTENDANCE_REPOSITORY,
  REPORTS_BUSES_REPOSITORY,
  REPORTS_BUS_DOCUMENTS_REPOSITORY,
  REPORTS_DRIVER_DOCUMENTS_REPOSITORY,
  REPORTS_GUARDIANS_REPOSITORY,
  REPORTS_NOTIFICATIONS_REPOSITORY,
  REPORTS_ROUTES_REPOSITORY,
  REPORTS_STOPS_REPOSITORY,
  REPORTS_STUDENTS_REPOSITORY,
  REPORTS_TRIPS_REPOSITORY,
  REPORTS_USERS_REPOSITORY,
} from './reports.constants';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * School-admin reporting module.
 *
 * Read-only: it provides no write path at all, which is the simplest way to
 * guarantee a report can never mutate the data it describes.
 */
@Module({
  imports: [AuditModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    { provide: REPORTS_STUDENTS_REPOSITORY, useValue: Student },
    { provide: REPORTS_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: REPORTS_USERS_REPOSITORY, useValue: User },
    { provide: REPORTS_BUSES_REPOSITORY, useValue: Bus },
    { provide: REPORTS_ROUTES_REPOSITORY, useValue: Route },
    { provide: REPORTS_STOPS_REPOSITORY, useValue: Stop },
    { provide: REPORTS_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: REPORTS_TRIPS_REPOSITORY, useValue: Trip },
    { provide: REPORTS_ATTENDANCE_REPOSITORY, useValue: TripStudentAttendance },
    { provide: REPORTS_NOTIFICATIONS_REPOSITORY, useValue: Notification },
    { provide: REPORTS_BUS_DOCUMENTS_REPOSITORY, useValue: BusDocument },
    { provide: REPORTS_DRIVER_DOCUMENTS_REPOSITORY, useValue: DriverDocument },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
