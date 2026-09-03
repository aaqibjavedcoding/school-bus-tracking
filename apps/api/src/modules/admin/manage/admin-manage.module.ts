import { Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { AssistedManagementSession, School } from '../../../database/models';
import { AssignmentsModule } from '../../assignments/assignments.module';
import { AuditModule } from '../../audit';
import { BusesModule } from '../../buses/buses.module';
import { DataTransferModule } from '../../data-transfer/data-transfer.module';
import { ParentsModule } from '../../parents/parents.module';
import { PlanLimitsModule } from '../../../common/plan-limits';
import { ReportsModule } from '../../reports/reports.module';
import { RoutesModule } from '../../routes/routes.module';
import { SchoolsModule } from '../../schools/schools.module';
import { StaffModule } from '../../staff/staff.module';
import { StopsModule } from '../../stops/stops.module';
import { StudentsModule } from '../../students/students.module';
import {
  ADMIN_MANAGE_SEQUELIZE,
  ADMIN_MANAGE_SCHOOLS_REPOSITORY,
  ADMIN_MANAGE_SESSIONS_REPOSITORY,
} from './admin-manage.constants';
import { AdminManageAssignmentsController } from './admin-manage-assignments.controller';
import { AdminManageBusesController } from './admin-manage-buses.controller';
import { AdminManageImportsController } from './admin-manage-imports.controller';
import { AdminManageExportsController } from './admin-manage-exports.controller';
import { AdminManageParentsController } from './admin-manage-parents.controller';
import { AdminManageReportsController } from './admin-manage-reports.controller';
import {
  AdminManageConductorsController,
  AdminManageDriversController,
} from './admin-manage-staff.controller';
import { AdminManageStudentGuardiansController } from './admin-manage-student-guardians.controller';
import { AdminManageStudentsController } from './admin-manage-students.controller';
import { AdminManageStopsController } from './admin-manage-stops.controller';
import { AdminManageRoutesController } from './admin-manage-routes.controller';
import { AdminManageSessionsController } from './admin-manage-sessions.controller';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { AssistedSessionService } from './assisted-session.service';
import { ManagedSchoolGuard } from './managed-school.guard';

/**
 * Super Admin assisted school management (`/api/v1/admin/schools/:schoolId/manage/*`).
 *
 * **Design:** the surface is a thin, well-guarded *context*, not a new domain.
 * Every handler delegates to the existing tenant feature service with the
 * school id taken from the guarded route parameter — so validation, plan
 * limits, subscription rules, duplicate detection, transactions, pagination
 * and tenant pinning are literally the school admin's implementation, not a
 * copy. Nothing here can impersonate: the authenticated actor stays the
 * platform SUPER_ADMIN on every call, and the managed school travels as a
 * separate, server-derived request property.
 *
 * The imported feature modules are the same ones the tenant controllers use;
 * importing them here just shares their service instances.
 */
@Module({
  imports: [
    AuditModule,
    PlanLimitsModule,
    AssignmentsModule,
    BusesModule,
    DataTransferModule,
    ParentsModule,
    ReportsModule,
    RoutesModule,
    SchoolsModule,
    StaffModule,
    StopsModule,
    StudentsModule,
  ],
  controllers: [
    AdminManageSessionsController,
    AdminManageStudentsController,
    AdminManageStudentGuardiansController,
    AdminManageParentsController,
    AdminManageBusesController,
    AdminManageRoutesController,
    AdminManageStopsController,
    AdminManageDriversController,
    AdminManageConductorsController,
    AdminManageAssignmentsController,
    AdminManageImportsController,
    AdminManageExportsController,
    AdminManageReportsController,
  ],
  providers: [
    ManagedSchoolGuard,
    AssistedSessionService,
    AssistedMutationAuditInterceptor,
    {
      provide: ADMIN_MANAGE_SCHOOLS_REPOSITORY,
      useValue: School,
    },
    {
      provide: ADMIN_MANAGE_SESSIONS_REPOSITORY,
      useValue: AssistedManagementSession,
    },
    {
      provide: ADMIN_MANAGE_SEQUELIZE,
      inject: [{ token: getConnectionToken(), optional: true }],
      useFactory: (sequelize?: Sequelize) => sequelize ?? null,
    },
  ],
  exports: [AssistedSessionService],
})
export class AdminManageModule {}
