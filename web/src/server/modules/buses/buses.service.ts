import { ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  BusDeleteResponse,
  BusListResponse,
  BusResponse,
  PaginationMeta,
  PlanLimitResource,
  RouteAssignmentRole,
  TripStatus,
} from '@school-bus-tracking/shared-types';
import { PlanLimitsService } from '../../common/plan-limits';
import { Bus, BusAttributes, Route, RouteAssignment, Trip, User } from '../../database/models';
import {
  BUS_DELETED_MESSAGE,
  BUS_NOT_FOUND_MESSAGE,
  BUS_NUMBER_TAKEN_MESSAGE,
  BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE,
  BUSES_REPOSITORY,
  BUSES_ROUTE_ASSIGNMENTS_REPOSITORY,
  BUSES_ROUTES_REPOSITORY,
  BUSES_TRIPS_REPOSITORY,
  BUSES_USERS_REPOSITORY,
} from './buses.constants';
import { CreateBusDto } from './dto/create-bus.dto';
import { ListBusesQueryDto } from './dto/list-buses-query.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

/** Ranked preference for the bus's "current" trip today. */
const TRIP_PREFERENCE: Record<TripStatus, number> = {
  [TripStatus.IN_PROGRESS]: 0,
  [TripStatus.BOARDING]: 1,
  [TripStatus.SCHEDULED]: 2,
  [TripStatus.COMPLETED]: 3,
  [TripStatus.CANCELLED]: 4,
};

/**
 * Tenant-safe fleet (bus) management.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Bus not found` as a missing record — the existence of
 * another school's bus is never revealed.
 */
export class BusesService {
  constructor(
    private readonly buses: typeof Bus,
    private readonly assignments: typeof RouteAssignment,
    private readonly routes: typeof Route,
    private readonly users: typeof User,
    private readonly trips: typeof Trip,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * Creates a bus inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input. Registration number and fleet bus number are unique per tenant
   * (soft-deleted rows release their identifiers).
   */
  async create(schoolId: string, dto: CreateBusDto): Promise<BusResponse> {
    // The quota check and the INSERT share one transaction + advisory lock so
    // two concurrent creates cannot both consume the last slot.
    return this.planLimits.runWithinLimit(schoolId, PlanLimitResource.BUSES, async (transaction) => {
      const registrationNumber = dto.registration_number.trim();
      const busNumber = nullableTrim(dto.bus_number);

      await this.assertRegistrationNumberFree(schoolId, registrationNumber);
      if (busNumber) {
        await this.assertBusNumberFree(schoolId, busNumber);
      }

      try {
        const bus = await this.buses.create(
          {
            school_id: schoolId,
            registration_number: registrationNumber,
            bus_number: busNumber,
            capacity: dto.capacity,
            is_active: dto.is_active ?? true,
          },
          transaction ? { transaction } : {},
        );
        return this.toBusResponse(bus);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new ConflictException(this.uniqueConflictMessage(error));
        }
        throw error;
      }
    });
  }

  /**
   * Lists buses of the authenticated school only, with pagination and an
   * optional case-insensitive search over registration / fleet number. No
   * other tenant's rows can match because `school_id` is always part of the
   * where clause.
   */
  async findAll(schoolId: string, query: ListBusesQueryDto): Promise<BusListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { registration_number: { [Op.iLike]: pattern } },
        { bus_number: { [Op.iLike]: pattern } },
      ];
    }

    const { rows, count } = await this.buses.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['registration_number', 'ASC'],
        ['bus_number', 'ASC'],
      ],
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

    return {
      items: await this.toBusResponses(rows),
      meta,
    };
  }

  /** Returns one bus only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<BusResponse> {
    const bus = await this.findBusOrThrow(schoolId, id);
    return this.toBusResponse(bus);
  }

  /**
   * Partial update of a bus that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written by this method. Explicit `null` clears the
   * nullable `bus_number`.
   */
  async update(schoolId: string, id: string, dto: UpdateBusDto): Promise<BusResponse> {
    const bus = await this.findBusOrThrow(schoolId, id);

    const updates: Partial<BusAttributes> = {};
    if (dto.registration_number !== undefined) {
      updates.registration_number = dto.registration_number.trim();
      await this.assertRegistrationNumberFree(schoolId, updates.registration_number, id);
    }
    if (dto.bus_number !== undefined) {
      updates.bus_number = nullableTrim(dto.bus_number);
      if (updates.bus_number) {
        await this.assertBusNumberFree(schoolId, updates.bus_number, id);
      }
    }
    if (dto.capacity !== undefined) {
      updates.capacity = dto.capacity;
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await bus.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(this.uniqueConflictMessage(error));
      }
      throw error;
    }

    return this.toBusResponse(bus);
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a bus of the
   * authenticated school. Records are never physically removed.
   */
  async remove(schoolId: string, id: string): Promise<BusDeleteResponse> {
    const bus = await this.findBusOrThrow(schoolId, id);
    await bus.destroy();
    return { id, message: BUS_DELETED_MESSAGE };
  }
  private async findBusOrThrow(schoolId: string, id: string): Promise<Bus> {
    const bus = await this.buses.findOne({
      where: { id, school_id: schoolId },
    });
    if (!bus) {
      throw new NotFoundException(BUS_NOT_FOUND_MESSAGE);
    }
    return bus;
  }

  /** Rejects a registration number already used by another active bus of the
   * same school; `excludeId` lets updates skip the row being edited. */
  private async assertRegistrationNumberFree(
    schoolId: string,
    registrationNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      registration_number: registrationNumber,
    };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.buses.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE);
    }
  }

  /** Rejects a fleet bus number already used by another active bus of the
   * same school; `excludeId` lets updates skip the row being edited. */
  private async assertBusNumberFree(
    schoolId: string,
    busNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      bus_number: busNumber,
    };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.buses.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(BUS_NUMBER_TAKEN_MESSAGE);
    }
  }

  /**
   * Maps a racing unique-constraint violation to the field that collided so
   * the client gets a precise message even when the pre-check lost a race.
   */
  private uniqueConflictMessage(error: UniqueConstraintError): string {
    const path = error.errors?.[0]?.path ?? Object.keys(error.fields ?? {})[0];
    return path === 'bus_number' ? BUS_NUMBER_TAKEN_MESSAGE : BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE;
  }

  /**
   * Explicit field-by-field projection — no internal or sensitive field leaks.
   * The active route / driver / conductor and today's trip status are resolved
   * with batched lookups so callers get names, never bare ids.
   */
  private async toBusResponse(bus: Bus): Promise<BusResponse> {
    const [response] = await this.toBusResponses([bus]);
    return response;
  }

  /** Batched projection of buses with their roster, crew and current trip. */
  private async toBusResponses(buses: Bus[]): Promise<BusResponse[]> {
    if (buses.length === 0) {
      return [];
    }
    const schoolId = buses[0].school_id;
    const busIds = buses.map((bus) => bus.id);

    const [assignments, todayTrips] = await Promise.all([
      this.assignments.findAll({
        where: { school_id: schoolId, bus_id: { [Op.in]: busIds }, is_active: true },
        order: [['effective_from', 'ASC']],
      }),
      this.trips.findAll({
        where: { school_id: schoolId, bus_id: { [Op.in]: busIds }, scheduled_start_at: todayRange() },
        order: [['scheduled_start_at', 'ASC']],
      }),
    ]);

    const routeIds = [...new Set(assignments.map((assignment) => assignment.route_id))];
    const userIds = [...new Set(assignments.map((assignment) => assignment.user_id))];
    const [routes, users] = await Promise.all([
      routeIds.length
        ? this.routes.findAll({ where: { school_id: schoolId, id: { [Op.in]: routeIds } } })
        : Promise.resolve([] as Route[]),
      userIds.length
        ? this.users.findAll({ where: { school_id: schoolId, id: { [Op.in]: userIds } } })
        : Promise.resolve([] as User[]),
    ]);

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const userById = new Map(users.map((user) => [user.id, user]));

    const assignmentsByBus = new Map<string, RouteAssignment[]>();
    for (const assignment of assignments) {
      if (!assignment.bus_id) continue;
      const list = assignmentsByBus.get(assignment.bus_id) ?? [];
      list.push(assignment);
      assignmentsByBus.set(assignment.bus_id, list);
    }
    const tripsByBus = new Map<string, Trip[]>();
    for (const trip of todayTrips) {
      const list = tripsByBus.get(trip.bus_id ?? '') ?? [];
      list.push(trip);
      if (trip.bus_id) tripsByBus.set(trip.bus_id, list);
    }

    return buses.map((bus) => {
      const roster = assignmentsByBus.get(bus.id) ?? [];
      const route = roster.length ? routeById.get(roster[0].route_id) : undefined;
      const driverRow = roster.find((assignment) => assignment.role === RouteAssignmentRole.DRIVER);
      const conductorRow = roster.find(
        (assignment) => assignment.role === RouteAssignmentRole.CONDUCTOR,
      );
      const driver = driverRow ? userById.get(driverRow.user_id) : undefined;
      const conductor = conductorRow ? userById.get(conductorRow.user_id) : undefined;
      const todaysTrips = tripsByBus.get(bus.id) ?? [];
      const currentTrip = [...todaysTrips].sort(
        (a, b) =>
          TRIP_PREFERENCE[a.status] - TRIP_PREFERENCE[b.status] ||
          a.scheduled_start_at.getTime() - b.scheduled_start_at.getTime(),
      )[0];

      return {
        id: bus.id,
        school_id: bus.school_id,
        registration_number: bus.registration_number,
        bus_number: bus.bus_number,
        capacity: bus.capacity,
        is_active: bus.is_active,
        created_at: bus.created_at.toISOString(),
        updated_at: bus.updated_at.toISOString(),
        assigned_route_name: route?.name ?? null,
        assigned_route_code: route?.code ?? null,
        assigned_driver_name: driver ? `${driver.first_name} ${driver.last_name}`.trim() : null,
        assigned_conductor_name: conductor
          ? `${conductor.first_name} ${conductor.last_name}`.trim()
          : null,
        current_trip_status: currentTrip?.status ?? null,
      };
    });
  }
}

/** Inclusive window covering the current UTC calendar day. */
function todayRange(): Record<symbol, Date> {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 86_400_000) };
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
