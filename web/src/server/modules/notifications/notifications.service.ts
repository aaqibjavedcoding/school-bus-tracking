import { Logger, NotFoundException } from '../../framework';
import { Op, type WhereOptions } from 'sequelize';
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
  type NotificationEvent,
  type NotificationRealtimeEvent,
} from '@school-bus-tracking/shared-types';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { Notification, Stop, Student, StudentGuardian, Trip, User } from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import {
  DEFAULT_NOTIFICATION_LIMIT,
  MAX_NOTIFICATION_LIMIT,
  NOOP_PUSH_PROVIDER_NAME,
  NOTIFICATIONS_GUARDIANS_REPOSITORY,
  NOTIFICATIONS_PUSH_PROVIDER,
  NOTIFICATIONS_REPOSITORY,
  NOTIFICATIONS_STOPS_REPOSITORY,
  NOTIFICATIONS_STUDENTS_REPOSITORY,
  NOTIFICATIONS_TRIPS_REPOSITORY,
  NOTIFICATIONS_USERS_REPOSITORY,
  NOTIFICATION_NOT_FOUND_MESSAGE,
  PUSH_NO_DEVICE_REASON,
  PUSH_STATUS_FAILED,
  PUSH_STATUS_NOT_CONFIGURED,
  PUSH_STATUS_SENT,
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
 * transition can never produce a notification. Delivery failures are logged
 * and swallowed: a notification outage must never break attendance or the
 * trip lifecycle.
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
        // A retried (or concurrent duplicate) attendance action must not
        // create a second notification for the same event.
        const existing = await this.notifications.findOne({
          where: {
            school_id: input.school_id,
            user_id: userId,
            type,
            trip_id: input.trip_id,
            student_id: input.student.id,
          },
        });
        if (existing) {
          continue;
        }

        await this.createAndBroadcast({
          school_id: input.school_id,
          user_id: userId,
          type,
          trip_id: input.trip_id,
          student_id: input.student.id,
          title,
          message,
          payload: { student_name: studentName, action: input.action },
          created_at: input.occurred_at,
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
   * Notifies the parents of every child whose home stop sits on the trip's
   * route that the trip changed status. `SCHEDULED` (no event) is ignored.
   * Best-effort: errors are logged, never re-thrown.
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
        // Retried transitions (or the admin endpoint racing the cancel
        // endpoint) must not double-notify the same parent.
        const existing = await this.notifications.findOne({
          where: {
            school_id: input.school_id,
            user_id: userId,
            type,
            trip_id: input.trip_id,
          },
        });
        if (existing) {
          continue;
        }

        await this.createAndBroadcast({
          school_id: input.school_id,
          user_id: userId,
          type,
          trip_id: input.trip_id,
          student_id: null,
          title,
          message,
          payload,
          created_at: new Date(),
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
   * Task 22: notifies every actively linked parent whose child's home stop
   * is the stop the bus just reached, e.g. "Bus arrived at Green Park Stop."
   *
   * Called by the stop-arrival pipeline only *after* the arrival row was
   * persisted, and deduplicated on `(school_id, user_id, type, trip_id,
   * stop_id)` — a replayed or racing arrival can never notify a parent
   * twice. Best-effort: errors are logged, never re-thrown.
   */
  async notifyStopArrival(input: StopArrivalNotificationInput): Promise<void> {
    try {
      const userIds = await this.resolveGuardianUserIdsForStop(input.school_id, input.stop.id);
      if (userIds.length === 0) {
        return;
      }

      const title = STOP_ARRIVED_TITLE;
      const message = STOP_ARRIVED_MESSAGE(input.stop.name);

      for (const userId of userIds) {
        // Duplicate protection for the same (trip, stop, type) — the arrival
        // row's unique index guarantees one arrival per trip-stop, and this
        // check makes the notification exactly-once as well (e.g. after a
        // crash between insert and notify).
        const existing = await this.notifications.findOne({
          where: {
            school_id: input.school_id,
            user_id: userId,
            type: NotificationType.STOP_ARRIVED,
            trip_id: input.trip_id,
            stop_id: input.stop.id,
          },
        });
        if (existing) {
          continue;
        }

        await this.createAndBroadcast({
          school_id: input.school_id,
          user_id: userId,
          type: NotificationType.STOP_ARRIVED,
          trip_id: input.trip_id,
          student_id: null,
          stop_id: input.stop.id,
          title,
          message,
          payload: { stop_id: input.stop.id, stop_name: input.stop.name },
          created_at: input.occurred_at,
        });
      }
    } catch (error) {
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
   * Every parent account linked to an active student whose home stop sits on
   * the given trip's route — the same manifest derivation the live-tracking
   * and attendance features use, so exactly the parents who can observe the
   * trip are notified about it.
   */
  private async resolveGuardianUserIdsForTripRoute(
    schoolId: string,
    tripId: string,
  ): Promise<string[]> {
    const trip = await this.findTrip(schoolId, tripId);
    if (!trip) {
      return [];
    }

    const stopsOnRoute = await this.stops.findAll({
      where: { school_id: schoolId, route_id: trip.route_id },
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
      attributes: ['id'],
    });
    if (studentsOnRoute.length === 0) {
      return [];
    }

    const links = await this.guardians.findAll({
      where: {
        school_id: schoolId,
        student_id: { [Op.in]: studentsOnRoute.map((student) => student.id) },
        is_active: true,
      },
    });
    return this.filterParentUserIds(schoolId, [...new Set(links.map((link) => link.user_id))]);
  }

  /**
   * Every parent account linked to an active student whose home stop is the
   * given stop, inside the tenant — exactly the parents the arrival concerns.
   */
  private async resolveGuardianUserIdsForStop(schoolId: string, stopId: string): Promise<string[]> {
    const studentsAtStop = await this.students.findAll({
      where: { school_id: schoolId, home_stop_id: stopId, is_active: true },
      attributes: ['id'],
    });
    if (studentsAtStop.length === 0) {
      return [];
    }

    const links = await this.guardians.findAll({
      where: {
        school_id: schoolId,
        student_id: { [Op.in]: studentsAtStop.map((student) => student.id) },
        is_active: true,
      },
    });
    return this.filterParentUserIds(schoolId, [...new Set(links.map((link) => link.user_id))]);
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
  // Internals
  // -------------------------------------------------------------------

  /** The trip row of the caller's tenant only, or `null`. */
  private async findTrip(
    schoolId: string,
    tripId: string,
  ): Promise<{ id: string; route_id: string } | null> {
    return this.trips.findOne({
      where: { id: tripId, school_id: schoolId },
      attributes: ['id', 'route_id'],
    });
  }

  /** Persists one notification and pushes it to the parent's socket room. */
  private async createAndBroadcast(values: {
    school_id: string;
    user_id: string;
    type: NotificationType;
    trip_id: string | null;
    student_id: string | null;
    stop_id?: string | null;
    title: string;
    message: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }): Promise<void> {
    const created = await this.notifications.create({
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
    });

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

    this.broadcaster?.(notificationRoomName(values.user_id), NOTIFICATION_EVENTS.new, payload);

    // External OS-level push (FCM) happens after the row and the in-app
    // broadcast are in place; it is strictly best-effort (see deliverPush).
    await this.deliverPush(created);
  }

  /**
   * Sends the created notification as an OS-level push to the recipient's
   * active devices and records the outcome on the row.
   *
   * Never throws: a push outage (provider down, no tokens, database hiccup)
   * must never break attendance, trip lifecycle or the in-app Socket.IO
   * broadcast. Outcomes:
   *
   * - `NoOpPushProvider` active → `push_status = 'not_configured'` (local
   *   dev/CI without Firebase env).
   * - No active device tokens → `push_status = 'failed'`, retry count +1.
   * - FCM success → `push_status = 'sent'`, retry count reset.
   * - FCM failure → `push_status = 'failed'`, retry count +1, reason stored.
   * - FCM `UNREGISTERED` / `INVALID_REGISTRATION` → the offending token rows
   *   are deactivated so they are never targeted again.
   */
  private async deliverPush(notificationRow: Notification): Promise<void> {
    try {
      const attemptedAt = new Date();

      if (this.pushProvider.name === NOOP_PUSH_PROVIDER_NAME) {
        await notificationRow.update({
          push_status: PUSH_STATUS_NOT_CONFIGURED,
          last_delivery_attempt_at: attemptedAt,
          delivery_failure_reason: null,
        });
        return;
      }

      const tokens = await this.deviceTokens.findActiveTokenStrings(
        notificationRow.school_id,
        notificationRow.user_id,
      );
      if (tokens.length === 0) {
        await notificationRow.update({
          push_status: PUSH_STATUS_FAILED,
          delivery_retry_count: (notificationRow.delivery_retry_count ?? 0) + 1,
          last_delivery_attempt_at: attemptedAt,
          delivery_failure_reason: PUSH_NO_DEVICE_REASON,
        });
        return;
      }

      const result = await this.pushProvider.send({
        recipientId: notificationRow.user_id,
        title: notificationRow.title,
        body: notificationRow.message,
        data: pushDataPayload(notificationRow),
        deviceTokens: tokens,
        priority: 'high',
      });

      if (result.success) {
        await notificationRow.update({
          push_status: PUSH_STATUS_SENT,
          delivery_retry_count: 0,
          last_delivery_attempt_at: attemptedAt,
          delivery_failure_reason: null,
        });
      } else {
        await notificationRow.update({
          push_status: PUSH_STATUS_FAILED,
          delivery_retry_count: (notificationRow.delivery_retry_count ?? 0) + 1,
          last_delivery_attempt_at: attemptedAt,
          delivery_failure_reason: result.error ?? 'Push delivery failed',
        });
      }

      if (result.invalidTokens && result.invalidTokens.length > 0) {
        // Deactivation is best-effort too: the rows will simply retry once
        // more if this write fails, and FCM will reject them again.
        await this.deviceTokens.deactivateTokens(
          notificationRow.school_id,
          notificationRow.user_id,
          result.invalidTokens,
        );
      }
    } catch (error) {
      // Log the reason (never the payload; tokens/credentials stay out of
      // logs) but keep the notification flow alive.
      this.logger.error(
        `Failed to deliver push for notification ${notificationRow.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        await notificationRow.update({
          push_status: PUSH_STATUS_FAILED,
          delivery_retry_count: (notificationRow.delivery_retry_count ?? 0) + 1,
          last_delivery_attempt_at: new Date(),
          delivery_failure_reason: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // The row itself may be un-updatable in a read-only stub; the push
        // already failed and the next event will try again.
      }
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
    };
  }
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

/**
 * FCM `data` payload for deep-linking (all string values — FCM requirement):
 * the recipient's tenant/user, the event's trip/student/stop when present,
 * the notification type and the row id for the future deep-link target.
 */
function pushDataPayload(row: Notification): Record<string, string> {
  const data: Record<string, string> = {
    school_id: row.school_id,
    user_id: row.user_id,
    type: row.type,
    id: row.id,
  };
  for (const [key, value] of [
    ['trip_id', row.trip_id],
    ['student_id', row.student_id],
    ['stop_id', row.stop_id],
  ] as const) {
    if (value) {
      data[key] = value;
    }
  }
  return data;
}
