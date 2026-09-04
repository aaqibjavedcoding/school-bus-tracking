/**
 * Composition root — the single replacement for Nest's dependency injection.
 *
 * Every service that used to be a Nest provider is constructed here exactly
 * once per process, with the **same constructor signature and the same
 * positional arguments** the `*.module.ts` files used to supply. The
 * `@Inject(X_REPOSITORY)` tokens all resolved to static Sequelize model
 * classes (`{ provide: X_REPOSITORY, useValue: Model }`), so those positions
 * are filled with the model classes directly.
 *
 * Design notes:
 *
 * - **Lazy.** Each singleton is built on first access through a memoized
 *   getter. Construction order therefore does not matter, and circular
 *   references that Nest resolved with `forwardRef()` (LiveTracking ↔ Eta,
 *   ParentPortal → Eta) resolve naturally because the cycle is only entered
 *   at call time, never at module-evaluation time.
 * - **Process-wide.** The instances are cached on `globalThis` so that Next's
 *   route handlers, the `instrumentation.ts` Socket.IO wiring and the
 *   background workers all share one object graph. Without this, a
 *   broadcaster attached to `LiveTrackingService` by a gateway would be
 *   invisible to the HTTP handlers, and realtime would silently break.
 * - **Unchanged unit tests.** Nothing here is required by the service specs:
 *   they keep constructing services directly with stub repositories, which
 *   still works because the constructor signatures were not touched.
 */
import 'reflect-metadata';
import type { Sequelize } from 'sequelize-typescript';

import { ConfigService, JwtService, Logger, Reflector } from './framework';
import {
  appConfig,
  databaseConfig,
  etaConfig,
  jwtConfig,
  liveTrackingConfig,
  notificationsConfig,
  rateLimitConfig,
  retentionConfig,
  securityConfig,
  subscriptionConfig,
} from './config';

import {
  AuditLog,
  AssistedManagementSession,
  Bus,
  BusDocument,
  DeviceToken,
  DocumentRequirement as DocumentRequirementModel,
  DriverDocument,
  EmergencyEvent,
  IdempotencyKey,
  ImportJob,
  Notification,
  Plan,
  RefreshToken,
  Route,
  RouteAssignment,
  School,
  SchoolSubscription,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripLocation,
  TripStopArrival,
  TripStudentAttendance,
  User,
} from './database/models';

import { SchoolAccessService } from './common/access';
import { IdempotencyService } from './common/idempotency/idempotency.service';
import { PlanLimitsService } from './common/plan-limits';
import { createRateLimitStore } from './common/rate-limit/rate-limit.store-factory';
import type { RateLimitStore } from './common/rate-limit/rate-limit.store';

import { AdminDashboardService } from './modules/admin/admin-dashboard.service';
import { AdminGlobalSubscriptionsService } from './modules/admin/admin-global-subscriptions.service';
import { AdminPlansService } from './modules/admin/admin-plans.service';
import { AdminSchoolAdminsService } from './modules/admin/admin-school-admins.service';
import { AdminSchoolsService } from './modules/admin/admin-schools.service';
import { AdminSubscriptionsService } from './modules/admin/admin-subscriptions.service';
import { AssistedSessionService } from './modules/admin/manage/assisted-session.service';
import { RouteAssignmentsService } from './modules/assignments/assignments.service';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { BusesService } from './modules/buses/buses.service';
import { ExportService } from './modules/data-transfer/export/export.service';
import { ImportHistoryService } from './modules/data-transfer/import/import-history.service';
import { ImportService } from './modules/data-transfer/import/import.service';
import { ImportTemplateService } from './modules/data-transfer/import/import-template.service';
import { DocumentComplianceService } from './modules/documents/document-compliance.service';
import { DocumentRequirementsService } from './modules/documents/document-requirements.service';
import { DocumentsService } from './modules/documents/documents.service';
import { EmergenciesService } from './modules/emergencies/emergencies.service';
import { EtaService, type EtaConfig } from './modules/eta/eta.service';
import { StopArrivalsService } from './modules/eta/stop-arrivals.service';
import { HealthService } from './modules/health/health.service';
import {
  LiveTrackingService,
  type LiveTrackingConfig,
} from './modules/live-tracking/live-tracking.service';
import { DeviceTokensService } from './modules/notifications/device-tokens.service';
import { NotificationsService } from './modules/notifications/notifications.service';
import { createPushProvider } from './modules/notifications/providers';
import type { PushNotificationProvider } from './modules/notifications/providers';
import { ParentPortalService } from './modules/parent-portal/parent-portal.service';
import { ParentGuardiansService } from './modules/parents/parent-guardians.service';
import { ParentsService } from './modules/parents/parents.service';
import { ReportsService } from './modules/reports/reports.service';
import { RoutesService } from './modules/routes/routes.service';
import { SchoolsService } from './modules/schools/schools.service';
import { StaffService } from './modules/staff/staff.service';
import { StopsService } from './modules/stops/stops.service';
import { StudentsService } from './modules/students/students.service';
import { TripAttendanceService } from './modules/trip-attendance/trip-attendance.service';
import { TripsService } from './modules/trips/trips.service';

/** Memoizes a factory so each singleton is constructed at most once. */
function lazy<T>(factory: () => T): () => T {
  let built = false;
  let value: T;
  return () => {
    if (!built) {
      value = factory();
      built = true;
    }
    return value;
  };
}

/**
 * The object graph. Declared as a class of memoized getters so that a cycle
 * (`liveTracking` → `stopArrivals` → `eta`, and back) is only traversed when
 * a method is actually invoked — the same deferral `forwardRef()` provided.
 */
export class Container {
  private readonly logger = new Logger('Container');

  /**
   * The Sequelize connection, injected by `bootstrapDatabase()`.
   *
   * Left `null` in stubbed test/smoke bootstraps (`DB_AUTO_CONNECT=false`),
   * exactly like the old `@Optional() @InjectConnection()` providers.
   */
  sequelize: Sequelize | null = null;

  // ---------------------------------------------------------------- config

  readonly config = lazy(
    () =>
      new ConfigService([
        appConfig,
        databaseConfig,
        jwtConfig,
        liveTrackingConfig,
        etaConfig,
        securityConfig,
        rateLimitConfig,
        subscriptionConfig,
        retentionConfig,
        notificationsConfig,
      ] as never),
  );

  /**
   * The centrally configured JWT signer/verifier — the single instance the
   * old global `JwtModule.registerAsync({ global: true })` provided to the
   * auth service, the HTTP guard and all three socket gateways.
   */
  readonly jwt = lazy(
    () =>
      new JwtService({
        secret: this.config().get<string>('jwt.secret'),
        signOptions: { expiresIn: this.config().get<string>('jwt.expiresIn', '15m') },
      }),
  );

  // ------------------------------------------------------- config-derived

  readonly etaConfig = lazy(
    (): EtaConfig => ({
      fallbackSpeedKmh: this.config().get<number>('eta.fallbackSpeedKmh') ?? 25,
      minSpeedKmh: this.config().get<number>('eta.minSpeedKmh') ?? 5,
      maxSpeedKmh: this.config().get<number>('eta.maxSpeedKmh') ?? 90,
    }),
  );

  readonly liveTrackingConfig = lazy(
    (): LiveTrackingConfig => ({
      gpsMinIntervalMs: this.config().get<number>('liveTracking.gpsMinIntervalMs') ?? 2500,
      maxFutureSkewMs: this.config().get<number>('liveTracking.maxFutureSkewMs') ?? 300_000,
      maxPastSkewMs: this.config().get<number>('liveTracking.maxPastSkewMs') ?? 86_400_000,
    }),
  );

  /** Shared metadata reader for the guards (replaces Nest's Reflector). */
  readonly reflector = lazy(() => new Reflector());

  readonly rateLimitStore = lazy((): RateLimitStore =>
    createRateLimitStore(this.config().get<string>('rateLimit.store', 'memory')),
  );

  readonly pushProvider = lazy((): PushNotificationProvider =>
    createPushProvider({
      serviceAccountJson: this.config().get<string | null>(
        'notifications.firebaseServiceAccountJson',
      ),
      projectId: this.config().get<string | null>('notifications.firebaseProjectId'),
    }),
  );

  // ---------------------------------------------------------------- common

  readonly schoolAccess = lazy(() => new SchoolAccessService(School, User));

  readonly idempotency = lazy(() => new IdempotencyService(IdempotencyKey, this.config()));

  readonly planLimits = lazy(
    () =>
      new PlanLimitsService(
        SchoolSubscription,
        Plan,
        Student,
        Bus,
        Route,
        Stop,
        User,
        Trip,
        this.sequelize,
        this.config(),
      ),
  );

  // ---------------------------------------------------------------- domain

  readonly audit = lazy(() => new AuditService(AuditLog, User));

  readonly auth = lazy(
    () =>
      new AuthService(
        User,
        RefreshToken,
        this.jwt(),
        this.config(),
        this.schoolAccess(),
        School,
      ),
  );

  readonly schools = lazy(() => new SchoolsService(School, User));

  readonly students = lazy(
    () =>
      new StudentsService(
        Student,
        Stop,
        StudentGuardian,
        Route,
        RouteAssignment,
        Bus,
        this.planLimits(),
      ),
  );

  readonly parents = lazy(() => new ParentsService(User, this.planLimits()));

  readonly parentGuardians = lazy(
    () => new ParentGuardiansService(User, Student, StudentGuardian),
  );

  readonly staff = lazy(
    () => new StaffService(User, RouteAssignment, Route, Bus, Trip, this.planLimits()),
  );

  readonly buses = lazy(
    () => new BusesService(Bus, RouteAssignment, Route, User, Trip, this.planLimits()),
  );

  readonly routes = lazy(
    () =>
      new RoutesService(
        Route,
        Stop,
        RouteAssignment,
        User,
        Bus,
        Trip,
        Student,
        this.planLimits(),
      ),
  );

  readonly stops = lazy(() => new StopsService(Stop, Route, this.planLimits()));

  readonly routeAssignments = lazy(
    () => new RouteAssignmentsService(RouteAssignment, Route, Bus, User),
  );

  readonly trips = lazy(
    () =>
      new TripsService(
        Trip,
        RouteAssignment,
        Route,
        Bus,
        User,
        this.liveTracking(),
        this.notifications(),
        this.planLimits(),
      ),
  );

  readonly tripAttendance = lazy(
    () =>
      new TripAttendanceService(
        TripStudentAttendance,
        Trip,
        Stop,
        Student,
        StudentGuardian,
        RouteAssignment,
        this.notifications(),
      ),
  );

  readonly liveTracking = lazy(
    () =>
      new LiveTrackingService(
        TripLocation,
        Trip,
        RouteAssignment,
        Student,
        Stop,
        StudentGuardian,
        this.liveTrackingConfig(),
        this.stopArrivals(),
      ),
  );

  readonly eta = lazy(() => new EtaService(Stop, TripStopArrival, this.etaConfig()));

  readonly stopArrivals = lazy(
    () => new StopArrivalsService(Stop, TripStopArrival, this.eta(), this.notifications()),
  );

  readonly parentPortal = lazy(
    () =>
      new ParentPortalService(
        StudentGuardian,
        Student,
        Stop,
        Route,
        Bus,
        Trip,
        User,
        School,
        this.liveTracking(),
        this.tripAttendance(),
        this.eta(),
      ),
  );

  readonly deviceTokens = lazy(() => new DeviceTokensService(DeviceToken));

  readonly notifications = lazy(
    () =>
      new NotificationsService(
        Notification,
        User,
        StudentGuardian,
        Student,
        Stop,
        Trip,
        this.deviceTokens(),
        this.pushProvider(),
      ),
  );

  readonly emergencies = lazy(
    () => new EmergenciesService(EmergencyEvent, Trip, Bus, Route, User),
  );

  readonly documentRequirements = lazy(
    () => new DocumentRequirementsService(DocumentRequirementModel),
  );

  readonly documents = lazy(
    () =>
      new DocumentsService(
        BusDocument,
        DriverDocument,
        Bus,
        User,
        this.documentRequirements(),
      ),
  );

  readonly documentCompliance = lazy(
    () =>
      new DocumentComplianceService(
        BusDocument,
        DriverDocument,
        Bus,
        User,
        this.documentRequirements(),
      ),
  );

  readonly health = lazy(() => new HealthService(this.config(), this.sequelize ?? undefined));

  // ------------------------------------------------------------- admin

  readonly adminPlans = lazy(() => new AdminPlansService(Plan));

  readonly adminSubscriptions = lazy(
    () => new AdminSubscriptionsService(SchoolSubscription, School, Plan, this.config()),
  );

  readonly adminGlobalSubscriptions = lazy(
    () =>
      new AdminGlobalSubscriptionsService(
        SchoolSubscription,
        School,
        Plan,
        User,
        Student,
        Bus,
        Route,
        Stop,
        Trip,
      ),
  );

  readonly adminDashboard = lazy(
    () =>
      new AdminDashboardService(
        School,
        User,
        Student,
        Bus,
        Route,
        Trip,
        SchoolSubscription,
        Plan,
      ),
  );

  readonly adminSchoolAdmins = lazy(() => new AdminSchoolAdminsService(School, User));

  readonly adminSchools = lazy(
    () =>
      new AdminSchoolsService(
        School,
        User,
        Student,
        Bus,
        Route,
        Trip,
        RefreshToken,
        this.schools(),
        this.adminSubscriptions(),
        Stop,
        RouteAssignment,
      ),
  );

  readonly assistedSession = lazy(
    () => new AssistedSessionService(AssistedManagementSession, this.audit(), this.sequelize),
  );

  // ------------------------------------------------------- data transfer

  readonly importTemplates = lazy(() => new ImportTemplateService());

  readonly importHistory = lazy(
    () => new ImportHistoryService(ImportJob, User, this.audit()),
  );

  readonly imports = lazy(
    () =>
      new ImportService(
        Student,
        StudentGuardian,
        User,
        Bus,
        Route,
        Stop,
        RouteAssignment,
        ImportJob,
        this.planLimits(),
        this.audit(),
        this.sequelize,
      ),
  );

  readonly exports = lazy(
    () =>
      new ExportService(
        Student,
        StudentGuardian,
        User,
        Bus,
        Route,
        Stop,
        RouteAssignment,
        Trip,
        TripStudentAttendance,
        Notification,
        BusDocument,
        DriverDocument,
        this.audit(),
      ),
  );

  readonly reports = lazy(
    () =>
      new ReportsService(
        Student,
        StudentGuardian,
        User,
        Bus,
        Route,
        Stop,
        RouteAssignment,
        Trip,
        TripStudentAttendance,
        Notification,
        BusDocument,
        DriverDocument,
        this.audit(),
      ),
  );
}

/**
 * The process-wide container.
 *
 * Cached on `globalThis` so Next.js route handlers, the instrumentation hook
 * that wires Socket.IO, and the background workers observe the *same*
 * singletons even across the separate module registries Next creates for
 * server chunks and during dev hot-reload.
 */
const CONTAINER_KEY = Symbol.for('school-bus-tracking.container');

type GlobalWithContainer = typeof globalThis & { [CONTAINER_KEY]?: Container };

export function getContainer(): Container {
  const globalRef = globalThis as GlobalWithContainer;
  if (!globalRef[CONTAINER_KEY]) {
    globalRef[CONTAINER_KEY] = new Container();
  }
  return globalRef[CONTAINER_KEY];
}

/** Convenience alias used by route handlers: `container().buses()`. */
export const container = getContainer;
