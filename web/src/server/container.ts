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
  crewAuthConfig,
  databaseConfig,
  emailConfig,
  etaConfig,
  jwtConfig,
  marketingConfig,
  liveTrackingConfig,
  notificationDeliveryConfig,
  notificationsConfig,
  passwordResetConfig,
  rateLimitConfig,
  retentionConfig,
  securityConfig,
  subscriptionConfig,
  websocketConfig,
} from './config';

import {
  AuditLog,
  AssistedManagementSession,
  Bus,
  BusDocument,
  CrewPairingToken,
  DeviceToken,
  DocumentRequirement as DocumentRequirementModel,
  DriverDocument,
  EmailCampaign,
  EmailCampaignRecipient,
  EmailEvent,
  EmailTemplate,
  EmailTemplateVersion,
  EmergencyEvent,
  IdempotencyKey,
  ImportJob,
  MarketingLead,
  MarketingLeadEvent,
  MarketingDeliverySettings,
  MarketingSuppression,
  MarketingNotificationJob,
  MarketingProviderEvent,
  MarketingAttribution,
  Notification,
  PasswordResetToken,
  Plan,
  RefreshToken,
  Route,
  RouteAssignment,
  Run,
  RunCrew,
  School,
  SchoolSubscription,
  Shift,
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

import { AccountService } from './modules/account/account.service';
import { AdminDashboardService } from './modules/admin/admin-dashboard.service';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { AdminGlobalSubscriptionsService } from './modules/admin/admin-global-subscriptions.service';
import { AdminPlansService } from './modules/admin/admin-plans.service';
import { AdminSchoolAdminsService } from './modules/admin/admin-school-admins.service';
import { AdminSchoolsService } from './modules/admin/admin-schools.service';
import { AdminSubscriptionsService } from './modules/admin/admin-subscriptions.service';
import { AssistedSessionService } from './modules/admin/manage/assisted-session.service';
import { RouteAssignmentsService } from './modules/assignments/assignments.service';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { CrewAuthService } from './modules/auth/crew-auth.service';
import { PasswordResetService } from './modules/auth/password-reset.service';
import { BusesService } from './modules/buses/buses.service';
import { ExportService } from './modules/data-transfer/export/export.service';
import { ImportHistoryService } from './modules/data-transfer/import/import-history.service';
import { ImportService } from './modules/data-transfer/import/import.service';
import { MarketingAdminAlerts } from './modules/marketing/marketing-admin-alerts';
import { MarketingAudienceService } from './modules/marketing/marketing-audience.service';
import { MarketingDeliveryWorker } from './modules/marketing/marketing-delivery.worker';
import { MarketingDeliverySettingsService } from './modules/marketing/marketing-delivery-settings.service';
import { MarketingTrackingService } from './modules/marketing/marketing-tracking.service';
import { MarketingLeadsService } from './modules/marketing/marketing-leads.service';
import { MarketingLeadNotifications } from './modules/marketing/marketing-lead-notifications';
import { MarketingNotificationWorker } from './modules/marketing/marketing-notification.worker';
import { MarketingAttributionService } from './modules/marketing/marketing-attribution.service';
import { MarketingSuppressionsService } from './modules/marketing/marketing-suppressions.service';
import { MarketingEmailEventsService } from './modules/marketing/marketing-email-events.service';
import { MarketingErasureService } from './modules/marketing/marketing-erasure.service';
import { createMarketingCompositeWorker } from './modules/marketing/marketing-worker.composite';
import type { MarketingDeliveryPolicy } from './modules/marketing/marketing-delivery.policy';
import { MarketingCampaignsService } from './modules/marketing/marketing-campaigns.service';
import { MarketingTemplatesService } from './modules/marketing/marketing-templates.service';
import { ImportTemplateService } from './modules/data-transfer/import/import-template.service';
import { DocumentComplianceService } from './modules/documents/document-compliance.service';
import { DocumentRequirementsService } from './modules/documents/document-requirements.service';
import { DocumentsService } from './modules/documents/documents.service';
import { LocalStorageProvider } from './modules/documents/storage';
import type { DocumentStorageProvider } from './modules/documents/storage';
import { EmergenciesService } from './modules/emergencies/emergencies.service';
import { EtaService, type EtaConfig } from './modules/eta/eta.service';
import {
  DEFAULT_ARRIVAL_DETECTION_CONFIG,
  StopArrivalsService,
  type ArrivalDetectionConfig,
} from './modules/eta/stop-arrivals.service';
import { HealthService } from './modules/health/health.service';
import {
  LiveTrackingService,
  type LiveTrackingConfig,
} from './modules/live-tracking/live-tracking.service';
import { DeviceTokensService } from './modules/notifications/device-tokens.service';
import { NotificationsService } from './modules/notifications/notifications.service';
import { createEmailProvider, createPushProvider } from './modules/notifications/providers';
import { DeliveryWorker } from './modules/notifications/outbox';
import type { DeliveryPolicyConfig } from './modules/notifications/outbox';
import type {
  EmailNotificationProvider,
  PushNotificationProvider,
} from './modules/notifications/providers';
import { ParentPortalService } from './modules/parent-portal/parent-portal.service';
import { ParentGuardiansService } from './modules/parents/parent-guardians.service';
import { ParentsService } from './modules/parents/parents.service';
import { ReportsService } from './modules/reports/reports.service';
import { RoutesService } from './modules/routes/routes.service';
import { RunCrewService } from './modules/run-crew/run-crew.service';
import { RunsService } from './modules/runs/runs.service';
import { SchoolsService } from './modules/schools/schools.service';
import { ShiftsService } from './modules/shifts/shifts.service';
import { StaffService } from './modules/staff/staff.service';
import { StopsService } from './modules/stops/stops.service';
import { StudentsService } from './modules/students/students.service';
import { TripAttendanceService } from './modules/trip-attendance/trip-attendance.service';
import { CrewStopMarkingService } from './modules/crew-stops/crew-stop-marking.service';
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
        crewAuthConfig,
        databaseConfig,
        emailConfig,
        jwtConfig,
        liveTrackingConfig,
        etaConfig,
        securityConfig,
        rateLimitConfig,
        subscriptionConfig,
        retentionConfig,
        notificationsConfig,
        notificationDeliveryConfig,
        passwordResetConfig,
        websocketConfig,
        marketingConfig,
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

  readonly etaConfig = lazy((): EtaConfig => ({
    fallbackSpeedKmh: this.config().get<number>('eta.fallbackSpeedKmh') ?? 25,
    minSpeedKmh: this.config().get<number>('eta.minSpeedKmh') ?? 5,
    maxSpeedKmh: this.config().get<number>('eta.maxSpeedKmh') ?? 90,
    staleAfterMs: this.config().get<number>('eta.staleAfterMs') ?? 180_000,
  }));

  readonly arrivalDetectionConfig = lazy((): ArrivalDetectionConfig => ({
    maxFixAgeMs:
      this.config().get<number>('eta.arrival.maxFixAgeMs') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.maxFixAgeMs,
    futureToleranceMs:
      this.config().get<number>('eta.arrival.futureToleranceMs') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.futureToleranceMs,
    maxAccuracyMeters:
      this.config().get<number>('eta.arrival.maxAccuracyMeters') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.maxAccuracyMeters,
    allowMissingAccuracy:
      this.config().get<boolean>('eta.arrival.allowMissingAccuracy') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.allowMissingAccuracy,
    requiredConsecutiveFixes:
      this.config().get<number>('eta.arrival.requiredConsecutiveFixes') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.requiredConsecutiveFixes,
    skipExtraFixes:
      this.config().get<number>('eta.arrival.skipExtraFixes') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.skipExtraFixes,
    maxSkipAhead:
      this.config().get<number>('eta.arrival.maxSkipAhead') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.maxSkipAhead,
    exitHysteresisMeters:
      this.config().get<number>('eta.arrival.exitHysteresisMeters') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.exitHysteresisMeters,
    minDwellMs:
      this.config().get<number>('eta.arrival.minDwellMs') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.minDwellMs,
    maxPlausibleSpeedKmh:
      this.config().get<number>('eta.arrival.maxPlausibleSpeedKmh') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.maxPlausibleSpeedKmh,
    minJumpDistanceMeters:
      this.config().get<number>('eta.arrival.minJumpDistanceMeters') ??
      DEFAULT_ARRIVAL_DETECTION_CONFIG.minJumpDistanceMeters,
  }));

  readonly liveTrackingConfig = lazy((): LiveTrackingConfig => ({
    gpsMinIntervalMs: this.config().get<number>('liveTracking.gpsMinIntervalMs') ?? 2500,
    maxFutureSkewMs: this.config().get<number>('liveTracking.maxFutureSkewMs') ?? 300_000,
    maxPastSkewMs: this.config().get<number>('liveTracking.maxPastSkewMs') ?? 86_400_000,
  }));

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
      apnsKeyPem: this.config().get<string | null>('notifications.apnsKeyPem'),
      apnsKeyId: this.config().get<string | null>('notifications.apnsKeyId'),
      apnsTeamId: this.config().get<string | null>('notifications.apnsTeamId'),
      apnsTopic: this.config().get<string | null>('notifications.apnsTopic'),
      apnsProduction: this.config().get<boolean>('notifications.apnsProduction'),
    }),
  );

  /**
   * Outbound email rail.
   *
   * Mirrors {@link pushProvider}: the factory returns the real
   * `SmtpEmailProvider` only when `EMAIL_PROVIDER=smtp` and every SMTP
   * variable is present, and `NoOpEmailProvider` otherwise — so CI, `npm
   * test` and a fresh checkout need no relay and nothing downstream branches
   * on which one is active.
   */
  readonly emailProvider = lazy((): EmailNotificationProvider =>
    createEmailProvider({
      provider: this.config().get<string>('email.provider'),
      host: this.config().get<string | null>('email.smtpHost'),
      port: this.config().get<string | null>('email.smtpPort'),
      secure: this.config().get<boolean | null>('email.smtpSecure'),
      user: this.config().get<string | null>('email.smtpUser'),
      pass: this.config().get<string | null>('email.smtpPass'),
      from: this.config().get<string | null>('email.from'),
    }),
  );

  /** Phase 2 durable-delivery policy (expiry / backoff / max attempts). */
  readonly deliveryPolicy = lazy((): DeliveryPolicyConfig => ({
    maxAttempts: this.config().get<number>('notificationDelivery.maxAttempts') ?? 8,
    baseBackoffMs: this.config().get<number>('notificationDelivery.baseBackoffMs') ?? 2000,
    expiryMs: this.config().get<number>('notificationDelivery.expiryMs') ?? 10 * 60 * 1000,
    batchSize: this.config().get<number>('notificationDelivery.batchSize') ?? 50,
  }));

  /** Phase 2 outbox worker — claims and delivers pending pushes. */
  readonly deliveryWorker = lazy(
    () =>
      new DeliveryWorker(
        Notification,
        Trip,
        this.deviceTokens(),
        this.pushProvider(),
        this.sequelize,
        this.deliveryPolicy(),
      ),
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
        Run,
        this.sequelize,
        this.config(),
      ),
  );

  // ---------------------------------------------------------------- domain

  readonly audit = lazy(() => new AuditService(AuditLog, User));

  // ----------------------------------------------------------- marketing

  /**
   * School audience resolution — the only code that decides who a campaign
   * emails. Platform-level (SUPER_ADMIN surface) and read-only, so it shares
   * no state with the tenant-scoped services.
   */
  readonly marketingAudience = lazy(
    () => new MarketingAudienceService(School, SchoolSubscription, User, MarketingSuppression),
  );

  /**
   * Email template management. The test-send rail is the shared
   * `emailProvider` (SMTP when fully configured, NoOp otherwise), and the
   * closed allowlist of test recipients is read from configuration at call
   * time — never baked in.
   */
  readonly marketingTemplates = lazy(
    () =>
      new MarketingTemplatesService(
        EmailTemplate,
        EmailTemplateVersion,
        this.emailProvider(),
        () => this.config().get<string[]>('marketing.testRecipients') ?? [],
      ),
  );

  /**
   * Campaign management + the audience snapshot scheduler. Delivery itself is
   * the background worker's job (Session 3); this service only moves
   * campaigns between lifecycle states and freezes snapshots.
   */
  readonly marketingCampaigns = lazy(
    () =>
      new MarketingCampaignsService(
        EmailCampaign,
        EmailCampaignRecipient,
        EmailTemplate,
        EmailTemplateVersion,
        this.marketingAudience(),
        this.sequelize,
      ),
  );

  /**
   * Operational alert rail for marketing. Sends only to
   * `MARKETING_ADMIN_EMAILS`, read at call time so the address list is pure
   * configuration and never compiled into business logic.
   */
  readonly marketingAlerts = lazy(
    () =>
      new MarketingAdminAlerts({
        emailProvider: this.emailProvider(),
        adminEmails: () => this.config().get<string[]>('marketing.adminEmails') ?? [],
      }),
  );

  /** Durable global controls and cross-instance delivery counters. */
  readonly marketingDeliverySettings = lazy(
    () => new MarketingDeliverySettingsService(MarketingDeliverySettings, this.sequelize, this.config()),
  );

  /** Delivery knobs (batch size, rate, backoff, lease) straight from config. */
  readonly marketingDeliveryPolicy = lazy((): MarketingDeliveryPolicy => {
    const config = this.config();
    return {
      batchSize: config.get<number>('marketing.worker.batchSize') ?? 25,
      maxAttempts: config.get<number>('marketing.delivery.maxAttempts') ?? 5,
      retryBaseMs: config.get<number>('marketing.delivery.baseBackoffMs') ?? 60_000,
      ratePerMinute: config.get<number>('marketing.delivery.ratePerMinute') ?? 60,
      concurrency: config.get<number>('marketing.delivery.concurrency') ?? 3,
      sendDelayMs: config.get<number>('marketing.delivery.sendDelayMs') ?? 250,
      sendJitterMs: config.get<number>('marketing.delivery.sendJitterMs') ?? 250,
      expiryMs: config.get<number>('marketing.delivery.expiryMs') ?? 72 * 60 * 60 * 1000,
      leaseMs: config.get<number>('marketing.delivery.leaseMs') ?? 120_000,
    };
  });

  /**
   * The campaign delivery worker. Constructed lazily and owned by the
   * scheduler in `server.js`; no HTTP handler ever calls it, which is what
   * keeps bulk sending out of the request path.
   */
  readonly marketingDeliveryWorker = lazy(
    () =>
      new MarketingDeliveryWorker({
        campaigns: EmailCampaign,
        recipients: EmailCampaignRecipient,
        versions: EmailTemplateVersion,
        events: EmailEvent,
        suppressions: MarketingSuppression,
        emailProvider: this.emailProvider(),
        sequelize: this.sequelize,
        policy: this.marketingDeliveryPolicy(),
        appUrl: this.config().get<string>('app.appUrl') ?? 'http://localhost:3000',
        replyTo:
          this.config().get<string>('email.replyTo') ??
          this.config().get<string[]>('marketing.adminEmails')?.[0] ??
          null,
        alerts: this.marketingAlerts(),
        deliverySettings: this.marketingDeliverySettings(),
      }),
  );

  /** Public click/unsubscribe handling (no auth, opaque tokens only). */
  /**
   * Signed, indexed click attribution (Hardening 5B). The secret is read at
   * call time so it can be rotated without a restart, and it is never
   * logged or returned by any endpoint.
   */
  readonly marketingAttribution = lazy(
    () =>
      new MarketingAttributionService({
        attributions: MarketingAttribution,
        campaigns: EmailCampaign,
        recipients: EmailCampaignRecipient,
        secret: () => this.config().get<string>('marketing.attributionSecret') ?? '',
      }),
  );

  readonly marketingTracking = lazy(
    () =>
      new MarketingTrackingService({
        recipients: EmailCampaignRecipient,
        campaigns: EmailCampaign,
        events: EmailEvent,
        suppressions: MarketingSuppression,
        appUrl: () => this.config().get<string>('app.appUrl') ?? 'http://localhost:3000',
        attribution: this.marketingAttribution(),
      }),
  );

  /** The do-not-send list: console reads, manual adds, protected removals. */
  readonly marketingSuppressions = lazy(
    () =>
      new MarketingSuppressionsService({
        suppressions: MarketingSuppression,
        recipients: EmailCampaignRecipient,
      }),
  );

  /**
   * The signed provider email-event ingest. Closed unless
   * `MARKETING_PROVIDER_WEBHOOK_SECRET` is configured — an unauthenticated
   * suppression endpoint would let anyone silence any address.
   */
  readonly marketingEmailEvents = lazy(
    () =>
      new MarketingEmailEventsService({
        providerEvents: MarketingProviderEvent,
        recipients: EmailCampaignRecipient,
        events: EmailEvent,
        suppressions: this.marketingSuppressions(),
        secret: () => this.config().get<string>('marketing.providerWebhookSecret') ?? '',
      }),
  );

  /** SUPER_ADMIN lead erasure (anonymize; never destroy the consent record). */
  readonly marketingErasure = lazy(
    () =>
      new MarketingErasureService({
        leads: MarketingLead,
        events: MarketingLeadEvent,
        notificationJobs: MarketingNotificationJob,
      }),
  );

  /**
   * The asynchronous "new demo lead" notification to `MARKETING_ADMIN_EMAILS`
   * (the operational rail — the address list is configuration, read at call
   * time, never compiled into business logic and never a campaign CC).
   */
  readonly marketingLeadNotifications = lazy(
    () =>
      new MarketingLeadNotifications({
        emailProvider: this.emailProvider(),
        adminEmails: () => this.config().get<string[]>('marketing.adminEmails') ?? [],
        appUrl: () => this.config().get<string>('app.appUrl') ?? 'http://localhost:3000',
      }),
  );

  /**
   * The durable admin-notification worker. Claims `marketing_notification_jobs`
   * under a lease with `FOR UPDATE SKIP LOCKED`, so a restart never loses a
   * notification and duplicate workers never send one twice.
   */
  readonly marketingNotificationWorker = lazy(
    () =>
      new MarketingNotificationWorker({
        jobs: MarketingNotificationJob,
        leads: MarketingLead,
        leadEvents: MarketingLeadEvent,
        notifications: this.marketingLeadNotifications(),
        sequelize: this.sequelize,
        policy: {
          batchSize: this.config().get<number>('marketing.notifications.batchSize') ?? 10,
          maxAttempts: this.config().get<number>('marketing.notifications.maxAttempts') ?? 5,
          retryBaseMs: this.config().get<number>('marketing.notifications.retryBaseMs') ?? 60_000,
          expiryMs:
            this.config().get<number>('marketing.notifications.expiryMs') ?? 24 * 60 * 60 * 1000,
          leaseMs: this.config().get<number>('marketing.notifications.leaseMs') ?? 120_000,
        },
      }),
  );

  /**
   * What the scheduler (and the one-shot cron command) actually runs: both
   * marketing queues behind one tick, notifications first.
   */
  readonly marketingWorker = lazy(() =>
    createMarketingCompositeWorker(
      this.marketingDeliveryWorker(),
      this.marketingNotificationWorker(),
    ),
  );

  /**
   * Demo lead capture (public form) + the SUPER_ADMIN pipeline console.
   * Attribution resolution is delegated to the tracking service — the only
   * component that knows the cookie format — and the notifier runs strictly
   * after the lead row is committed.
   */
  readonly marketingLeads = lazy(
    () =>
      new MarketingLeadsService({
        leads: MarketingLead,
        events: MarketingLeadEvent,
        campaigns: EmailCampaign,
        recipients: EmailCampaignRecipient,
        suppressions: MarketingSuppression,
        notificationJobs: MarketingNotificationJob,
        sequelize: this.sequelize,
        resolveAttribution: (cookieValue) =>
          this.marketingTracking().resolveAttribution(cookieValue),
      }),
  );

  /**
   * The shared development storage backend (`.document-storage` by default).
   * Used for any file byte the API persists — today: crew profile photos via
   * {@link account}. One instance so modules never race `mkdir` at boot.
   */
  readonly documentStorage = lazy((): DocumentStorageProvider => new LocalStorageProvider());

  /**
   * Crew self-service (`/account/me/...`). Bytes go through the same
   * provider the documents module defines; the service adds only the
   * photo-specific validation and the `users` column writes.
   */
  readonly account = lazy(() => new AccountService(User, this.documentStorage()));

  readonly auth = lazy(
    () =>
      new AuthService(User, RefreshToken, this.jwt(), this.config(), this.schoolAccess(), School),
  );

  /**
   * Crew mobile login (PIN + QR pairing). Depends on `auth()` rather than
   * duplicating it: `AuthService.issueSession()` is the only place in the
   * application that mints a session, so a crew session is byte-for-byte an
   * ordinary session.
   */
  readonly crewAuth = lazy(
    () => new CrewAuthService(User, CrewPairingToken, this.auth(), this.config()),
  );

  /**
   * SCHOOL_ADMIN self-service password reset.
   *
   * Depends on `auth()` for the two things it must not reimplement: tenant
   * resolution (`resolveTenantId`, the same code the login form's school-code
   * field goes through) and session revocation (`revokeAllUserSessions`, so a
   * reset really does end every session the account had).
   */
  readonly passwordReset = lazy(
    () =>
      new PasswordResetService(
        User,
        PasswordResetToken,
        this.auth(),
        this.emailProvider(),
        this.config(),
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
        Run,
      ),
  );

  readonly parents = lazy(() => new ParentsService(User, this.planLimits()));

  readonly parentGuardians = lazy(() => new ParentGuardiansService(User, Student, StudentGuardian));

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
        this.runs(),
      ),
  );

  readonly shifts = lazy(() => new ShiftsService(Shift, Run));

  readonly runs = lazy(
    () =>
      new RunsService(
        Run,
        Route,
        Shift,
        Bus,
        RunCrew,
        RouteAssignment,
        User,
        Student,
        this.planLimits(),
        this.sequelize,
      ),
  );

  readonly runCrew = lazy(
    () => new RunCrewService(RunCrew, Run, Route, User, Shift, RouteAssignment, this.sequelize),
  );

  readonly stops = lazy(() => new StopsService(Stop, Route, this.planLimits()));

  /**
   * Dashboard headline counts — four parallel COUNT queries, no enrichment.
   * The stat cards read this instead of four enriched list endpoints.
   */
  readonly dashboard = lazy(() => new DashboardService(Student, Bus, Route, Trip));

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
        Run,
        RunCrew,
        School,
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

  /**
   * Crew stop marking (Arrived / Skip). It writes through
   * {@link StopArrivalsService} so manual and geofence arrivals land in one
   * table, behind one duplicate rule.
   */
  readonly crewStopMarking = lazy(
    () => new CrewStopMarkingService(Trip, Stop, Student, RouteAssignment, this.stopArrivals()),
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
        Run,
        this.idempotency(),
      ),
  );

  readonly eta = lazy(() => new EtaService(Stop, TripStopArrival, this.etaConfig()));

  readonly stopArrivals = lazy(
    () =>
      new StopArrivalsService(
        Stop,
        TripStopArrival,
        this.eta(),
        this.notifications(),
        this.arrivalDetectionConfig(),
        // Fix D: arrival + notification fan-out commit in one transaction.
        this.sequelize,
      ),
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
        Run,
        RunCrew,
        Shift,
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
        Run,
        this.deliveryPolicy(),
      ),
  );

  readonly emergencies = lazy(() => {
    const service = new EmergenciesService(EmergencyEvent, Trip, Bus, Route, User);
    // Phase 4: SOS → school-admin devices, ack/resolve → raising crew device.
    service.attachPushSink(this.notifications());
    return service;
  });

  readonly documentRequirements = lazy(
    () => new DocumentRequirementsService(DocumentRequirementModel),
  );

  readonly documents = lazy(
    () => new DocumentsService(BusDocument, DriverDocument, Bus, User, this.documentRequirements()),
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
      new AdminDashboardService(School, User, Student, Bus, Route, Trip, SchoolSubscription, Plan),
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
        Run,
      ),
  );

  readonly assistedSession = lazy(
    () => new AssistedSessionService(AssistedManagementSession, this.audit(), this.sequelize),
  );

  // ------------------------------------------------------- data transfer

  readonly importTemplates = lazy(() => new ImportTemplateService());

  readonly importHistory = lazy(() => new ImportHistoryService(ImportJob, User, this.audit()));

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
        Run,
        RunCrew,
        Shift,
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
        Run,
        RunCrew,
        Shift,
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

/**
 * Replaces one container accessor for the duration of a test.
 *
 * The controller specs used to construct a controller with a stub service.
 * Route handlers resolve their services through {@link container} instead, so
 * the equivalent seam is to swap the accessor and restore it afterwards.
 *
 * Returns a restore function; always call it in a `finally` so a failing
 * assertion cannot leak a stub into the next test.
 */
export function overrideContainer<K extends keyof Container>(
  key: K,
  value: Container[K] extends () => infer R ? R : never,
): () => void {
  const c = getContainer() as unknown as Record<string, unknown>;
  const original = c[key as string];
  c[key as string] = () => value;
  return () => {
    c[key as string] = original;
  };
}
