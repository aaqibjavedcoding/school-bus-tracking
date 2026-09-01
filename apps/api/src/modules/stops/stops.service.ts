import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  PlanLimitResource,
  StopDeleteResponse,
  StopListResponse,
  StopResponse,
} from '@school-bus-tracking/shared-types';
import { Route, Stop, StopAttributes } from '../../database/models';
import {
  STOP_DELETED_MESSAGE,
  STOP_NOT_FOUND_MESSAGE,
  STOP_ROUTE_INVALID_MESSAGE,
  STOP_SEQUENCE_TAKEN_MESSAGE,
  STOPS_REPOSITORY,
  STOPS_ROUTES_REPOSITORY,
} from './stops.constants';
import { CreateStopDto } from './dto/create-stop.dto';
import { ListStopsQueryDto } from './dto/list-stops-query.dto';
import { UpdateStopDto } from './dto/update-stop.dto';
import { PlanLimitsService } from '../../common/plan-limits';

/**
 * Tenant-safe stop management.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Stop not found` as a missing record — the existence
 * of another school's stop is never revealed.
 *
 * Stops are assigned to a route through `route_id`; the route is verified to
 * belong to the same school and `sequence_number` provides the per-route
 * ordering (unique among the route's active stops, enforced both here and by
 * the database).
 */
@Injectable()
export class StopsService {
  constructor(
    @Inject(STOPS_REPOSITORY) private readonly stops: typeof Stop,
    @Inject(STOPS_ROUTES_REPOSITORY) private readonly routes: typeof Route,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * Creates a stop inside the authenticated school and assigns it to a route
   * of that school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input. When `sequence_number` is omitted the stop is appended after the
   * route's current last stop.
   */
  async create(schoolId: string, dto: CreateStopDto): Promise<StopResponse> {
    await this.planLimits.assertWithinLimit(schoolId, PlanLimitResource.STOPS);
    await this.assertRouteInSchool(schoolId, dto.route_id);
    const sequenceNumber =
      dto.sequence_number ?? (await this.nextSequenceNumber(schoolId, dto.route_id));

    try {
      const stop = await this.stops.create({
        school_id: schoolId,
        route_id: dto.route_id,
        name: dto.name.trim(),
        address: nullableTrim(dto.address),
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        geofence_radius_meters: dto.geofence_radius_meters ?? 100,
        sequence_number: sequenceNumber,
        estimated_arrival_time: dto.estimated_arrival_time ?? null,
        is_active: dto.is_active ?? true,
      });
      return this.toStopResponse(stop);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STOP_SEQUENCE_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Lists stops of the authenticated school only, with pagination and an
   * optional case-insensitive search over name / address. The result is
   * ordered per route (`route_id`, then `sequence_number`) so a manifest can
   * be rendered deterministically.
   */
  async findAll(schoolId: string, query: ListStopsQueryDto): Promise<StopListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    if (query.route_id) {
      where.route_id = query.route_id;
    }
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [{ name: { [Op.iLike]: pattern } }, { address: { [Op.iLike]: pattern } }];
    }

    const { rows, count } = await this.stops.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['route_id', 'ASC'],
        ['sequence_number', 'ASC'],
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
      items: rows.map((stop) => this.toStopResponse(stop)),
      meta,
    };
  }

  /** Returns one stop only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<StopResponse> {
    const stop = await this.findStopOrThrow(schoolId, id);
    return this.toStopResponse(stop);
  }

  /**
   * Partial update of a stop that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written by this method. `route_id` may be changed but
   * only to another route of the same school. Explicit `null` clears a
   * nullable field.
   */
  async update(schoolId: string, id: string, dto: UpdateStopDto): Promise<StopResponse> {
    const stop = await this.findStopOrThrow(schoolId, id);

    const updates: Partial<StopAttributes> = {};
    if (dto.route_id !== undefined) {
      if (dto.route_id !== stop.route_id) {
        await this.assertRouteInSchool(schoolId, dto.route_id);
      }
      updates.route_id = dto.route_id;
    }
    if (dto.name !== undefined) {
      updates.name = dto.name.trim();
    }
    if (dto.address !== undefined) {
      updates.address = nullableTrim(dto.address);
    }
    if (dto.latitude !== undefined) {
      updates.latitude = dto.latitude;
    }
    if (dto.longitude !== undefined) {
      updates.longitude = dto.longitude;
    }
    if (dto.geofence_radius_meters !== undefined) {
      updates.geofence_radius_meters = dto.geofence_radius_meters;
    }
    if (dto.sequence_number !== undefined) {
      updates.sequence_number = dto.sequence_number;
    }
    if (dto.estimated_arrival_time !== undefined) {
      updates.estimated_arrival_time = dto.estimated_arrival_time ?? null;
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await stop.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STOP_SEQUENCE_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toStopResponse(stop);
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a stop of the
   * authenticated school. Records are never physically removed, and the
   * deleted stop's position on the route is released (the partial unique
   * index only covers active rows) so routes can be renumbered.
   */
  async remove(schoolId: string, id: string): Promise<StopDeleteResponse> {
    const stop = await this.findStopOrThrow(schoolId, id);
    await stop.destroy();
    return { id, message: STOP_DELETED_MESSAGE };
  }

  private async findStopOrThrow(schoolId: string, id: string): Promise<Stop> {
    const stop = await this.stops.findOne({
      where: { id, school_id: schoolId },
    });
    if (!stop) {
      throw new NotFoundException(STOP_NOT_FOUND_MESSAGE);
    }
    return stop;
  }

  /**
   * Rejects any referenced route that does not belong to the authenticated
   * school — a cross-tenant route id is indistinguishable from a nonexistent
   * one, and ownership is never taken from client-supplied values.
   */
  private async assertRouteInSchool(schoolId: string, routeId: string): Promise<void> {
    const route = await this.routes.findOne({
      where: { id: routeId, school_id: schoolId },
    });
    if (!route) {
      throw new BadRequestException(STOP_ROUTE_INVALID_MESSAGE);
    }
  }

  /** Next free position on a route: the route's highest sequence + 1. */
  private async nextSequenceNumber(schoolId: string, routeId: string): Promise<number> {
    const max = (await this.stops.max('sequence_number', {
      where: { route_id: routeId, school_id: schoolId },
    })) as number | null;
    return (max ?? 0) + 1;
  }

  /** Explicit field-by-field projection — no internal or sensitive field leaks. */
  private toStopResponse(stop: Stop): StopResponse {
    return {
      id: stop.id,
      school_id: stop.school_id,
      route_id: stop.route_id,
      name: stop.name,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      geofence_radius_meters: stop.geofence_radius_meters,
      sequence_number: stop.sequence_number,
      estimated_arrival_time: stop.estimated_arrival_time,
      is_active: stop.is_active,
      created_at: stop.created_at.toISOString(),
      updated_at: stop.updated_at.toISOString(),
    };
  }
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
