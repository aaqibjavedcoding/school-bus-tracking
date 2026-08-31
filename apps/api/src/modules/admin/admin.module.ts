import { Module } from '@nestjs/common';
import {
  Bus,
  Plan,
  RefreshToken,
  Route,
  School,
  SchoolSubscription,
  Student,
  Trip,
  User,
} from '../../database/models';
import { SchoolsModule } from '../schools/schools.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminSchoolAdminsController } from './admin-school-admins.controller';
import { AdminSchoolAdminsService } from './admin-school-admins.service';
import { AdminSchoolsController } from './admin-schools.controller';
import { AdminSchoolsService } from './admin-schools.service';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  ADMIN_BUSES_REPOSITORY,
  ADMIN_PLANS_REPOSITORY,
  ADMIN_REFRESH_TOKENS_REPOSITORY,
  ADMIN_ROUTES_REPOSITORY,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_STUDENTS_REPOSITORY,
  ADMIN_SUBSCRIPTIONS_REPOSITORY,
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
 *
 * The plan catalog lives here as well: plans are platform-level (no tenant)
 * and are managed exclusively by a SUPER_ADMIN, which matches the access
 * model of the rest of the `/admin/*` surface. School subscriptions (Task 42)
 * join the two: they are owned by a school but only a SUPER_ADMIN may assign,
 * change or cancel them.
 */
@Module({
  imports: [SchoolsModule],
  controllers: [
    AdminDashboardController,
    AdminSchoolsController,
    AdminSchoolAdminsController,
    AdminPlansController,
    AdminSubscriptionsController,
  ],
  providers: [
    AdminDashboardService,
    AdminSchoolsService,
    AdminSchoolAdminsService,
    AdminPlansService,
    AdminSubscriptionsService,
    { provide: ADMIN_SCHOOLS_REPOSITORY, useValue: School },
    { provide: ADMIN_USERS_REPOSITORY, useValue: User },
    { provide: ADMIN_STUDENTS_REPOSITORY, useValue: Student },
    { provide: ADMIN_BUSES_REPOSITORY, useValue: Bus },
    { provide: ADMIN_ROUTES_REPOSITORY, useValue: Route },
    { provide: ADMIN_TRIPS_REPOSITORY, useValue: Trip },
    { provide: ADMIN_REFRESH_TOKENS_REPOSITORY, useValue: RefreshToken },
    { provide: ADMIN_PLANS_REPOSITORY, useValue: Plan },
    { provide: ADMIN_SUBSCRIPTIONS_REPOSITORY, useValue: SchoolSubscription },
  ],
})
export class AdminModule {}
