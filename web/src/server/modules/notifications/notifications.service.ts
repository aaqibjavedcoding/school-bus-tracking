import { Logger, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import {
  NotificationReadAllResponse,
  NotificationReadFilter,
  NotificationResponse,
  NotificationType,
  NOTIFICATION_EVENTS,
  ParentNotificationListQuery,
  ParentNotificationListResponse,
  UserRole,
  notificationRoomName,
  type ExternalDeliveryStatus,
  type NotificationEvent,
  type NotificationRealtimeEvent,
} from '@school-bus-tracking/shared-types';
import { TripStatus } from '@school-bus-tracking/shared-types';
import {
  Notification,
  Run,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../database/models';
import { resolveTripRunId, studentRidesTripRun } from '../live-tracking/run-ridership';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import {
  DEFAULT_NOTIFICATION_LIMIT,
  MAX_NOTIFICATION_LIMIT,
  NOOP_PUSH_PROVIDER_NAME,
  NOTIFICATION_NOT_FOUND_MESSAGE,
  PUSH_NOT_CONFIGURED_REASON,
  PUSH_STATUS_NOT_CONFIGURED,
  STOP_ARRIVED_MESSAGE,
  STOP_ARRIVED_TITLE,
  STUDENT_BOARDED_MESSAGE,
  STUDENT_BOARDED_TITLE,
  STUDENT_DROPPED_MESSAGE,
  STUDENT_DROPPED_TITLE,
  TRIP_STATUS_MESSAGES,
  TRIP_STATUS_TITLES,
} from './notifications.constants';
import type { PushNotificationProvider } from './providers';
import { DeviceTokensService } from './device-tokens.service';
import { deliveryDedupKey, deliveryExpiry, type DeliveryPolicyConfig } from './outbox';

/** Which attendance action a student notification announces. */
export type StudentAttendanceAction = 'boarded' | 'dropped';

/** Input of one boarding/drop notification, derived by the attendance flow. */
export interface StudentAttendanceNotificationInput {
  school_id: string;
  trip_id: string;
  student: { id: string; first_name: string; last_name: string };
  action: StudentAttendanceAction;
  /** Server time at which the attendance event was recorded. */
  occurred_at: Date;
}

/** Input of one trip lifecycle notification, derived by the trips flow. */
export interface TripStatusNotificationInput {
  school_id: string;
  trip_id: string;
  status: TripStatus;
  cancellation_reason?: string | null;
}

/** Input of one stop-arrival notification, derived by the Task 22 arrival flow. */
export interface StopArrivalNotificationInput {
  school_id: string;
  trip_id: string;
  stop: { id: string; name: string };
  /** Server time at which the bus entered the stop's geofence. */
  occurred_at: Date;
}

/**
 * Input of a role push (no inbox row): who, what, and the string-only `data`
 * the app uses to deep-link (`trip_id`, `emergency_id`, ...).
 */
export interface RolePushInput {
  school_id: string;
  user_ids: string[];
  /** Optional role allow-list; recipients outside it are skipped. */
  roles?: UserRole[];
  /** Deep-link type carried in `data.type` (see `PUSH_EVENT_TYPES`). */
  type: string;
  title: string;
  message: string;
  data?: Record<string, string | null | undefined>;
}

/** Room-scoped broadcast sink attached by the gateway once sockets are up. */
export type NotificationBroadcaster = (
  room: string,
  event: NotificationEvent,
  payload: NotificationRealtimeEvent,
) => void;

/** The trip statuses that generate a parent notification (SCHEDULED never does). */
const NOTIFIABLE_TRIP_STATUSES: Partial<Record<TripStatus, NotificationType>> = {
  [TripStatus.BOARDING]: NotificationType.TRIP_BOARDING,
  [TripStatus.IN_PROGRESS]: NotificationType.TRIP_IN_PROGRESS,
  [TripStatus.COMPLETED]: NotificationType.TRIP_COMPLETED,
  [TripStatus.CANCELLED]: NotificationType.TRIP_CANCELLED,
};

/**
 * Creates, stores and delivers parent notifications (Task 21).
 *
 * Creation always happens **after** the underlying operation has succeeded —
 * the attendance and trip services call into this service only once their own
 * transaction has committed, so a failed boarding or an invalid trip
 * transition can never produce a notification.
 *
 * ### Phase 2 — durable delivery
 *
 * Persisting the row and the required delivery work is a single atomic step:
 * the row carries `push_status = 'pending'`, `next_attempt_at`, the stable
 * `dedup_key` and the event-specific `push_expires_at` (anchored to the
 * *event* clock, so a delayed batch inherits the remaining window). The outbox
 * worker (`modules/notifications/outbox`) claims due rows later, so a crash
 * between "event persisted" and "push sent" recovers after restart and the
 * GPS / attendance / trip flows never block on sequential per-parent push
 * calls. The worker also retries transient failures per device (bounded
 * exponential backoff), retires invalid tokens, honours expiry and keeps an
 * accumulated, per-device outcome (`sent` vs `partial`).
 *
 * ### Atomicity scope (corrective patch)
 *
 * The **stop-arrival** path is transactionally atomic: `notifyStopArrival`
 * accepts the arrival's transaction and writes the fan-out rows inside it, so
 * a committed arrival always carries its notification intent and a rolled-back
 * arrival never produces rows, socket events or deliveries. Other business
 * event paths (attendance, trip status, role pushes) still create rows after
 * their own operation succeeded and are *not* claimed to be atomic here.
 *
 * Recipients are resolved server-side from the tenant-pinned
 * `StudentGuardian` join (active links only, parent accounts only) — the same
 * derivation `LiveTrackingService` uses for parent observation. Nothing here
 * ever accepts a user id, parent id or tenant from a client.
 *
 * Reads and read-state mutations are strictly scoped to
 * `(school_id, user_id)` of the verified JWT; anything else collapses into
 * the same generic 404 as a non-existent row.
 */
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Broadcaster attached by the gateway; `undefined` in unit tests. */
  private broadcaster: NotificationBroadcaster | undefined;

  constructor(
    private readonly notifications: typeof Notification,
    private readonly users: typeof User,
    private readonly guardians: typeof StudentGuardian,
    private readonly students: typeof Student,
    private readonly stops: typeof Stop,
    private readonly trips: typeof Trip,
    private readonly deviceTokens: DeviceTokensService,
    private readonly pushProvider: PushNotificationProvider,
    // Phase 1: run-aware recipient resolution (default-run lookup).
    private readonly runs: typeof Run,
    // Phase 2: delivery policy (event expiry window etc.).
    private readonly deliveryPolicy: DeliveryPolicyConfig,
  ) {}

  /** Attach (or replace) the room broadcaster; the gateway does this once. */
  attachBroadcaster(broadcaster: NotificationBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /** Drop the broadcaster (used in tests); emissions become no-ops. */
  detachBroadcaster(): void {
    this.broadcaster = undefined;
  }

  // -------------------------------------------------------------------
  // Creation (called by the attendance and trip flows after success)
  // -------------------------------------------------------------------

  /**
   * Notifies every actively linked parent that a child boarded or was
   * dropped. Best-effort: errors are logged, never re-thrown.
   */
  async notifyStudentAttendance(input: StudentAttendanceNotificationInput): Promise<void> {
    try {
      const type =
        input.action === 'boarded'
          ? NotificationType.STUDENT_BOARDED
          : NotificationType.STUDENT_DROPPED;
      const studentName = fullName(input.student.first_name, input.student.last_name);
      const title =
        input.action === 'boarded'
          ? STUDENT_BOARDED_TITLE(input.student.first_name)
          : STUDENT_DROPPED_TITLE(input.student.first_name);
      const message =
        input.action === 'boarded'
          ? STUDENT_BOARDED_MESSAGE(studentName)
          : STUDENT_DROPPED_MESSAGE(studentName);

      const userIds = await this.resolveGuardianUserIdsForStudent(
        input.school_id,
        input.student.id,
      );

      for (const userId of userIds) {
        await this.createNotificationRow({
          school_id: input.school_id,
          user_id: userId,
          type,
          trip_id: input.trip_id,
          student_id: input.student.id,
          title,
          message,
          payload: { student_name: studentName, action: input.action },
          // Deadline anchored to the attendance event itself: a delayed
          // batch never gets a fresh alert window.
          occurred_at: input.occurred_at,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create student attendance notification for trip ${input.trip_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Notifies the parents of every rider of this trip's run whose home stop
   * sits on the trip's route that the trip changed status. `SCHEDULED` (no
   * event) is ignored. Best-effort: errors are logged, never re-thrown.
   *
   * Phase 1: run-allocated trips notify only their own run's riders'
   * parents — a second run sharing the route/stops is never notified.
   */
  async notifyTripStatusChange(input: TripStatusNotificationInput): Promise<void> {
    try {
      const type = NOTIFIABLE_TRIP_STATUSES[input.status];
      if (!type) {
        return;
      }

      const userIds = await this.resolveGuardianUserIdsForTripRoute(input.school_id, input.trip_id);
      if (userIds.length === 0) {
        return;
      }

      const title = TRIP_STATUS_TITLES[type];
      const message = TRIP_STATUS_MESSAGES[type];
      const payload: Record<string, unknown> = { trip_status: input.status };
      if (input.status === TripStatus.CANCELLED && input.cancellation_reason) {
        payload['cancellation_reason'] = input.cancellation_reason;
      }

      for (const userId of userIds) {
        await this.createNotificationRow({
          school_id: input.school_id,
          user_id: userId,
          type,
          trip_id: input.trip_id,
          student_id: null,
          title,
          message,
          payload,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create trip status notification for trip ${input.trip_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Task 22: notifies every actively linked parent of this trip/run's riders
   * whose home stop is the stop the bus just neared, e.g.
   * "Bus is near Green Park Stop."
   *
   * Phase 1: recipients are narrowed to the trip's run allocation (shared
   * stops across runs notify only the current run's riders' parents), and
   * the copy says "near" — detection proves proximity, never a confirmed
   * arrival or a child boarding.
   *
   * Called by the stop-arrival pipeline only *after* the arrival row was
   * persisted.
   *
   * `options.transaction` is the arrival's own transaction: the notification
   * rows are then written in that same transaction, so a committed arrival
   * can never exist without its notification intent and a rolled-back
   * arrival produces no notification at all. In that mode errors **propagate**
   * (the caller must roll back), while broadcasts / outbox enqueues are
   * deferred to `afterCommit` so nothing leaks out of a rolled-back
   * transaction. Without a transaction the call stays best-effort: errors are
   * logged, never re-thrown.
   */
  async notifyStopArrival(
    input: StopArrivalNotificationInput,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    const transaction = options.transaction;
    try {
      const userIds = await this.resolveGuardianUserIdsForStop(
        input.school_id,
        input.trip_id,
        input.stop.id,
      );
      if (userIds.length === 0) {
        return;
      }

      const title = STOP_ARRIVED_TITLE;
      const message = STOP_ARRIVED_MESSAGE(input.stop.name);

      for (const userId of userIds) {
        await this.createNotificationRow(
          {
            school_id: input.school_id,
            user_id: userId,
            type: NotificationType.STOP_ARRIVED,
            trip_id: input.trip_id,
            student_id: null,
            stop_id: input.stop.id,
            title,
            message,
            // Phase 1: explicit proximity semantics for clients — this event
            // proves the bus was near the stop, never a boarding/drop-off.
            payload: { stop_id: input.stop.id, stop_name: input.stop.name, proximity_only: true },
            // The deadline runs from the *event* (when the bus neared the
            // stop), not from when this row happened to be created.
            occurred_at: input.occurred_at,
          },
          { transaction },
        );
      }
    } catch (error) {
      if (transaction) {
        // The caller owns the transaction: it must fail so the arrival and
        // its notification intent commit (or roll back) together.
        throw error;
      }
      this.logger.error(
        `Failed to create stop-arrival notification for trip ${input.trip_id}, stop ${
          input.stop.id
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Parent reads (PARENT-only surface, scoped to the JWT)
  // -------------------------------------------------------------------

  /**
   * `GET /api/v1/parent/notifications` — the authenticated parent's own
   * notifications, newest first, with the total and the unread count.
   */
  async listForParent(
    actor: AuthenticatedRequestUser,
    query: ParentNotificationListQuery = {},
  ): Promise<ParentNotificationListResponse> {
    const page = normalizePage(query.page);
    const limit = normalizeLimit(query.limit);

    const scope: Record<string, unknown> = whereForActor(actor);
    if (query.status === NotificationReadFilter.UNREAD) {
      scope['is_read'] = false;
    } else if (query.status === NotificationReadFilter.READ) {
      scope['is_read'] = true;
    }
    const where = scope as WhereOptions;

    const { rows, count } = await this.notifications.findAndCountAll({
      where,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    return {
      items: rows.map((row) => this.toResponse(row)),
      total: count,
      unread_count: await this.countUnread(actor),
    };
  }

  /** Unread count of the authenticated parent (used by the bell). */
  async countUnread(actor: AuthenticatedRequestUser): Promise<number> {
    return this.notifications.count({
      where: { ...whereForActor(actor), is_read: false },
    });
  }

  /**
   * `PATCH /api/v1/parent/notifications/:id/read` — marks **only** the
   * authenticated parent's own notification as read. Another parent's id, a
   * cross-school id and an unknown id all produce the same generic 404.
   */
  async markRead(
    actor: AuthenticatedRequestUser,
    notificationId: string,
  ): Promise<NotificationResponse> {
    const row = await this.notifications.findOne({ where: whereForActor(actor, notificationId) });
    if (!row) {
      throw new NotFoundException(NOTIFICATION_NOT_FOUND_MESSAGE);
    }

    if (!row.is_read) {
      await row.update({ is_read: true, read_at: new Date() });
    }
    return this.toResponse(row);
  }

  /**
   * `PATCH /api/v1/parent/notifications/read-all` — marks all of the
   * authenticated parent's unread notifications as read.
   */
  async markAllRead(actor: AuthenticatedRequestUser): Promise<NotificationReadAllResponse> {
    const [updatedCount] = await this.notifications.update(
      { is_read: true, read_at: new Date() },
      { where: { ...whereForActor(actor), is_read: false } },
    );
    return { updated_count: updatedCount ?? 0 };
  }

  // -------------------------------------------------------------------
  // Recipient resolution (server-side, tenant-pinned)
  // -------------------------------------------------------------------

  /**
   * Every parent account with an **active** guardian link to the student
   * inside the tenant. Only users whose account role is `PARENT` (and still
   * active) receive notifications.
   */
  private async resolveGuardianUserIdsForStudent(
    schoolId: string,
    studentId: string,
  ): Promise<string[]> {
    const links = await this.guardians.findAll({
      where: { school_id: schoolId, student_id: studentId, is_active: true },
    });
    return this.filterParentUserIds(schoolId, [...new Set(links.map((link) => link.user_id))]);
  }

  /**
   * Every parent account linked to an active rider of the trip's run whose
   * home stop sits on the trip's route — the run-aware manifest derivation,
   * so exactly the parents who can observe the trip are notified about it.
   *
   * Phase 1: without the run narrowing, two runs sharing a route (tiering)
   * would notify each other's parents for every shared stop. The narrowing
   * reuses the same allocation rule as parent observation
   * (`run-ridership.ts`), honouring default-run and legacy `NULL`-run
   * semantics: on a route without runs every route student still rides.
   */
  private async resolveGuardianUserIdsForTripRoute(
    schoolId: string,
    tripId: string,
  ): Promise<string[]> {
    const context = await this.resolveTripRunContext(schoolId, tripId);
    if (!context) {
      return [];
    }

    const stopsOnRoute = await this.stops.findAll({
      where: { school_id: schoolId, route_id: context.trip.route_id },
      attributes: ['id'],
    });
    if (stopsOnRoute.length === 0) {
      return [];
    }

    const studentsOnRoute = await this.students.findAll({
      where: {
        school_id: schoolId,
        is_active: true,
        home_stop_id: { [Op.in]: stopsOnRoute.map((stop) => stop.id) },
      },
      attributes: ['id', 'run_id'],
    });
    const riders = studentsOnRoute.filter((student) =>
      studentRidesTripRun(student.run_id, context.tripRunId, context.defaultRunId),
    );
    if (riders.length === 0) {
      return [];
    }

    const links = await this.guardians.findAll({
      where: {
        school_id: schoolId,
        student_id: { [Op.in]: riders.map((student) => student.id) },
        is_active: true,
      },
    });
    return this.filterParentUserIds(schoolId, [...new Set(links.map((link) => link.user_id))]);
  }

  /**
   * Every parent account linked to an active rider of the trip's run whose
   * home stop is the given stop, inside the tenant — exactly the parents the
   * proximity event concerns. An unknown trip, or a stop off the trip's
   * route, resolves to nobody.
   */
  private async resolveGuardianUserIdsForStop(
    schoolId: string,
    tripId: string,
    stopId: string,
  ): Promise<string[]> {
    const context = await this.resolveTripRunContext(schoolId, tripId);
    if (!context) {
      return [];
    }

    // Defence in depth: the arrival pipeline already matches stops through
    // the trip's own route, but a stop of another route must never resolve
    // recipients for this trip even if called directly.
    const stop = await this.stops.findOne({
      where: { id: stopId, school_id: schoolId },
      attributes: ['id', 'route_id'],
    });
    if (!stop || stop.route_id !== context.trip.route_id) {
      return [];
    }

    const studentsAtStop = await this.students.findAll({
      where: { school_id: schoolId, home_stop_id: stopId, is_active: true },
      attributes: ['id', 'run_id'],
    });
    const riders = studentsAtStop.filter((student) =>
      studentRidesTripRun(student.run_id, context.tripRunId, context.defaultRunId),
    );
    if (riders.length === 0) {
      return [];
    }

    const links = await this.guardians.findAll({
      where: {
        school_id: schoolId,
        student_id: { [Op.in]: riders.map((student) => student.id) },
        is_active: true,
      },
    });
    return this.filterParentUserIds(schoolId, [...new Set(links.map((link) => link.user_id))]);
  }

  /**
   * Phase 1: the trip inside the caller's tenant plus its resolved run —
   * explicit `run_id`, else the route's default run (legacy `NULL`-run
   * trips), else `null` on a route without runs.
   */
  private async resolveTripRunContext(
    schoolId: string,
    tripId: string,
  ): Promise<{
    trip: { id: string; route_id: string; run_id: string | null };
    tripRunId: string | null;
    defaultRunId: string | null;
  } | null> {
    const trip = await this.findTrip(schoolId, tripId);
    if (!trip) {
      return null;
    }
    const defaultRun = await this.runs.findOne({
      where: { school_id: schoolId, route_id: trip.route_id, is_default: true },
      attributes: ['id'],
    });
    const defaultRunId = defaultRun?.id ?? null;
    return { trip, tripRunId: resolveTripRunId(trip.run_id, defaultRunId), defaultRunId };
  }

  /** Narrow the candidate ids to active accounts whose role is PARENT. */
  private async filterParentUserIds(schoolId: string, candidateIds: string[]): Promise<string[]> {
    if (candidateIds.length === 0) {
      return [];
    }

    const users = await this.users.findAll({
      where: {
        school_id: schoolId,
        id: { [Op.in]: candidateIds },
        role: UserRole.PARENT,
      },
      attributes: ['id', 'is_active'],
    });

    return users
      .filter((user) => user.is_active !== false)
      .map((user) => user.id)
      .sort();
  }

  // -------------------------------------------------------------------
  // Role push (Phase 4): OS-level push without an inbox row
  // -------------------------------------------------------------------

  /**
   * Sends an OS-level push to every active device of the given users of one
   * tenant. Used for the role-appropriate alerts that have no parent inbox
   * row (school admins on SOS, crew on trip cancellation / SOS handling):
   * the `notifications` table stays parent-only, so no schema change.
   *
   * Recipient ids are always resolved server-side by the caller from
   * tenant-pinned rows and re-filtered here to active accounts of the
   * same `school_id` — a cross-tenant id can never receive a push.
   * Best-effort: never throws, and a NoOp provider is a silent no-op.
   *
   * Phase 2: target tokens carry their platform so the router sends Android
   * through FCM and iOS through direct APNs — never a raw APNs token as an
   * FCM registration token.
   */
  async pushToUsers(input: RolePushInput): Promise<void> {
    try {
      if (this.pushProvider.name === NOOP_PUSH_PROVIDER_NAME) {
        return;
      }
      const uniqueIds = Array.from(new Set(input.user_ids)).filter(Boolean);
      if (uniqueIds.length === 0) {
        return;
      }
      const users = await this.users.findAll({
        where: {
          school_id: input.school_id,
          id: { [Op.in]: uniqueIds },
          ...(input.roles && input.roles.length > 0 ? { role: { [Op.in]: input.roles } } : {}),
        },
        attributes: ['id', 'is_active'],
      });
      const data: Record<string, string> = { school_id: input.school_id, type: input.type };
      for (const [key, value] of Object.entries(input.data ?? {})) {
        if (value) {
          data[key] = value;
        }
      }

      for (const user of users) {
        if (user.is_active === false) {
          continue;
        }
        const targets = await this.deviceTokens.findActiveTokenTargets(input.school_id, user.id);
        if (targets.length === 0) {
          continue;
        }
        const result = await this.pushProvider.send({
          recipientId: user.id,
          title: input.title,
          body: input.message,
          data: { ...data, user_id: user.id },
          deviceTokens: targets.map((target) => target.token),
          tokenPlatforms: targets.map((target) => target.platform),
          priority: 'high',
        });
        if (result.invalidTokens && result.invalidTokens.length > 0) {
          await this.deviceTokens.deactivateTokens(input.school_id, user.id, result.invalidTokens);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to deliver role push (${input.type}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Every active SCHOOL_ADMIN account id of one tenant (SOS recipients). */
  async resolveSchoolAdminUserIds(schoolId: string): Promise<string[]> {
    const rows = await this.users.findAll({
      where: { school_id: schoolId, role: UserRole.SCHOOL_ADMIN },
      attributes: ['id', 'is_active'],
    });
    return rows
      .filter((row) => row.is_active !== false)
      .map((row) => row.id)
      .sort();
  }

  /** The rostered driver/conductor user ids of one trip (crew recipients). */
  async resolveCrewUserIdsForTrip(schoolId: string, tripId: string): Promise<string[]> {
    const trip = await this.trips.findOne({
      where: { id: tripId, school_id: schoolId },
      attributes: ['id', 'driver_id', 'conductor_id'],
    });
    if (!trip) {
      return [];
    }
    const row = trip as unknown as { driver_id?: string | null; conductor_id?: string | null };
    return [row.driver_id, row.conductor_id].filter((id): id is string => Boolean(id));
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /** The trip row of the caller's tenant only, or `null`. */
  private async findTrip(
    schoolId: string,
    tripId: string,
  ): Promise<{ id: string; route_id: string; run_id: string | null } | null> {
    return this.trips.findOne({
      where: { id: tripId, school_id: schoolId },
      attributes: ['id', 'route_id', 'run_id'],
    });
  }

  /**
   * Persists one notification and pushes it to the parent's socket room, then
   * enqueues durable OS-level push delivery (Phase 2 — no provider call here,
   * so GPS / attendance / trip flows never block on per-parent push).
   *
   * Idempotency is enforced at the database: the row carries a stable
   * `dedup_key` (unique per school+user) and creation races collapse to a
   * no-op via the unique index, exactly like the arrival pipeline's
   * `(school, trip, stop)` backstop.
   */
  private async createNotificationRow(
    values: {
      school_id: string;
      user_id: string;
      type: NotificationType;
      trip_id: string | null;
      student_id: string | null;
      stop_id?: string | null;
      title: string;
      message: string;
      payload: Record<string, unknown>;
      /**
       * Server time of the underlying event. The delivery deadline is measured
       * from here — a notification row created late for an old event (delayed
       * batch, retried arrival) inherits the remaining window instead of a
       * fresh one. Defaults to "now" for callers without an event clock.
       */
      occurred_at?: Date | null;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    const now = new Date();
    const transaction = options.transaction;
    const eventAtMs = (values.occurred_at ?? now).getTime();
    const dedupKey = deliveryDedupKey({
      type: values.type,
      tripId: values.trip_id,
      studentId: values.student_id,
      stopId: values.stop_id ?? null,
    });

    // Fast-path duplicate guard (same event, same recipient) before insert.
    const existing = await this.notifications.findOne({
      where: {
        school_id: values.school_id,
        user_id: values.user_id,
        dedup_key: dedupKey,
      },
      ...(transaction ? { transaction } : {}),
    });
    if (existing) {
      return;
    }

    let created: Notification;
    try {
      created = await this.notifications.create(
        {
          school_id: values.school_id,
          user_id: values.user_id,
          type: values.type,
          trip_id: values.trip_id,
          student_id: values.student_id,
          stop_id: values.stop_id ?? null,
          title: values.title,
          message: values.message,
          payload: values.payload,
          is_read: false,
          read_at: null,
          // Phase 2 durable delivery metadata.
          dedup_key: dedupKey,
          push_status: 'pending',
          push_expires_at: deliveryExpiry(eventAtMs, this.deliveryPolicy),
          next_attempt_at: new Date(now.getTime() + 1),
          delivered_tokens: null,
          delivery_pending_tokens: null,
          delivery_failure_kind: null,
          delivery_abandoned_reason: null,
        },
        ...(transaction ? [{ transaction }] : []),
      );
    } catch (error) {
      // Concurrent duplicate: the unique index on (school, user, dedup_key)
      // turned the race into a no-op — never a second notification. Inside a
      // transaction the error must propagate: PostgreSQL aborts the whole
      // transaction, so swallowing it would leave the caller with a dead
      // connection and a half-written arrival.
      if (error instanceof UniqueConstraintError && !transaction) {
        return;
      }
      throw error;
    }

    const payload: NotificationRealtimeEvent = {
      notification_id: created.id,
      type: created.type,
      title: created.title,
      message: created.message,
      student_id: created.student_id ?? null,
      trip_id: created.trip_id ?? null,
      stop_id: created.stop_id ?? null,
      created_at: toIsoString(created.created_at),
    };

    if (transaction) {
      // Nothing may leave the transaction before it commits: the socket event
      // and the outbox enqueue are registered as after-commit callbacks, so a
      // rollback emits no notification and never broadcasts one.
      transaction.afterCommit(() => {
        this.broadcaster?.(notificationRoomName(values.user_id), NOTIFICATION_EVENTS.new, payload);
      });
      transaction.afterCommit(() => {
        void this.enqueuePushDelivery(created).catch((error: unknown) => {
          this.logger.error(
            `Failed to enqueue push for notification ${created.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      });
      return;
    }

    this.broadcaster?.(notificationRoomName(values.user_id), NOTIFICATION_EVENTS.new, payload);

    // Durable enqueue (never a provider call on this path).
    await this.enqueuePushDelivery(created);
  }

  /**
   * Marks the freshly created row for the outbox worker.
   *
   * - NoOp provider (local dev / CI) → `push_status = 'not_configured'`
   *   immediately and honestly: development mode never pretends delivery
   *   succeeded.
   * - Real provider → row stays `pending` with `next_attempt_at = now`; the
   *   worker claims and delivers it off the request path.
   */
  private async enqueuePushDelivery(notificationRow: Notification): Promise<void> {
    try {
      if (this.pushProvider.name === NOOP_PUSH_PROVIDER_NAME) {
        await notificationRow.update({
          push_status: PUSH_STATUS_NOT_CONFIGURED,
          last_delivery_attempt_at: new Date(),
          delivery_failure_reason: PUSH_NOT_CONFIGURED_REASON,
          next_attempt_at: null,
        });
        return;
      }
      await notificationRow.update({
        push_status: 'pending',
        next_attempt_at: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to enqueue push for notification ${notificationRow.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Explicit projection — ORM internals never leak into a response. */
  private toResponse(row: Notification): NotificationResponse {
    return {
      id: row.id,
      school_id: row.school_id,
      user_id: row.user_id,
      type: row.type,
      trip_id: row.trip_id ?? null,
      student_id: row.student_id ?? null,
      stop_id: row.stop_id ?? null,
      title: row.title,
      message: row.message,
      payload: row.payload ?? null,
      is_read: row.is_read,
      created_at: toIsoString(row.created_at),
      read_at: row.read_at ? toIsoString(row.read_at) : null,
      delivery: deliveryProjection(row),
    };
  }
}

/** The external push state surfaced on a notification (honest semantics). */
function deliveryProjection(row: Notification): Record<string, unknown> {
  const status: ExternalDeliveryStatus = row.push_status;
  return {
    status,
    retry_count: row.delivery_retry_count ?? 0,
    last_attempt_at: row.last_delivery_attempt_at
      ? toIsoString(row.last_delivery_attempt_at)
      : null,
    failure_reason: row.delivery_failure_reason ?? null,
    failure_kind: row.delivery_failure_kind ?? null,
    abandoned_reason: row.delivery_abandoned_reason ?? null,
    // Accepted-by-provider devices only — never a claim of on-device display.
    delivered_tokens: (row.delivered_tokens ?? []).length,
    // Devices still owed a delivery (0 on `sent`; non-zero explains a
    // `partial`/`failed` row).
    pending_tokens: (row.delivery_pending_tokens ?? []).length,
    // Only a row whose every targeted device was accepted is complete; a
    // partially delivered row is never presented as fully delivered.
    complete: status === 'sent',
    expires_at: row.push_expires_at ? toIsoString(row.push_expires_at) : null,
  };
}

/** Strict `(school_id, user_id)` ownership scope, plus the id when given. */
function whereForActor(
  actor: AuthenticatedRequestUser,
  notificationId?: string,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    school_id: actor.school_id,
    user_id: actor.id,
  };
  if (notificationId !== undefined) {
    where['id'] = notificationId;
  }
  return where;
}

function normalizePage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_NOTIFICATION_LIMIT;
  }
  return Math.min(Math.floor(value), MAX_NOTIFICATION_LIMIT);
}

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
