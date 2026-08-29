import { Module } from '@nestjs/common';
import {
  Bus,
  Route,
  School,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../database/models';
import { LiveTrackingModule } from '../live-tracking/live-tracking.module';
import { EtaModule } from '../eta/eta.module';
import { TripAttendanceModule } from '../trip-attendance/trip-attendance.module';
import { ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';
import {
  PARENT_PORTAL_BUSES_REPOSITORY,
  PARENT_PORTAL_GUARDIANS_REPOSITORY,
  PARENT_PORTAL_ROUTES_REPOSITORY,
  PARENT_PORTAL_SCHOOLS_REPOSITORY,
  PARENT_PORTAL_STOPS_REPOSITORY,
  PARENT_PORTAL_STUDENTS_REPOSITORY,
  PARENT_PORTAL_TRIPS_REPOSITORY,
  PARENT_PORTAL_USERS_REPOSITORY,
} from './parent-portal.constants';

/**
 * Read-only Parent Portal (Task 20).
 *
 * Re-uses the existing live-tracking and trip-attendance services rather than
 * duplicating their business logic: attendance reads flow through
 * `TripAttendanceService` (read-only for parents) and locations through
 * `LiveTrackingService`. Model repositories are token-backed so the feature
 * follows the existing migration-driven Sequelize pattern and stays
 * unit-testable while `DB_AUTO_CONNECT=false`.
 */
@Module({
  imports: [LiveTrackingModule, EtaModule, TripAttendanceModule],
  controllers: [ParentPortalController],
  providers: [
    ParentPortalService,
    { provide: PARENT_PORTAL_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: PARENT_PORTAL_STUDENTS_REPOSITORY, useValue: Student },
    { provide: PARENT_PORTAL_STOPS_REPOSITORY, useValue: Stop },
    { provide: PARENT_PORTAL_ROUTES_REPOSITORY, useValue: Route },
    { provide: PARENT_PORTAL_BUSES_REPOSITORY, useValue: Bus },
    { provide: PARENT_PORTAL_TRIPS_REPOSITORY, useValue: Trip },
    { provide: PARENT_PORTAL_USERS_REPOSITORY, useValue: User },
    { provide: PARENT_PORTAL_SCHOOLS_REPOSITORY, useValue: School },
  ],
  exports: [ParentPortalService],
})
export class ParentPortalModule {}
