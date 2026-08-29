import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthTestModule } from './modules/auth-test/auth-test.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { StudentsModule } from './modules/students/students.module';
import { ParentsModule } from './modules/parents/parents.module';
import { StaffModule } from './modules/staff/staff.module';
import { BusesModule } from './modules/buses/buses.module';
import { RoutesModule } from './modules/routes/routes.module';
import { StopsModule } from './modules/stops/stops.module';
import { RouteAssignmentsModule } from './modules/assignments/assignments.module';
import { TripsModule } from './modules/trips/trips.module';
import { TripAttendanceModule } from './modules/trip-attendance/trip-attendance.module';
import { LiveTrackingModule } from './modules/live-tracking/live-tracking.module';
import { ParentPortalModule } from './modules/parent-portal/parent-portal.module';
import { AdminModule } from './modules/admin/admin.module';
import { AccessModule } from './common/access';
import { DatabaseModule } from './database/database.module';
import { appConfig, databaseConfig, jwtConfig, liveTrackingConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, liveTrackingConfig],
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule.forRoot(),
    // Global school-lifecycle access checks (inactive-tenant enforcement),
    // injected into the shared JwtAuthGuard and AuthService.
    AccessModule,
    HealthModule,
    AuthModule,
    AuthTestModule,
    SchoolsModule,
    StudentsModule,
    ParentsModule,
    StaffModule,
    BusesModule,
    RoutesModule,
    StopsModule,
    RouteAssignmentsModule,
    TripsModule,
    TripAttendanceModule,
    LiveTrackingModule,
    // Parent portal (`/api/v1/parent/*`) — read-only parent self-service.
    ParentPortalModule,
    // Platform Super Admin console (`/api/v1/admin/*`).
    AdminModule,
  ],
})
export class AppModule {}
