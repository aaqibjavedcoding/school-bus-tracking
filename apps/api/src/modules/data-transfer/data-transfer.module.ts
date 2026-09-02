import { Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  Bus,
  BusDocument,
  DriverDocument,
  ImportJob,
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
import { PlanLimitsModule } from '../../common/plan-limits';
import {
  DATA_TRANSFER_ASSIGNMENTS_REPOSITORY,
  DATA_TRANSFER_ATTENDANCE_REPOSITORY,
  DATA_TRANSFER_BUSES_REPOSITORY,
  DATA_TRANSFER_BUS_DOCUMENTS_REPOSITORY,
  DATA_TRANSFER_DRIVER_DOCUMENTS_REPOSITORY,
  DATA_TRANSFER_GUARDIANS_REPOSITORY,
  DATA_TRANSFER_IMPORT_JOBS_REPOSITORY,
  DATA_TRANSFER_NOTIFICATIONS_REPOSITORY,
  DATA_TRANSFER_ROUTES_REPOSITORY,
  DATA_TRANSFER_SEQUELIZE,
  DATA_TRANSFER_STOPS_REPOSITORY,
  DATA_TRANSFER_STUDENTS_REPOSITORY,
  DATA_TRANSFER_TRIPS_REPOSITORY,
  DATA_TRANSFER_USERS_REPOSITORY,
} from './data-transfer.constants';
import { ExportController } from './export/export.controller';
import { ExportService } from './export/export.service';
import { ImportController } from './import/import.controller';
import { ImportHistoryService } from './import/import-history.service';
import { ImportService } from './import/import.service';
import { ImportTemplateService } from './import/import-template.service';

/**
 * Import / export feature module.
 *
 * Model classes are provided behind string tokens (the convention used by every
 * other feature module) so the API still boots with `DB_AUTO_CONNECT=false` and
 * unit tests can inject stubs.
 *
 * The Sequelize instance is optional for the same reason: the import service
 * only needs it to open the batch transaction, and a unit test running against
 * stub repositories has no connection at all.
 */
@Module({
  imports: [AuditModule, PlanLimitsModule],
  controllers: [ImportController, ExportController],
  providers: [
    ImportTemplateService,
    ImportService,
    ImportHistoryService,
    ExportService,
    { provide: DATA_TRANSFER_STUDENTS_REPOSITORY, useValue: Student },
    { provide: DATA_TRANSFER_GUARDIANS_REPOSITORY, useValue: StudentGuardian },
    { provide: DATA_TRANSFER_USERS_REPOSITORY, useValue: User },
    { provide: DATA_TRANSFER_BUSES_REPOSITORY, useValue: Bus },
    { provide: DATA_TRANSFER_ROUTES_REPOSITORY, useValue: Route },
    { provide: DATA_TRANSFER_STOPS_REPOSITORY, useValue: Stop },
    { provide: DATA_TRANSFER_ASSIGNMENTS_REPOSITORY, useValue: RouteAssignment },
    { provide: DATA_TRANSFER_TRIPS_REPOSITORY, useValue: Trip },
    { provide: DATA_TRANSFER_ATTENDANCE_REPOSITORY, useValue: TripStudentAttendance },
    { provide: DATA_TRANSFER_NOTIFICATIONS_REPOSITORY, useValue: Notification },
    { provide: DATA_TRANSFER_BUS_DOCUMENTS_REPOSITORY, useValue: BusDocument },
    { provide: DATA_TRANSFER_DRIVER_DOCUMENTS_REPOSITORY, useValue: DriverDocument },
    { provide: DATA_TRANSFER_IMPORT_JOBS_REPOSITORY, useValue: ImportJob },
    {
      provide: DATA_TRANSFER_SEQUELIZE,
      inject: [{ token: getConnectionToken(), optional: true }],
      useFactory: (sequelize?: Sequelize) => sequelize ?? null,
    },
  ],
  exports: [ImportService, ImportTemplateService, ImportHistoryService, ExportService],
})
export class DataTransferModule {}
