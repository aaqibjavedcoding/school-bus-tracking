import { beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import {
  NotificationReadFilter,
  NotificationType,
  NOTIFICATION_EVENTS,
  TripStatus,
  UserRole,
  notificationRoomName,
} from '@school-bus-tracking/shared-types';
import { Notification, Stop, Student, StudentGuardian, Trip, User } from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { NotificationsService } from './notifications.service';
import type {
  PushDeliveryResult,
  PushNotificationPayload,
  PushNotificationProvider,
} from './providers';
import { NOTIFICATION_NOT_FOUND_MESSAGE, PUSH_NO_DEVICE_REASON } from './notifications.constants';
import { DeviceTokensService } from './device-tokens.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ROUTE_A = '11111111-1111-4111-8111-11111111aaaa';
const ROUTE_B = '11111111-1111-4111-8111-11111111bbbb';

const STOP_1 = '22222222-2222-4222-8222-222222220001';
const STOP_2 = '22222222-2222-4222-8222-222222220002';
const STOP_OTHER_ROUTE = '22222222-2222-4222-8222-222222220003';

const STUDENT_A = '33333333-3333-4333-8333-333333330001';
const STUDENT_B = '33333333-3333-4333-8333-333333330002';
const STUDENT_INACTIVE = '33333333-3333-4333-8333-333333330003';
const STUDENT_OTHER_ROUTE = '33333333-3333-4333-8333-333333330004';

const PARENT_A = '44444444-4444-4444-8444-444444440001';
const PARENT_B = '44444444-4444-4444-8444-444444440002';
const PARENT_INACTIVE_ACCOUNT = '44444444-4444-4444-8444-444444440003';
const DRIVER_A = '44444444-4444-4444-8444-444444440004';

const TRIP_A = '55555555-5555-4555-8555-555555550001';
const TRIP_B = '55555555-5555-4555-8555-555555550002';

const NOTIFICATION_A = '66666666-6666-4666-8666-666666660001';
const NOTIFICATION_B = '66666666-6666-4666-8666-666666660002';
const NOTIFICATION_OTHER_PARENT = '66666666-6666-4666-8666-666666660003';
const NOTIFICATION_OTHER_SCHOOL = '66666666-6666-4666-8666-666666660004';

function actorOf(role: UserRole, id: string, schoolId = SCHOOL_A): AuthenticatedRequestUser {
  return { id, school_id: schoolId, role };
}

const PARENT_ACTOR = actorOf(UserRole.PARENT, PARENT_A);

interface StubNotification {
  id: string;
  school_id: string;
  user_id: string;
  type: NotificationType;
  trip_id: string | null;
  student_id: string | null;
  stop_id: string | null;
  title: string;
  message: string;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  push_status: string;
  delivery_retry_count: number;
  last_delivery_attempt_at: Date | null;
  delivery_failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
  update: (values: Record<string, unknown>) => Promise<StubNotification>;
}

interface StubUser {
  id: string;
  school_id: string;
  role: UserRole;
  is_active: boolean;
}

interface StubGuardian {
  id: string;
  school_id: string;
  student_id: string;
  user_id: string;
  is_active: boolean;
}

interface StubStudent {
  id: string;
  school_id: string;
  home_stop_id: string | null;
  is_active: boolean;
}

interface StubStop {
  id: string;
  school_id: string;
  route_id: string;
}

interface StubTrip {
  id: string;
  school_id: string;
  route_id: string;
}

/** Matches plain equality plus the `Op.in` operator. */
function matchesWhere(record: Record<string, unknown>, where: Record<PropertyKey, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected !== null && typeof expected === 'object') {
      const values = (expected as Record<symbol, unknown[]>)[Op.in];
      return Array.isArray(values) ? values.includes(actual) : actual === expected;
    }
    return actual === expected;
  });
}

function makeNotificationRow(overrides: Partial<StubNotification> = {}): StubNotification {
  const row: StubNotification = {
    id: NOTIFICATION_A,
    school_id: SCHOOL_A,
    user_id: PARENT_A,
    type: NotificationType.STUDENT_BOARDED,
    trip_id: TRIP_A,
    student_id: STUDENT_A,
    stop_id: null,
    title: 'Aarav boarded',
    message: 'Aarav Sharma boarded the school bus.',
    payload: { student_name: 'Aarav Sharma' },
    is_read: false,
    read_at: null,
    push_status: 'pending',
    delivery_retry_count: 0,
    last_delivery_attempt_at: null,
    delivery_failure_reason: null,
    created_at: new Date('2026-09-01T06:31:00.000Z'),
    updated_at: new Date('2026-09-01T06:31:00.000Z'),
    update: async (values) => {
      Object.assign(row, values, { updated_at: new Date() });
      return row;
    },
  };
  Object.assign(row, overrides);
  return row;
}

function defaultUsers(): StubUser[] {
  return [
    { id: PARENT_A, school_id: SCHOOL_A, role: UserRole.PARENT, is_active: true },
    { id: PARENT_B, school_id: SCHOOL_A, role: UserRole.PARENT, is_active: true },
    {
      id: PARENT_INACTIVE_ACCOUNT,
      school_id: SCHOOL_A,
      role: UserRole.PARENT,
      is_active: false,
    },
    { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER, is_active: true },
  ];
}

function defaultGuardians(): StubGuardian[] {
  return [
    {
      id: '77777777-7777-4777-8777-777777770001',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_A,
      is_active: true,
    },
    {
      id: '77777777-7777-4777-8777-777777770002',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_B,
      is_active: true,
    },
    {
      id: '77777777-7777-4777-8777-777777770003',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_INACTIVE_ACCOUNT,
      is_active: true,
    },
    {
      id: '77777777-7777-4777-8777-777777770004',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: DRIVER_A,
      is_active: true,
    },
    {
      id: '77777777-7777-4777-8777-777777770005',
      school_id: SCHOOL_A,
      student_id: STUDENT_B,
      user_id: PARENT_B,
      is_active: true,
    },
    // Inactive link: must never receive anything.
    {
      id: '77777777-7777-4777-8777-777777770006',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_B,
      is_active: false,
    },
    // Cross-school link: never visible from school A's events.
    {
      id: '77777777-7777-4777-8777-777777770007',
      school_id: SCHOOL_B,
      student_id: STUDENT_A,
      user_id: PARENT_B,
      is_active: true,
    },
  ];
}

function defaultStudents(): StubStudent[] {
  return [
    { id: STUDENT_A, school_id: SCHOOL_A, home_stop_id: STOP_1, is_active: true },
    { id: STUDENT_B, school_id: SCHOOL_A, home_stop_id: STOP_2, is_active: true },
    { id: STUDENT_INACTIVE, school_id: SCHOOL_A, home_stop_id: STOP_1, is_active: false },
    {
      id: STUDENT_OTHER_ROUTE,
      school_id: SCHOOL_A,
      home_stop_id: STOP_OTHER_ROUTE,
      is_active: true,
    },
  ];
}

function defaultStops(): StubStop[] {
  return [
    { id: STOP_1, school_id: SCHOOL_A, route_id: ROUTE_A },
    { id: STOP_2, school_id: SCHOOL_A, route_id: ROUTE_A },
    { id: STOP_OTHER_ROUTE, school_id: SCHOOL_A, route_id: ROUTE_B },
  ];
}

function defaultTrips(): StubTrip[] {
  return [
    { id: TRIP_A, school_id: SCHOOL_A, route_id: ROUTE_A },
    { id: TRIP_B, school_id: SCHOOL_A, route_id: ROUTE_B },
  ];
}

interface BroadcastCapture {
  calls: Array<{ room: string; event: string; payload: unknown }>;
}

/** Records every send; `name` drives the provider-selection branch. */
class FakePushProvider implements PushNotificationProvider {
  readonly isConfigured = true;
  readonly calls: PushNotificationPayload[] = [];
  sendResult: PushDeliveryResult;
  throwOnSend = false;

  constructor(public readonly name: 'noop-push' | 'fcm') {
    this.sendResult = {
      success: true,
      provider: name,
      messageId: `fake-${name}`,
      retryable: false,
    };
  }

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
    if (this.throwOnSend) {
      throw new Error('provider unavailable');
    }
    this.calls.push(payload);
    return this.sendResult;
  }

  async sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }
}

interface DeviceTokenStubRow {
  school_id: string;
  user_id: string;
  token: string;
}

function makeService(
  options: {
    createError?: Error;
    initialRows?: StubNotification[];
    activeTokens?: DeviceTokenStubRow[];
    pushProvider?: FakePushProvider;
  } = {},
) {
  const rows = [...(options.initialRows ?? [])];
  const users = defaultUsers();
  const guardians = defaultGuardians();
  const students = defaultStudents();
  const stops = defaultStops();
  const trips = defaultTrips();
  const activeTokens = [...(options.activeTokens ?? [])];
  const deactivatedTokens: string[] = [];

  let idCounter = 0;
  const notificationRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) =>
      rows.filter((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, query.where),
      ) as unknown as Notification[],
    findOne: async (query: { where: Record<PropertyKey, unknown> }) =>
      (rows.find((row) => matchesWhere(row as unknown as Record<string, unknown>, query.where)) ??
        null) as unknown as Notification,
    findAndCountAll: async (query: {
      where: Record<PropertyKey, unknown>;
      limit?: number;
      offset?: number;
      order?: unknown;
    }) => {
      const filtered = rows.filter((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, query.where),
      );
      const offset = query.offset ?? 0;
      const limit = query.limit ?? filtered.length;
      const sorted = [...filtered].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return {
        rows: sorted.slice(offset, offset + limit) as unknown as Notification[],
        count: filtered.length,
      };
    },
    count: async (query: { where: Record<PropertyKey, unknown> }) =>
      rows.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, query.where))
        .length,
    create: async (payload: Record<string, unknown>) => {
      if (options.createError) {
        throw options.createError;
      }
      idCounter += 1;
      const row = makeNotificationRow({
        id: `created-${idCounter}`,
        school_id: payload.school_id as string,
        user_id: payload.user_id as string,
        type: payload.type as NotificationType,
        trip_id: payload.trip_id as string | null,
        student_id: payload.student_id as string | null,
        stop_id: (payload.stop_id as string | null) ?? null,
        title: payload.title as string,
        message: payload.message as string,
        payload: payload.payload as Record<string, unknown> | null,
        is_read: false,
        read_at: null,
        created_at: new Date(),
      });
      rows.push(row);
      return row as unknown as Notification;
    },
    update: async (
      values: Record<string, unknown>,
      options: { where: Record<PropertyKey, unknown> },
    ) => {
      const affected = rows.filter((row) =>
        matchesWhere(row as unknown as Record<string, unknown>, options.where),
      );
      for (const row of affected) {
        await row.update(values);
      }
      return [affected.length, affected] as [number, Notification[]];
    },
  } as unknown as typeof Notification;

  const userRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) =>
      users.filter((user) =>
        matchesWhere(user as unknown as Record<string, unknown>, query.where),
      ) as unknown as User[],
  } as unknown as typeof User;

  const guardianRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) =>
      guardians.filter((guardian) =>
        matchesWhere(guardian as unknown as Record<string, unknown>, query.where),
      ) as unknown as StudentGuardian[],
  } as unknown as typeof StudentGuardian;

  const studentRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) =>
      students.filter((student) =>
        matchesWhere(student as unknown as Record<string, unknown>, query.where),
      ) as unknown as Student[],
  } as unknown as typeof Student;

  const stopRepo = {
    findAll: async (query: { where: Record<PropertyKey, unknown> }) =>
      stops.filter((stop) =>
        matchesWhere(stop as unknown as Record<string, unknown>, query.where),
      ) as unknown as Stop[],
  } as unknown as typeof Stop;

  const tripRepo = {
    findOne: async (query: { where: Record<PropertyKey, unknown> }) =>
      (trips.find((trip) =>
        matchesWhere(trip as unknown as Record<string, unknown>, query.where),
      ) ?? null) as unknown as Trip,
  } as unknown as typeof Trip;

  const deviceTokensService = {
    findActiveTokenStrings: async (schoolId: string, userId: string) =>
      activeTokens
        .filter((row) => row.school_id === schoolId && row.user_id === userId)
        .map((row) => row.token),
    deactivateTokens: async (
      _schoolId: string,
      _userId: string,
      tokens: string[],
    ): Promise<void> => {
      deactivatedTokens.push(...tokens);
    },
  } as unknown as DeviceTokensService;

  const broadcast: BroadcastCapture = { calls: [] };
  const pushProvider = options.pushProvider ?? new FakePushProvider('noop-push');
  const service = new NotificationsService(
    notificationRepo,
    userRepo,
    guardianRepo,
    studentRepo,
    stopRepo,
    tripRepo,
    deviceTokensService,
    pushProvider,
  );
  service.attachBroadcaster((room, event, payload) => {
    broadcast.calls.push({ room, event, payload });
  });

  return { service, rows, broadcast, push: pushProvider, deactivatedTokens };
}

beforeEach(() => {});

describe('NotificationsService student attendance events', () => {
  it('creates one notification per actively linked parent and broadcasts to their rooms', async () => {
    const { service, rows, broadcast } = makeService();

    await service.notifyStudentAttendance({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      student: { id: STUDENT_A, first_name: 'Aarav', last_name: 'Sharma' },
      action: 'boarded',
      occurred_at: new Date('2026-09-01T06:31:00.000Z'),
    });

    // PARENT_A + PARENT_B are actively linked PARENT accounts; the inactive
    // account, the driver account and the cross-school link receive nothing.
    assert.deepEqual(rows.map((row) => row.user_id).sort(), [PARENT_A, PARENT_B].sort());
    for (const row of rows) {
      assert.equal(row.type, NotificationType.STUDENT_BOARDED);
      assert.equal(row.school_id, SCHOOL_A);
      assert.equal(row.trip_id, TRIP_A);
      assert.equal(row.student_id, STUDENT_A);
      assert.equal(row.is_read, false);
      assert.equal(row.title, 'Aarav boarded');
      assert.equal(row.message, 'Aarav Sharma boarded the school bus.');
    }

    assert.deepEqual(
      broadcast.calls.map((call) => call.room).sort(),
      [notificationRoomName(PARENT_A), notificationRoomName(PARENT_B)].sort(),
    );
    for (const call of broadcast.calls) {
      assert.equal(call.event, NOTIFICATION_EVENTS.new);
      const payload = call.payload as { type: NotificationType; student_id: string | null };
      assert.equal(payload.type, NotificationType.STUDENT_BOARDED);
      assert.equal(payload.student_id, STUDENT_A);
    }
  });

  it('announces a drop with the drop copy', async () => {
    const { service, rows } = makeService();

    await service.notifyStudentAttendance({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      student: { id: STUDENT_A, first_name: 'Aarav', last_name: 'Sharma' },
      action: 'dropped',
      occurred_at: new Date(),
    });

    assert.ok(rows.length >= 1);
    assert.equal(rows[0].type, NotificationType.STUDENT_DROPPED);
    assert.equal(rows[0].title, 'Aarav dropped off');
    assert.equal(rows[0].message, 'Aarav Sharma has been dropped off safely.');
  });

  it('never notifies a student with no guardian links', async () => {
    const { service, rows, broadcast } = makeService();

    await service.notifyStudentAttendance({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      student: { id: STUDENT_INACTIVE, first_name: 'Iris', last_name: 'Inactive' },
      action: 'boarded',
      occurred_at: new Date(),
    });

    assert.equal(rows.length, 0);
    assert.equal(broadcast.calls.length, 0);
  });

  it('does not duplicate a notification when the same event is retried', async () => {
    const { service, rows } = makeService();

    const input = {
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      student: { id: STUDENT_A, first_name: 'Aarav', last_name: 'Sharma' } as const,
      action: 'boarded' as const,
      occurred_at: new Date(),
    };
    await service.notifyStudentAttendance(input);
    await service.notifyStudentAttendance(input);

    assert.equal(
      rows.filter((row) => row.user_id === PARENT_A).length,
      1,
      'the retried event must not create a second notification',
    );
  });

  it('swallows repository failures so the attendance flow is never broken', async () => {
    const { service } = makeService({ createError: new Error('database unavailable') });

    await assert.doesNotReject(
      service.notifyStudentAttendance({
        school_id: SCHOOL_A,
        trip_id: TRIP_A,
        student: { id: STUDENT_A, first_name: 'Aarav', last_name: 'Sharma' },
        action: 'boarded',
        occurred_at: new Date(),
      }),
    );
  });
});

describe('NotificationsService trip lifecycle events', () => {
  it('maps every notifiable status to its notification type and parent copy', async () => {
    const expectations: Array<[TripStatus, NotificationType, string]> = [
      [TripStatus.BOARDING, NotificationType.TRIP_BOARDING, "Your child's bus is now boarding."],
      [
        TripStatus.IN_PROGRESS,
        NotificationType.TRIP_IN_PROGRESS,
        "Your child's bus has started the trip.",
      ],
      [
        TripStatus.COMPLETED,
        NotificationType.TRIP_COMPLETED,
        "Your child's bus trip has been completed.",
      ],
      [
        TripStatus.CANCELLED,
        NotificationType.TRIP_CANCELLED,
        "Your child's bus trip has been cancelled.",
      ],
    ];

    for (const [status, type, message] of expectations) {
      const { service, rows } = makeService();
      await service.notifyTripStatusChange({
        school_id: SCHOOL_A,
        trip_id: TRIP_A,
        status,
      });

      assert.ok(rows.length >= 1, `status ${status} must notify`);
      for (const row of rows) {
        assert.equal(row.type, type);
        assert.equal(row.message, message);
        assert.equal(row.student_id, null);
        assert.equal(row.trip_id, TRIP_A);
      }
    }
  });

  it('notifies exactly the parents of active children whose home stop is on the route', async () => {
    const { service, rows } = makeService();

    await service.notifyTripStatusChange({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      status: TripStatus.BOARDING,
    });

    // STUDENT_A (PARENT_A, PARENT_B) and STUDENT_B (PARENT_B) sit on ROUTE_A;
    // the inactive student and the other-route student are excluded.
    assert.deepEqual(rows.map((row) => row.user_id).sort(), [PARENT_A, PARENT_B].sort());
  });

  it('never notifies for a SCHEDULED trip (no event happened)', async () => {
    const { service, rows, broadcast } = makeService();

    await service.notifyTripStatusChange({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      status: TripStatus.SCHEDULED,
    });

    assert.equal(rows.length, 0);
    assert.equal(broadcast.calls.length, 0);
  });

  it('ignores a trip of another school (tenant pinning)', async () => {
    const { service, rows } = makeService();

    await service.notifyTripStatusChange({
      school_id: SCHOOL_B,
      trip_id: TRIP_A,
      status: TripStatus.BOARDING,
    });

    assert.equal(rows.length, 0);
  });

  it('carries the cancellation reason in the payload', async () => {
    const { service, rows } = makeService();

    await service.notifyTripStatusChange({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      status: TripStatus.CANCELLED,
      cancellation_reason: 'Heavy snow',
    });

    assert.equal(rows[0].payload?.['cancellation_reason'], 'Heavy snow');
  });

  it('does not duplicate notifications on a retried transition', async () => {
    const { service, rows } = makeService();

    const input = {
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      status: TripStatus.COMPLETED,
    } as const;
    await service.notifyTripStatusChange(input);
    await service.notifyTripStatusChange(input);

    assert.equal(rows.filter((row) => row.user_id === PARENT_A).length, 1);
  });
});

describe('NotificationsService parent reads (isolation)', () => {
  it('lists only the authenticated parent’s own notifications in their own school', async () => {
    const { service } = makeService({
      initialRows: [
        makeNotificationRow({ id: NOTIFICATION_A }),
        makeNotificationRow({
          id: NOTIFICATION_B,
          created_at: new Date('2026-09-01T07:00:00.000Z'),
        }),
        makeNotificationRow({
          id: NOTIFICATION_OTHER_PARENT,
          user_id: PARENT_B,
        }),
        makeNotificationRow({
          id: NOTIFICATION_OTHER_SCHOOL,
          school_id: SCHOOL_B,
          user_id: PARENT_A,
        }),
      ],
    });

    const result = await service.listForParent(PARENT_ACTOR, {});

    assert.deepEqual(
      result.items.map((item) => item.id).sort(),
      [NOTIFICATION_A, NOTIFICATION_B].sort(),
    );
    assert.equal(result.total, 2);
    assert.equal(result.unread_count, 2);
    // Newest first.
    assert.equal(result.items[0].id, NOTIFICATION_B);
  });

  it('computes the unread count over all own notifications, not the page', async () => {
    const { service } = makeService({
      initialRows: [
        makeNotificationRow({ id: NOTIFICATION_A }),
        makeNotificationRow({
          id: NOTIFICATION_B,
          is_read: true,
          read_at: new Date(),
          created_at: new Date('2026-09-01T07:00:00.000Z'),
        }),
      ],
    });

    const result = await service.listForParent(PARENT_ACTOR, {
      status: NotificationReadFilter.UNREAD,
    });

    assert.equal(result.total, 1);
    assert.deepEqual(
      result.items.map((item) => item.id),
      [NOTIFICATION_A],
    );
    assert.equal(result.unread_count, 1);
  });

  it('filters by the read state when asked', async () => {
    const { service } = makeService({
      initialRows: [
        makeNotificationRow({ id: NOTIFICATION_A }),
        makeNotificationRow({
          id: NOTIFICATION_B,
          is_read: true,
          read_at: new Date(),
          created_at: new Date('2026-09-01T07:00:00.000Z'),
        }),
      ],
    });

    const unread = await service.listForParent(PARENT_ACTOR, {
      status: NotificationReadFilter.UNREAD,
    });
    const read = await service.listForParent(PARENT_ACTOR, {
      status: NotificationReadFilter.READ,
    });

    assert.deepEqual(
      unread.items.map((item) => item.id),
      [NOTIFICATION_A],
    );
    assert.deepEqual(
      read.items.map((item) => item.id),
      [NOTIFICATION_B],
    );
  });

  it('paginates newest first', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      makeNotificationRow({
        id: `77777777-7777-4777-8777-77777777000${index + 1}`,
        created_at: new Date(Date.UTC(2026, 8, 1, 6, index)),
      }),
    );
    const { service } = makeService({ initialRows: rows });

    const page1 = await service.listForParent(PARENT_ACTOR, { page: 1, limit: 2 });
    const page2 = await service.listForParent(PARENT_ACTOR, { page: 2, limit: 2 });

    assert.equal(page1.items.length, 2);
    assert.equal(page1.total, 5);
    assert.equal(page2.items.length, 2);
    assert.ok(
      page1.items.every(
        (item, index, all) => index === 0 || item.created_at <= all[index - 1].created_at,
      ),
    );
    assert.notEqual(page1.items[0].id, page2.items[0].id);
  });

  it('marks only the authenticated parent’s own notification as read', async () => {
    const { service, rows } = makeService({
      initialRows: [makeNotificationRow({ id: NOTIFICATION_A })],
    });

    const updated = await service.markRead(PARENT_ACTOR, NOTIFICATION_A);

    assert.equal(updated.is_read, true);
    assert.ok(updated.read_at !== null);
    assert.equal(rows[0].is_read, true);
  });

  it('is idempotent when a read notification is marked read again', async () => {
    const readAt = new Date('2026-09-01T08:00:00.000Z');
    const { service } = makeService({
      initialRows: [makeNotificationRow({ id: NOTIFICATION_A, is_read: true, read_at: readAt })],
    });

    const updated = await service.markRead(PARENT_ACTOR, NOTIFICATION_A);

    assert.equal(updated.read_at, readAt.toISOString());
  });

  it('hides another parent’s notification behind the generic 404', async () => {
    const { service } = makeService({
      initialRows: [makeNotificationRow({ id: NOTIFICATION_OTHER_PARENT, user_id: PARENT_B })],
    });

    await assert.rejects(service.markRead(PARENT_ACTOR, NOTIFICATION_OTHER_PARENT), (error) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, NOTIFICATION_NOT_FOUND_MESSAGE);
      return true;
    });
  });

  it('hides another school’s notification behind the generic 404', async () => {
    const { service } = makeService({
      initialRows: [makeNotificationRow({ id: NOTIFICATION_OTHER_SCHOOL, school_id: SCHOOL_B })],
    });

    await assert.rejects(service.markRead(PARENT_ACTOR, NOTIFICATION_OTHER_SCHOOL), (error) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, NOTIFICATION_NOT_FOUND_MESSAGE);
      return true;
    });
  });

  it('hides an unknown notification behind the generic 404', async () => {
    const { service } = makeService();

    await assert.rejects(
      service.markRead(PARENT_ACTOR, '77777777-7777-4777-8777-777777777777'),
      NotFoundException,
    );
  });

  it('marks all of the parent’s unread notifications as read (and only those)', async () => {
    const { service, rows } = makeService({
      initialRows: [
        makeNotificationRow({ id: NOTIFICATION_A }),
        makeNotificationRow({
          id: NOTIFICATION_B,
          created_at: new Date('2026-09-01T07:00:00.000Z'),
        }),
        makeNotificationRow({
          id: NOTIFICATION_OTHER_PARENT,
          user_id: PARENT_B,
        }),
        makeNotificationRow({
          id: NOTIFICATION_OTHER_SCHOOL,
          school_id: SCHOOL_B,
          user_id: PARENT_A,
        }),
      ],
    });

    const result = await service.markAllRead(PARENT_ACTOR);

    assert.equal(result.updated_count, 2);
    for (const row of rows) {
      if (row.user_id === PARENT_A && row.school_id === SCHOOL_A) {
        assert.equal(row.is_read, true);
        assert.ok(row.read_at !== null);
      } else {
        assert.equal(row.is_read, false);
      }
    }
  });
});

describe('NotificationsService stop arrivals (Task 22)', () => {
  it('notifies the active parents of children whose home stop was reached', async () => {
    const { service, rows, broadcast } = makeService();

    await service.notifyStopArrival({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      stop: { id: STOP_1, name: 'Green Park Stop' },
      occurred_at: new Date('2026-09-01T06:40:00.000Z'),
    });

    // STUDENT_A uses STOP_1: PARENT_A and PARENT_B are its active parents.
    // The inactive account, the driver and the inactive link are excluded;
    // STUDENT_B's parents (STOP_2) are not involved at all.
    assert.deepEqual(rows.map((row) => row.user_id).sort(), [PARENT_A, PARENT_B].sort());
    for (const row of rows) {
      assert.equal(row.type, NotificationType.STOP_ARRIVED);
      assert.equal(row.title, 'Bus arrived');
      assert.equal(row.message, 'Bus arrived at Green Park Stop.');
      assert.equal(row.trip_id, TRIP_A);
      assert.equal(row.stop_id, STOP_1);
      assert.equal(row.student_id, null);
      assert.deepEqual(row.payload, { stop_id: STOP_1, stop_name: 'Green Park Stop' });
    }
    assert.deepEqual(
      broadcast.calls.map((call) => call.room).sort(),
      [`notification:user:${PARENT_A}`, `notification:user:${PARENT_B}`].sort(),
    );
  });

  it('never duplicates a notification for the same trip + stop + type', async () => {
    const { service, rows } = makeService();
    const input = {
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      stop: { id: STOP_1, name: 'Green Park Stop' },
      occurred_at: new Date('2026-09-01T06:40:00.000Z'),
    };

    await service.notifyStopArrival(input);
    await service.notifyStopArrival(input);

    assert.equal(rows.length, 2); // one per parent, not two per parent
    assert.deepEqual(rows.map((row) => row.user_id).sort(), [PARENT_A, PARENT_B].sort());
  });

  it('creates nothing when no active child uses the reached stop', async () => {
    const { service, rows, broadcast } = makeService();

    await service.notifyStopArrival({
      school_id: SCHOOL_A,
      trip_id: TRIP_A,
      stop: { id: STOP_OTHER_ROUTE, name: 'Birch Rd' },
      occurred_at: new Date('2026-09-01T06:40:00.000Z'),
    });

    assert.equal(rows.length, 0);
    assert.equal(broadcast.calls.length, 0);
  });

  it('never resolves recipients across tenants (cross-school isolation)', async () => {
    const { service, rows } = makeService();

    // Same stop id, but inside another tenant: the student/guardian lookups
    // are pinned to the given school, so nothing is created.
    await service.notifyStopArrival({
      school_id: SCHOOL_B,
      trip_id: TRIP_A,
      stop: { id: STOP_1, name: 'Green Park Stop' },
      occurred_at: new Date('2026-09-01T06:40:00.000Z'),
    });

    assert.equal(rows.length, 0);
  });
});

describe('NotificationsService push delivery', () => {
  const attendanceInput = {
    school_id: SCHOOL_A,
    trip_id: TRIP_A,
    student: { id: STUDENT_A, first_name: 'Aarav', last_name: 'Sharma' },
    action: 'boarded' as const,
    occurred_at: new Date('2026-09-01T06:31:00.000Z'),
  };

  it('records not_configured when the NoOp provider is active', async () => {
    const { service, rows, push } = makeService({
      activeTokens: [{ school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-1' }],
    });

    await service.notifyStudentAttendance(attendanceInput);

    assert.equal(push.calls.length, 0, 'NoOp must not be invoked');
    const row = rows[0]!;
    assert.equal(row.push_status, 'not_configured');
    assert.equal(row.delivery_retry_count, 0);
    assert.ok(row.last_delivery_attempt_at !== null);
    assert.equal(row.delivery_failure_reason, null);
  });

  it('sends an FCM notification message to every active token and records sent', async () => {
    const push = new FakePushProvider('fcm');
    const {
      service,
      rows,
      push: used,
    } = makeService({
      pushProvider: push,
      activeTokens: [
        { school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-a' },
        { school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-b' },
        { school_id: SCHOOL_A, user_id: PARENT_B, token: 'tok-other' },
      ],
    });

    await service.notifyStudentAttendance(attendanceInput);

    assert.equal(used, push);
    const sent = push.calls.find((call) => call.deviceTokens.includes('tok-a'))!;
    assert.deepEqual(sent.deviceTokens, ['tok-a', 'tok-b']);
    assert.equal(sent.title, 'Aarav boarded');
    assert.equal(sent.body, 'Aarav Sharma boarded the school bus.');
    assert.equal(sent.recipientId, PARENT_A);
    assert.equal(sent.priority, 'high');
    // data payload: deep-link keys, all strings.
    const data = sent.data as Record<string, string>;
    assert.equal(data.school_id, SCHOOL_A);
    assert.equal(data.user_id, PARENT_A);
    assert.equal(data.type, NotificationType.STUDENT_BOARDED);
    assert.equal(data.trip_id, TRIP_A);
    assert.equal(data.student_id, STUDENT_A);
    assert.ok(typeof data.id === 'string' && data.id.length > 0);

    const row = rows.find((r) => r.user_id === PARENT_A)!;
    assert.equal(row.push_status, 'sent');
    assert.equal(row.delivery_retry_count, 0);
    assert.ok(row.last_delivery_attempt_at !== null);
    assert.equal(row.delivery_failure_reason, null);
  });

  it('records a failed push with the retry count and reason', async () => {
    const push = new FakePushProvider('fcm');
    push.sendResult = {
      success: false,
      provider: 'fcm',
      error: 'messaging/third-party-auth-error',
      retryable: true,
    };
    const { service, rows } = makeService({
      pushProvider: push,
      activeTokens: [{ school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-1' }],
    });

    await service.notifyStudentAttendance(attendanceInput);

    const row = rows.find((r) => r.user_id === PARENT_A)!;
    assert.equal(row.push_status, 'failed');
    assert.equal(row.delivery_retry_count, 1);
    assert.equal(row.delivery_failure_reason, 'messaging/third-party-auth-error');
  });

  it('records failed + no-device when the recipient has no active token', async () => {
    const push = new FakePushProvider('fcm');
    const { service, rows } = makeService({ pushProvider: push });

    await service.notifyStudentAttendance(attendanceInput);

    const row = rows.find((r) => r.user_id === PARENT_A)!;
    assert.equal(row.push_status, 'failed');
    assert.equal(row.delivery_retry_count, 1);
    assert.equal(row.delivery_failure_reason, PUSH_NO_DEVICE_REASON);
    assert.equal(push.calls.length, 0);
  });

  it('deactivates tokens FCM reported as unregistered/invalid', async () => {
    const push = new FakePushProvider('fcm');
    push.sendResult = {
      success: true,
      provider: 'fcm',
      retryable: false,
      invalidTokens: ['tok-stale'],
    };
    const { service, rows, deactivatedTokens } = makeService({
      pushProvider: push,
      activeTokens: [
        { school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-live' },
        { school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-stale' },
      ],
    });

    await service.notifyStudentAttendance(attendanceInput);

    assert.deepEqual(deactivatedTokens, ['tok-stale']);
    // The live token still delivered → the notification is sent.
    const row = rows.find((r) => r.user_id === PARENT_A)!;
    assert.equal(row.push_status, 'sent');
  });

  it('swallows provider failures so the notification flow never breaks', async () => {
    const push = new FakePushProvider('fcm');
    push.throwOnSend = true;
    const { service, rows } = makeService({
      pushProvider: push,
      activeTokens: [{ school_id: SCHOOL_A, user_id: PARENT_A, token: 'tok-1' }],
    });

    await assert.doesNotReject(service.notifyStudentAttendance(attendanceInput));

    const row = rows.find((r) => r.user_id === PARENT_A)!;
    assert.equal(row.push_status, 'failed');
    assert.equal(row.delivery_retry_count, 1);
    assert.equal(row.delivery_failure_reason, 'provider unavailable');
  });
});
