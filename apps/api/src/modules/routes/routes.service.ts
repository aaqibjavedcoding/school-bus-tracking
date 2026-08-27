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
  RouteDeleteResponse,
  RouteListResponse,
  RouteResponse,
  RouteStopsListResponse,
  StopResponse,
} from '@school-bus-tracking/shared-types';
import { Route, RouteAttributes, Stop } from '../../database/models';
import {
  ROUTE_CODE_TAKEN_MESSAGE,
  ROUTE_DELETED_MESSAGE,
  ROUTE_NOT_FOUND_MESSAGE,
  ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE,
  ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE,
  ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE,
  ROUTES_REPOSITORY,
  ROUTES_STOPS_REPOSITORY,
} from './routes.constants';
import { CreateRouteDto } from './dto/create-route.dto';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';

/**
 * Tenant-safe route management.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Route not found` as a missing record — the existence
 * of another school's route is never revealed.
 *
 * Route stop manifests are managed here as well: `GET /routes/:id/stops`
 * returns the ordered boarding points and `PUT /routes/:id/stops` renumbers
 * them from the supplied permutation. Both are pinned to the authenticated
 * school through the route lookup.
 */
@Injectable()
export class RoutesService {
  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly routes: typeof Route,
    @Inject(ROUTES_STOPS_REPOSITORY) private readonly stops: typeof Stop,
  ) {}

  /**
   * Creates a route inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input. The route code is unique per tenant (soft-deleted rows release
   * their code).
   */
  async create(schoolId: string, dto: CreateRouteDto): Promise<RouteResponse> {
    const code = dto.code.trim();
    await this.assertCodeFree(schoolId, code);

    try {
      const route = await this.routes.create({
        school_id: schoolId,
        name: dto.name.trim(),
        code,
        description: nullableTrim(dto.description),
        is_active: dto.is_active ?? true,
      });
      return this.toRouteResponse(route);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ROUTE_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Lists routes of the authenticated school only, with pagination and an
   * optional case-insensitive search over name / code. No other tenant's rows
   * can match because `school_id` is always part of the where clause.
   */
  async findAll(schoolId: string, query: ListRoutesQueryDto): Promise<RouteListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [{ name: { [Op.iLike]: pattern } }, { code: { [Op.iLike]: pattern } }];
    }

    const { rows, count } = await this.routes.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['name', 'ASC'],
        ['code', 'ASC'],
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
      items: rows.map((route) => this.toRouteResponse(route)),
      meta,
    };
  }

  /** Returns one route only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<RouteResponse> {
    const route = await this.findRouteOrThrow(schoolId, id);
    return this.toRouteResponse(route);
  }

  /**
   * Partial update of a route that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written by this method. Explicit `null` clears the
   * nullable `description`.
   */
  async update(schoolId: string, id: string, dto: UpdateRouteDto): Promise<RouteResponse> {
    const route = await this.findRouteOrThrow(schoolId, id);

    const updates: Partial<RouteAttributes> = {};
    if (dto.name !== undefined) {
      updates.name = dto.name.trim();
    }
    if (dto.code !== undefined) {
      updates.code = dto.code.trim();
      await this.assertCodeFree(schoolId, updates.code, id);
    }
    if (dto.description !== undefined) {
      updates.description = nullableTrim(dto.description);
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await route.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ROUTE_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toRouteResponse(route);
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a route of the
   * authenticated school. Records are never physically removed.
   */
  async remove(schoolId: string, id: string): Promise<RouteDeleteResponse> {
    const route = await this.findRouteOrThrow(schoolId, id);
    await route.destroy();
    return { id, message: ROUTE_DELETED_MESSAGE };
  }

  /**
   * `GET /api/v1/routes/:id/stops`
   *
   * Returns the route's active stops ordered by `sequence_number`. Both the
   * route and the stops are pinned to the authenticated school.
   */
  async findRouteStops(schoolId: string, routeId: string): Promise<RouteStopsListResponse> {
    await this.findRouteOrThrow(schoolId, routeId);

    const stops = await this.stops.findAll({
      where: { route_id: routeId, school_id: schoolId },
      order: [['sequence_number', 'ASC']],
    });

    return { items: stops.map((stop) => this.toStopResponse(stop)) };
  }

  /**
   * `PUT /api/v1/routes/:id/stops`
   *
   * Renumbers the route's active stops 1..N from the supplied permutation.
   *
   * The payload must list every active stop of the route exactly once
   * (unknown, duplicate or missing ids are rejected with 400). Renumbering
   * happens inside a transaction and first moves every stop to a temporary
   * negative position so that swaps never collide with the per-route unique
   * sequence constraint.
   */
  async reorderRouteStops(
    schoolId: string,
    routeId: string,
    dto: ReorderRouteStopsDto,
  ): Promise<RouteStopsListResponse> {
    await this.findRouteOrThrow(schoolId, routeId);

    const stops = await this.stops.findAll({
      where: { route_id: routeId, school_id: schoolId },
    });
    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
    const ids = dto.stop_ids;

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE);
    }
    if (ids.length !== stops.length) {
      throw new BadRequestException(ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE);
    }
    for (const id of ids) {
      if (!stopsById.has(id)) {
        throw new BadRequestException(ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE);
      }
    }

    const sequelize = this.stops.sequelize;
    if (!sequelize) {
      throw new Error('Sequelize instance is unavailable for stop reordering');
    }

    await sequelize.transaction(async (transaction) => {
      // Phase 1: move every stop to a temporary unique position so the final
      // writes below can never collide on (route_id, sequence_number).
      for (const stop of stops) {
        await stop.update({ sequence_number: -stop.sequence_number }, { transaction });
      }
      // Phase 2: write the requested 1..N positions.
      for (let index = 0; index < ids.length; index += 1) {
        const stop = stopsById.get(ids[index]);
        if (stop) {
          await stop.update({ sequence_number: index + 1 }, { transaction });
        }
      }
    });

    const ordered = ids.map((id) => {
      const stop = stopsById.get(id);
      return stop ? this.toStopResponse(stop) : null;
    });
    return { items: ordered.filter((stop): stop is StopResponse => stop !== null) };
  }

  private async findRouteOrThrow(schoolId: string, id: string): Promise<Route> {
    const route = await this.routes.findOne({
      where: { id, school_id: schoolId },
    });
    if (!route) {
      throw new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
    }
    return route;
  }

  /** Rejects a code already used by another active route of the same school;
   * `excludeId` lets updates skip the row being edited. */
  private async assertCodeFree(schoolId: string, code: string, excludeId?: string): Promise<void> {
    const where: Record<PropertyKey, unknown> = { school_id: schoolId, code };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.routes.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(ROUTE_CODE_TAKEN_MESSAGE);
    }
  }

  /** Explicit field-by-field projection — no internal or sensitive field leaks. */
  private toRouteResponse(route: Route): RouteResponse {
    return {
      id: route.id,
      school_id: route.school_id,
      name: route.name,
      code: route.code,
      description: route.description,
      is_active: route.is_active,
      created_at: route.created_at.toISOString(),
      updated_at: route.updated_at.toISOString(),
    };
  }

  /** Explicit field-by-field projection of a stop (route manifest responses). */
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
