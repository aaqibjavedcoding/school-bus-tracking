import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import {
  EMERGENCIES_NAMESPACE,
  EMERGENCY_EVENTS,
  EMERGENCY_STATUS_LABELS,
  EMERGENCY_TYPE_LABELS,
  EmergencyEventResponse,
  EmergencyActiveListResponse,
  EmergencyEventListResponse,
  EmergencyStatus,
  EmergencyType,
  PaginationMeta,
  TripStatus,
  UserRole,
  emergencyRoomName,
  isEmergencyStatusTransitionAllowed,
  type EmergencySocketEvent,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  EmergencyEvent,
  EmergencyEventAttributes,
  EmergencyEventCreationAttributes,
  Route,
  Trip,
  User,
} from '../../database/models';
import {
  EMERGENCIES_BUS_REPOSITORY,
  EMERGENCIES_REPOSITORY,
  EMERGENCIES_ROUTE_REPOSITORY,
  EMERGENCIES_TRIP_REPOSITORY,
  EMERGENCIES_USER_REPOSITORY,
  EMERGENCY_COORDINATES_PAIR_MESSAGE,
  EMERGENCY_NOT_FOUND_MESSAGE,
  EMERGENCY_STATUS_FORBIDDEN_MESSAGE,
  EMERGENCY_STATUS_TRANSITION_MESSAGE,
  EMERGENCY_TRIP_NOT_FOUND_MESSAGE,
} from './emergencies.constants';
import { ListEmergenciesQueryDto, SosDto, UpdateEmergencyStatusDto } from './dto';

/** Non-sensitive actor performing an emergency operation. */
export interface EmergencyActor {
  id: string;
  school_id: string;
  role: UserRole;
}

/** Server → room broadcast hook installed by the Socket.IO gateway. */
export type EmergencyBroadcaster = (
  room: string,
  event: EmergencySocketEvent,
  payload: EmergencyEventResponse,
) => void;

/** Trips from which a crew member may raise an SOS, most relevant first. */
const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.IN_PROGRESS,
  TripStatus.BOARDING,
  TripStatus.SCHEDULED,
];

/**
 * Crew SOS / emergency events (Task 44).
 *
 * A driver or conductor raises an alarm from the mobile app; the backend
 * records it with its **own** clock, snapshots the trip context (bus, route)
 * so the incident stays readable after a roster change, and broadcasts it to
 * the school's Socket.IO room. Delivery is entirely first-party — database +
 * self-hosted Socket.IO — so no SMS gateway, push vendor or any other paid
 * third party is involved anywhere in the flow.
 *
 * Security model (identical to the rest of the API):
 *
 * - The **tenant** comes from the verified JWT, never from the body.
 * - The **crew identity** comes from the JWT subject, so an SOS can never be
 *   attributed to somebody else.
 * - The **event time** is the server clock; a client can neither set it nor
 *   back-date it.
 * - The **trip** must belong to the caller's own roster, so a crew member
 *   cannot raise an alarm against another school's (or another day's) trip.
 * - Every list/detail query is pinned with `school_id`, so cross-tenant probes
 *   see the same generic `404` as a missing record.
 */
@Injectable()
export class EmergenciesService {
  private broadcaster: EmergencyBroadcaster | null = null;

  constructor(
    @Inject(EMERGENCIES_REPOSITORY) private readonly events: typeof EmergencyEvent,
    @Inject(EMERGENCIES_TRIP_REPOSITORY) private readonly trips: typeof Trip,
    @Inject(EMERGENCIES_BUS_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(EMERGENCIES_ROUTE_REPOSITORY) private readonly routes: typeof Route,
    @Inject(EMERGENCIES_USER_REPOSITORY) private readonly users: typeof User,
  ) {}

  /** Installed by {@link EmergenciesGateway} once the namespace is up. */
  attachBroadcaster(broadcaster: EmergencyBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /**
   * `POST /api/v1/emergencies/sos` — records a new emergency event.
   *
   * The trip is resolved from the caller's *own* roster:
   * - with `trip_id`, the trip must be one the crew member drives or conducts;
   * - without it, the crew member's most relevant trip of today is used;
   * - with no trip at all the SOS is still recorded (off-duty emergency), just
   *   without a bus/route snapshot.
   */
  async raiseSos(actor: EmergencyActor, dto: SosDto): Promise<EmergencyEventResponse> {
    const hasLatitude = dto.latitude !== null && dto.latitude !== undefined;
    const hasLongitude = dto.longitude !== null && dto.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(EMERGENCY_COORDINATES_PAIR_MESSAGE);
    }

    const trip = dto.trip_id
      ? await this.findOwnTrip(actor, dto.trip_id)
      : await this.findCurrentTrip(actor);
    if (dto.trip_id && !trip) {
      throw new NotFoundException(EMERGENCY_TRIP_NOT_FOUND_MESSAGE);
    }

    const values: EmergencyEventCreationAttributes = {
      school_id: actor.school_id,
      trip_id: trip?.id ?? null,
      bus_id: trip?.bus_id ?? null,
      route_id: trip?.route_id ?? null,
      raised_by_user_id: actor.id,
      raised_by_role: actor.role === UserRole.CONDUCTOR ? UserRole.CONDUCTOR : UserRole.DRIVER,
      type: dto.type,
      status: EmergencyStatus.OPEN,
      message: dto.message ?? null,
      latitude: hasLatitude ? Number(dto.latitude) : null,
      longitude: hasLongitude ? Number(dto.longitude) : null,
      accuracy: dto.accuracy === null || dto.accuracy === undefined ? null : Number(dto.accuracy),
      // Server clock: the authoritative event time.
      triggered_at: new Date(),
      acknowledged_at: null,
      acknowledged_by_user_id: null,
      resolved_at: null,
      resolved_by_user_id: null,
      resolution_note: null,
    };

    const event = await this.events.create(values);
    const response = await this.toResponse(event);
    this.broadcast(EMERGENCY_EVENTS.new, response);
    return response;
  }

  /**
   * `GET /api/v1/emergencies` — the school's incident history, newest first.
   */
  async listForSchool(
    schoolId: string,
    query: ListEmergenciesQueryDto,
  ): Promise<EmergencyEventListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildWhere(schoolId, query);

    const { rows, count } = await this.events.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [['triggered_at', 'DESC']],
    });

    const totalPages = Math.ceil(count / limit);
    const meta: PaginationMeta = {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return { items: await this.toResponses(rows), meta };
  }

  /** `GET /api/v1/emergencies/active` — everything still needing attention. */
  async listActive(schoolId: string): Promise<EmergencyActiveListResponse> {
    const rows = await this.events.findAll({
      where: {
        school_id: schoolId,
        status: { [Op.in]: [EmergencyStatus.OPEN, EmergencyStatus.ACKNOWLEDGED] },
      } as WhereOptions,
      order: [['triggered_at', 'DESC']],
      limit: 100,
    });
    return { items: await this.toResponses(rows) };
  }

  /** `GET /api/v1/emergencies/mine` — the caller's own SOS history. */
  async listMine(
    actor: EmergencyActor,
    query: ListEmergenciesQueryDto,
  ): Promise<EmergencyEventListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildWhere(actor.school_id, query);
    (where as Record<string, unknown>).raised_by_user_id = actor.id;

    const { rows, count } = await this.events.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [['triggered_at', 'DESC']],
    });

    const totalPages = Math.ceil(count / limit);
    const meta: PaginationMeta = {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return { items: await this.toResponses(rows), meta };
  }

  /** `GET /api/v1/emergencies/:id` — one event of the authenticated school. */
  async findOne(schoolId: string, id: string): Promise<EmergencyEventResponse> {
    const event = await this.events.findOne({ where: { id, school_id: schoolId } });
    if (!event) {
      throw new NotFoundException(EMERGENCY_NOT_FOUND_MESSAGE);
    }
    return this.toResponse(event);
  }

  /**
   * `PATCH /api/v1/emergencies/:id/status` — one lifecycle transition.
   *
   * A `SCHOOL_ADMIN` may acknowledge, resolve or cancel any event of their
   * school. A crew member may only **cancel their own** alarm (raised by
   * mistake); they can never acknowledge or resolve on behalf of the school.
   */
  async updateStatus(
    actor: EmergencyActor,
    id: string,
    dto: UpdateEmergencyStatusDto,
    options: { requireOwnership?: boolean } = {},
  ): Promise<EmergencyEventResponse> {
    const event = await this.events.findOne({ where: { id, school_id: actor.school_id } });
    if (!event) {
      throw new NotFoundException(EMERGENCY_NOT_FOUND_MESSAGE);
    }

    const isOwner = event.raised_by_user_id === actor.id;
    if (options.requireOwnership || actor.role !== UserRole.SCHOOL_ADMIN) {
      if (!isOwner) {
        throw new NotFoundException(EMERGENCY_NOT_FOUND_MESSAGE);
      }
      if (dto.status !== EmergencyStatus.CANCELLED) {
        throw new BadRequestException(EMERGENCY_STATUS_FORBIDDEN_MESSAGE);
      }
    }

    if (!isEmergencyStatusTransitionAllowed(event.status, dto.status)) {
      throw new ConflictException(EMERGENCY_STATUS_TRANSITION_MESSAGE);
    }

    const now = new Date();
    const updates: Partial<EmergencyEventAttributes> = { status: dto.status };
    if (dto.status === EmergencyStatus.ACKNOWLEDGED) {
      updates.acknowledged_at = now;
      updates.acknowledged_by_user_id = actor.id;
      if (dto.note !== undefined) {
        updates.resolution_note = dto.note;
      }
    } else {
      updates.resolved_at = now;
      updates.resolved_by_user_id = actor.id;
      updates.resolution_note = dto.note ?? null;
    }

    await event.update(updates);
    const response = await this.toResponse(event);
    this.broadcast(EMERGENCY_EVENTS.updated, response);
    return response;
  }

  // --------------------------------------------------------------- helpers --

  private buildWhere(
    schoolId: string,
    query: ListEmergenciesQueryDto,
  ): Record<PropertyKey, unknown> {
    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.type) {
      where.type = query.type;
    }
    if (query.trip_id) {
      where.trip_id = query.trip_id;
    }
    if (query.bus_id) {
      where.bus_id = query.bus_id;
    }
    if (query.date_from || query.date_to) {
      const from = query.date_from ? new Date(`${query.date_from}T00:00:00.000Z`) : null;
      const to = query.date_to
        ? new Date(new Date(`${query.date_to}T00:00:00.000Z`).getTime() + 86_400_000)
        : null;
      const range: Record<symbol, Date> = {};
      if (from) range[Op.gte] = from;
      if (to) range[Op.lt] = to;
      if (Object.keys(range).length > 0) {
        where.triggered_at = range;
      }
    }
    return where;
  }

  /** A trip the caller is rostered on as driver or conductor. */
  private async findOwnTrip(actor: EmergencyActor, tripId: string): Promise<Trip | null> {
    return this.trips.findOne({
      where: {
        id: tripId,
        school_id: actor.school_id,
        [Op.or]: [{ driver_id: actor.id }, { conductor_id: actor.id }],
      } as WhereOptions,
    });
  }

  /** The crew member's most relevant trip of today, if they have one. */
  private async findCurrentTrip(actor: EmergencyActor): Promise<Trip | null> {
    const today = new Date();
    const start = new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const rows = await this.trips.findAll({
      where: {
        school_id: actor.school_id,
        scheduled_start_at: {
          [Op.gte]: start,
          [Op.lt]: new Date(start.getTime() + 86_400_000),
        },
        [Op.or]: [{ driver_id: actor.id }, { conductor_id: actor.id }],
      } as WhereOptions,
      order: [['scheduled_start_at', 'ASC']],
    });

    return (
      [...rows].sort(
        (a, b) => ACTIVE_TRIP_STATUSES.indexOf(a.status) - ACTIVE_TRIP_STATUSES.indexOf(b.status),
      )[0] ?? null
    );
  }

  /** Emits to the tenant's own room; a no-op before the gateway is up. */
  private broadcast(event: EmergencySocketEvent, payload: EmergencyEventResponse): void {
    if (!this.broadcaster) {
      return;
    }
    this.broadcaster(emergencyRoomName(payload.school_id), event, payload);
  }

  private async toResponse(event: EmergencyEvent): Promise<EmergencyEventResponse> {
    const [responses] = await this.toResponses([event]);
    return responses;
  }

  /**
   * Batched projection: crew, bus and route names are resolved with three
   * lookups for the whole page instead of one per row.
   */
  private async toResponses(events: EmergencyEvent[]): Promise<EmergencyEventResponse[]> {
    if (events.length === 0) {
      return [];
    }
    const schoolId = events[0].school_id;
    const userIds = [
      ...new Set(
        events.flatMap((event) => [
          event.raised_by_user_id,
          event.acknowledged_by_user_id,
          event.resolved_by_user_id,
        ]),
      ),
    ].filter((id): id is string => Boolean(id));
    const busIds = [...new Set(events.map((event) => event.bus_id))].filter((id): id is string =>
      Boolean(id),
    );
    const routeIds = [...new Set(events.map((event) => event.route_id))].filter(
      (id): id is string => Boolean(id),
    );

    const [users, buses, routes] = await Promise.all([
      userIds.length
        ? this.users.findAll({ where: { school_id: schoolId, id: { [Op.in]: userIds } } })
        : Promise.resolve([] as User[]),
      busIds.length
        ? this.buses.findAll({ where: { school_id: schoolId, id: { [Op.in]: busIds } } })
        : Promise.resolve([] as Bus[]),
      routeIds.length
        ? this.routes.findAll({ where: { school_id: schoolId, id: { [Op.in]: routeIds } } })
        : Promise.resolve([] as Route[]),
    ]);

    const userById = new Map(users.map((user) => [user.id, user]));
    const busById = new Map(buses.map((bus) => [bus.id, bus]));
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const nameOf = (id: string | null): string | null => {
      if (!id) return null;
      const user = userById.get(id);
      return user ? `${user.first_name} ${user.last_name}`.trim() : null;
    };

    return events.map((event) => ({
      id: event.id,
      school_id: event.school_id,
      trip_id: event.trip_id,
      bus_id: event.bus_id,
      route_id: event.route_id,
      raised_by_user_id: event.raised_by_user_id,
      raised_by_name: nameOf(event.raised_by_user_id),
      raised_by_role: event.raised_by_role ?? null,
      type: event.type,
      type_label: labelForType(event.type),
      status: event.status,
      status_label: labelForStatus(event.status),
      message: event.message,
      latitude: event.latitude === null ? null : Number(event.latitude),
      longitude: event.longitude === null ? null : Number(event.longitude),
      accuracy: event.accuracy === null ? null : Number(event.accuracy),
      triggered_at: toIso(event.triggered_at),
      acknowledged_at: event.acknowledged_at ? toIso(event.acknowledged_at) : null,
      acknowledged_by_name: nameOf(event.acknowledged_by_user_id),
      resolved_at: event.resolved_at ? toIso(event.resolved_at) : null,
      resolved_by_name: nameOf(event.resolved_by_user_id),
      resolution_note: event.resolution_note,
      created_at: toIso(event.created_at),
      updated_at: toIso(event.updated_at),
      bus_registration_number: event.bus_id
        ? (busById.get(event.bus_id)?.registration_number ?? null)
        : null,
      route_name: event.route_id ? (routeById.get(event.route_id)?.name ?? null) : null,
    }));
  }
}

/** ISO-8601 string of a `Date`, tolerant of a driver-supplied string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function labelForType(type: EmergencyType): string {
  return EMERGENCY_TYPE_LABELS[type] ?? type;
}

function labelForStatus(status: EmergencyStatus): string {
  return EMERGENCY_STATUS_LABELS[status] ?? status;
}

/** Namespace constant re-exported for the gateway and the tests. */
export { EMERGENCIES_NAMESPACE };
