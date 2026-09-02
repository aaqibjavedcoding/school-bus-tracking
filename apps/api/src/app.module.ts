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
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EtaModule } from './modules/eta/eta.module';
import { AdminModule } from './modules/admin/admin.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmergenciesModule } from './modules/emergencies/emergencies.module';
import { AuditModule } from './modules/audit/audit.module';
import { DataTransferModule } from './modules/data-transfer/data-transfer.module';
import { ReportsModule } from './modules/reports/reports.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { WorkersModule } from './workers/workers.module';
import { AccessModule } from './common/access';
import { PlanLimitsModule } from './common/plan-limits';
import { RateLimitModule } from './common/rate-limit';
import { SecurityModule } from './common/security';
import { DatabaseModule } from './database/database.module';
import {
  appConfig,
  databaseConfig,
  etaConfig,
  jwtConfig,
  liveTrackingConfig,
  rateLimitConfig,
  retentionConfig,
  securityConfig,
  subscriptionConfig,
} from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        liveTrackingConfig,
        etaConfig,
        securityConfig,
        rateLimitConfig,
        subscriptionConfig,
        retentionConfig,
      ],
      envFilePath: ['.env', '.env.local'],
    }),
    DatabaseModule.forRoot(),
    // Global school-lifecycle access checks (inactive-tenant enforcement),
    // injected into the shared JwtAuthGuard and AuthService.
    AccessModule,
    // Browser-security guards (CSRF / origin validation). CORS and security
    // headers are applied on the HTTP adapter in `main.ts`.
    SecurityModule,
    // Application-level abuse protection for the routes annotated with
    // `@RateLimit(...)`.
    RateLimitModule,
    PlanLimitsModule,
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
    // Task 22: approximate ETA + geofence stop-arrival detection
    // (`/api/v1/trips/:tripId/eta` etc.) over the live-tracking pipeline.
    EtaModule,
    // Parent portal (`/api/v1/parent/*`) — read-only parent self-service.
    ParentPortalModule,
    // Parent notifications (`/api/v1/parent/notifications` + the
    // `/notifications` socket namespace), created by the attendance and trip
    // flows after their own operations succeed.
    NotificationsModule,
    // Platform Super Admin console (`/api/v1/admin/*`).
    AdminModule,
    // Task 44: bus & driver compliance documents, requirement configuration
    // and the derived expiry/validity engine.
    DocumentsModule,
    // Task 44: crew SOS / emergency events over the self-hosted Socket.IO
    // gateway (no paid SMS / push provider anywhere in the flow).
    EmergenciesModule,
    // Durable audit logging for security-relevant and operational mutations.
    AuditModule,
    // Spreadsheet import / export: templates, validate-then-commit imports,
    // import history and filtered dataset exports.
    DataTransferModule,
    // School-admin reporting over live, tenant-scoped queries.
    ReportsModule,
    // Idempotency for critical mutations (boarding, drop, SOS, trip status).
    IdempotencyModule,
    // Background workers for retention cleanup and notification retry.
    WorkersModule,
  ],
})
export class AppModule {}
