import { Module } from '@nestjs/common';
import { Bus, RefreshToken, Route, School, Student, Trip, User } from '../../database/models';
import { SchoolsModule } from '../schools/schools.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminSchoolAdminsController } from './admin-school-admins.controller';
import { AdminSchoolAdminsService } from './admin-school-admins.service';
import { AdminSchoolsController } from './admin-schools.controller';
import { AdminSchoolsService } from './admin-schools.service';
import {
  ADMIN_BUSES_REPOSITORY,
  ADMIN_REFRESH_TOKENS_REPOSITORY,
  ADMIN_ROUTES_REPOSITORY,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_STUDENTS_REPOSITORY,
  ADMIN_TRIPS_REPOSITORY,
  ADMIN_USERS_REPOSITORY,
} from './admin.constants';

/**
 * Super Admin platform console module (`/api/v1/admin/*`).
 *
 * Every controller here is guarded by `JwtAuthGuard + RolesGuard` with
 * `@Roles(SUPER_ADMIN)`. Model classes are provided behind tokens (matching
 * every other feature module) so the app boots with `DB_AUTO_CONNECT=false`
 * and unit tests can inject stubs. The provisioning flow reuses the existing
 * `SchoolsService` onboarding transaction instead of duplicating it.
 */
@Module({
  imports: [SchoolsModule],
  controllers: [AdminDashboardController, AdminSchoolsController, AdminSchoolAdminsController],
  providers: [
    AdminDashboardService,
    AdminSchoolsService,
    AdminSchoolAdminsService,
    { provide: ADMIN_SCHOOLS_REPOSITORY, useValue: School },
    { provide: ADMIN_USERS_REPOSITORY, useValue: User },
    { provide: ADMIN_STUDENTS_REPOSITORY, useValue: Student },
    { provide: ADMIN_BUSES_REPOSITORY, useValue: Bus },
    { provide: ADMIN_ROUTES_REPOSITORY, useValue: Route },
    { provide: ADMIN_TRIPS_REPOSITORY, useValue: Trip },
    { provide: ADMIN_REFRESH_TOKENS_REPOSITORY, useValue: RefreshToken },
  ],
})
export class AdminModule {}
