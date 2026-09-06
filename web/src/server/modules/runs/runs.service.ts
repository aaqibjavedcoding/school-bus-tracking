import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, Transaction, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  PlanLimitResource,
  RouteAssignmentRole,
  RunDeleteResponse,
  RunListResponse,
  RunResponse,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  Route,
  Run,
  RunAttributes,
  RunCrew,
  Shift,
  Student,
  User,
} from '../../database/models';
import { PlanLimitsService } from '../../common/plan-limits';
import {
  RUN_BUS_INVALID_MESSAGE,
  RUN_CODE_MAX_SUFFIX,
  RUN_CODE_TAKEN_MESSAGE,
  RUN_CODE_UNAVAILABLE_MESSAGE,
  RUN_DEFAULT_UNDELETABLE_MESSAGE,
  RUN_DELETED_MESSAGE,
  RUN_INACTIVE_RESOURCE_MESSAGE,
  RUN_NOT_FOUND_MESSAGE,
  RUN_ROUTE_INVALID_MESSAGE,
  RUN_SHIFT_INVALID_MESSAGE,
} from './runs.constants';
import { CreateRouteRunDto, CreateRunDto } from './dto/create-run.dto';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { UpdateRunDto } from './dto/update-run.dto';
import { normalizeTime } from '../shifts/shifts.service';
import { ROUTE_NOT_FOUND_MESSAGE } from '../routes/routes.constants';
import { BUS_NOT_FOUND_MESSAGE } from '../buses/buses.constants';

/** The route facts default-run provisioning needs. */
export interface DefaultRunSource {
  id: string;
  code: string;
  is_active: boolean;
}

/**
 * Tenant-safe run management — `docs/operating-model.md` §3.2 and §8.2.
 *
 * A run is one vehicle's timed pass over a route. Every operation receives
 * `schoolId` from the authenticated user's verified JWT claims and pins every
 * query with `where: { school_id: schoolId }`; every referenced route, shift
 * and bus is looked up inside that tenant, so a run can never combine
 * resources from two schools (the composite foreign keys are the last line of
 * defence, this service is the first).
 *
 * Session 2A scope: CRUD, the plan-limit reservation, per-school run-code
 * uniqueness and default-run provisioning. The §4 window-overlap conflict
 * engine (bus / crew double-booking across runs) is Session 2B and plugs into
 * `create` / `update` here.
 */
export class RunsService {
  constructor(
    private readonly runs: typeof Run,
    private readonly routes: typeof Route,
    private readonly shifts: typeof Shift,
    private readonly buses: typeof Bus,
    private readonly runCrew: typeof RunCrew,
    private readonly users: typeof User,
    private readonly students: typeof Student,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * `POST /api/v1/runs`
   *
   * Creates a hand-made (never default) run inside the authenticated school.
   * The `runs` plan quota is reserved inside the same transaction as the
   * INSERT (advisory lock + count, see `PlanLimitsService.runWithinLimit`), so
   * two concurrent creates cannot both pass with one seat left.
   *
   * `is_default` is never accepted from a client and is always `false` here:
   * `uq_runs_route_default` guarantees one default run per route and only
   * {@link provisionDefaultRun} may write it.
   */
  async create(schoolId: string, dto: CreateRunDto): Promise<RunResponse> {
    return this.createForRoute(schoolId, dto.route_id, dto);
  }

  /** `POST /api/v1/routes/:id/runs` — the nested create; the route comes from the path. */
  async createForRoute(
    schoolId: string,
    routeId: string,
    dto: CreateRouteRunDto,
  ): Promise<RunResponse> {
    return this.planLimits.runWithinLimit(schoolId, PlanLimitResource.RUNS, async (transaction) => {
      const options = transaction ? { transaction } : {};
      const isActive = dto.is_active ?? true;
      const shiftId = dto.shift_id ?? null;
      const busId = dto.bus_id ?? null;

      const route = await this.assertRelatedResources(
        schoolId,
        routeId,
        shiftId,
        busId,
        isActive,
        transaction,
      );

      const code =
        dto.code !== undefined
          ? await this.assertCodeFree(schoolId, dto.code.trim(), undefined, transaction)
          : await this.deriveCode(schoolId, route.code, transaction);

      try {
        const run = await this.runs.create(
          {
            school_id: schoolId,
            route_id: route.id,
            shift_id: shiftId,
            bus_id: busId,
            code,
            is_default: false,
            is_active: isActive,
          },
          options,
        );
        const [response] = await this.toResponses([run], transaction);
        return response;
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new ConflictException(RUN_CODE_TAKEN_MESSAGE);
        }
        throw error;
      }
    });
  }

  /**
   * Auto-provisions the **default run** of a freshly created route
   * (`docs/operating-model.md` §6.1): `code = route.code`, `is_default = true`,
   * no shift (whole-day under §4.3), no bus, `is_active` copied from the route.
   *
   * Called by `RoutesService.create` inside the route's own transaction, so a
   * route can never exist without its default run. The default run is
   * deliberately *not* metered against the `runs` quota: it is the 1:1
   * back-compat twin of a route that already passed the `routes` quota, and
   * "an operator who does nothing must see no difference". It does count as
   * usage afterwards, so additional (tiering) runs are what the cap limits.
   *
   * A live hand-made run already holding the route's code is a 409 — the
   * parent-facing promise "bus R-01" must never be ambiguous, and silently
   * giving the default run a different code would break the continuity the
   * default run exists to provide.
   */
  async provisionDefaultRun(
    schoolId: string,
    route: DefaultRunSource,
    transaction?: Transaction,
  ): Promise<Run> {
    await this.assertCodeFree(schoolId, route.code, undefined, transaction);
    try {
      return await this.runs.create(
        {
          school_id: schoolId,
          route_id: route.id,
          shift_id: null,
          bus_id: null,
          code: route.code,
          is_default: true,
          is_active: route.is_active,
        },
        transaction ? { transaction } : {},
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(RUN_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Soft deletes every live run of a route — the counterpart of
   * {@link provisionDefaultRun}, called by `RoutesService.remove`. A run is a
   * pass over a route; without the route it has nothing to drive and would
   * otherwise keep consuming `runs` quota forever.
   */
  async removeForRoute(
    schoolId: string,
    routeId: string,
    transaction?: Transaction,
  ): Promise<number> {
    return this.runs.destroy({
      where: { school_id: schoolId, route_id: routeId } as WhereOptions,
      ...(transaction ? { transaction } : {}),
    });
  }

  /**
   * `GET /api/v1/runs` — lists runs of the authenticated school only, with
   * pagination, the `route_id` / `shift_id` / `bus_id` / `is_active` filters
   * and a case-insensitive search over the run code and the route name/code.
   */
  async findAll(schoolId: string, query: ListRunsQueryDto): Promise<RunListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    if (query.route_id !== undefined) where.route_id = query.route_id;
    if (query.shift_id !== undefined) where.shift_id = query.shift_id;
    if (query.bus_id !== undefined) where.bus_id = query.bus_id;
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const search = query.search?.trim();
    if (search) {
      where[Op.or] = await this.buildSearchWhere(schoolId, search);
    }

    const { rows, count } = await this.runs.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['code', 'ASC'],
        ['created_at', 'ASC'],
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

    return { items: await this.toResponses(rows), meta };
  }

  /** `GET /api/v1/routes/:id/runs` — 404 unless the route is in the tenant. */
  async findAllForRoute(
    schoolId: string,
    routeId: string,
    query: ListRunsQueryDto,
  ): Promise<RunListResponse> {
    const route = await this.routes.findOne({ where: { id: routeId, school_id: schoolId } });
    if (!route) {
      throw new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
    }
    return this.findAll(
      schoolId,
      Object.assign(new ListRunsQueryDto(), query, { route_id: routeId }),
    );
  }

  /**
   * `GET /api/v1/buses/:busId/runs` — the tiering / bus day view: every run
   * this vehicle holds, across routes and shifts. 404 unless the bus is in the
   * tenant.
   */
  async findAllForBus(
    schoolId: string,
    busId: string,
    query: ListRunsQueryDto,
  ): Promise<RunListResponse> {
    const bus = await this.buses.findOne({ where: { id: busId, school_id: schoolId } });
    if (!bus) {
      throw new NotFoundException(BUS_NOT_FOUND_MESSAGE);
    }
    return this.findAll(schoolId, Object.assign(new ListRunsQueryDto(), query, { bus_id: busId }));
  }

  /** Returns one run only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<RunResponse> {
    const run = await this.findRunOrThrow(schoolId, id);
    const [response] = await this.toResponses([run]);
    return response;
  }

  /**
   * `PATCH /api/v1/runs/:id`
   *
   * Partial update. `route_id` and `is_default` are immutable (not in the
   * DTO); `shift_id` / `bus_id` accept `null` to clear. Related resources are
   * re-validated against the tenant with the merged values, and a changed
   * code must still be unique among live runs of the school.
   */
  async update(schoolId: string, id: string, dto: UpdateRunDto): Promise<RunResponse> {
    const run = await this.findRunOrThrow(schoolId, id);
    const updates: Partial<RunAttributes> = {};

    const shiftId = dto.shift_id === undefined ? run.shift_id : dto.shift_id;
    const busId = dto.bus_id === undefined ? run.bus_id : dto.bus_id;
    const isActive = dto.is_active ?? run.is_active;

    await this.assertRelatedResources(schoolId, run.route_id, shiftId, busId, isActive);

    if (dto.shift_id !== undefined) updates.shift_id = shiftId;
    if (dto.bus_id !== undefined) updates.bus_id = busId;
    if (dto.is_active !== undefined) updates.is_active = isActive;
    if (dto.code !== undefined) {
      updates.code = await this.assertCodeFree(schoolId, dto.code.trim(), id);
    }

    try {
      await run.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(RUN_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }

    const [response] = await this.toResponses([run]);
    return response;
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a run of the
   * authenticated school.
   *
   * The default run of a route is refused (409): it is the back-compat twin
   * every legacy read path resolves through (§6.1), and it disappears with
   * its route via {@link removeForRoute}. Deactivate it instead to hand the
   * quota back and take it out of the conflict checks.
   */
  async remove(schoolId: string, id: string): Promise<RunDeleteResponse> {
    const run = await this.findRunOrThrow(schoolId, id);
    if (run.is_default) {
      throw new ConflictException(RUN_DEFAULT_UNDELETABLE_MESSAGE);
    }
    await run.destroy();
    return { id, message: RUN_DELETED_MESSAGE };
  }
  private async findRunOrThrow(schoolId: string, id: string): Promise<Run> {
    const run = await this.runs.findOne({ where: { id, school_id: schoolId } });
    if (!run) {
      throw new NotFoundException(RUN_NOT_FOUND_MESSAGE);
    }
    return run;
  }

  /**
   * Validates every reference against the authenticated tenant. Related
   * records from another school intentionally produce the same generic 400 as
   * missing records so their existence is not disclosed. Returns the route so
   * callers can derive the run code from it.
   */
  private async assertRelatedResources(
    schoolId: string,
    routeId: string,
    shiftId: string | null,
    busId: string | null,
    isActive: boolean,
    transaction?: Transaction,
  ): Promise<Route> {
    const options = transaction ? { transaction } : {};

    const route = await this.routes.findOne({
      where: { id: routeId, school_id: schoolId },
      ...options,
    });
    if (!route) {
      throw new BadRequestException(RUN_ROUTE_INVALID_MESSAGE);
    }

    let shift: Shift | null = null;
    if (shiftId !== null) {
      shift = await this.shifts.findOne({
        where: { id: shiftId, school_id: schoolId },
        ...options,
      });
      if (!shift) {
        throw new BadRequestException(RUN_SHIFT_INVALID_MESSAGE);
      }
    }

    let bus: Bus | null = null;
    if (busId !== null) {
      bus = await this.buses.findOne({
        where: { id: busId, school_id: schoolId },
        ...options,
      });
      if (!bus) {
        throw new BadRequestException(RUN_BUS_INVALID_MESSAGE);
      }
    }

    if (
      isActive &&
      (route.is_active === false || shift?.is_active === false || bus?.is_active === false)
    ) {
      throw new BadRequestException(RUN_INACTIVE_RESOURCE_MESSAGE);
    }

    return route;
  }

  /**
   * Rejects a code already used by another live run of the same school;
   * `excludeId` lets updates skip the row being edited. Returns the code so
   * the call reads as an assignment at the call site.
   */
  private async assertCodeFree(
    schoolId: string,
    code: string,
    excludeId?: string,
    transaction?: Transaction,
  ): Promise<string> {
    const where: Record<PropertyKey, unknown> = { school_id: schoolId, code };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.runs.findOne({
      where: where as WhereOptions,
      ...(transaction ? { transaction } : {}),
    });
    if (existing) {
      throw new ConflictException(RUN_CODE_TAKEN_MESSAGE);
    }
    return code;
  }

  /**
   * Derives a parent-facing code from the route code when the client sends
   * none: the route code itself if it is free (it normally is not — the
   * default run holds it), else `<route code>-2`, `-3`, … up to
   * {@link RUN_CODE_MAX_SUFFIX}, trimmed so the result fits `varchar(32)`.
   * One query fetches every live code of the school that starts with the
   * base, so the search is a set lookup rather than N round trips.
   */
  private async deriveCode(
    schoolId: string,
    routeCode: string,
    transaction?: Transaction,
  ): Promise<string> {
    const suffixWidth = `-${RUN_CODE_MAX_SUFFIX}`.length;
    const base = routeCode.slice(0, 32 - suffixWidth);
    const taken = await this.runs.findAll({
      where: {
        school_id: schoolId,
        code: { [Op.iLike]: `${escapeLikePattern(base)}%` },
      } as WhereOptions,
      attributes: ['code'],
      ...(transaction ? { transaction } : {}),
    });
    const used = new Set(taken.map((run) => run.code.toLowerCase()));
    const candidates = [routeCode.slice(0, 32)];
    for (let suffix = 2; suffix <= RUN_CODE_MAX_SUFFIX; suffix += 1) {
      candidates.push(`${base}-${suffix}`);
    }
    const free = candidates.find((candidate) => !used.has(candidate.toLowerCase()));
    if (!free) {
      throw new ConflictException(RUN_CODE_UNAVAILABLE_MESSAGE);
    }
    return free;
  }

  /**
   * Builds the search predicate. Runs carry only a code, so the free-text
   * filter also resolves the matching routes inside the tenant and pins the
   * run query to those ids.
   */
  private async buildSearchWhere(
    schoolId: string,
    search: string,
  ): Promise<Array<Record<PropertyKey, unknown>>> {
    const pattern = `%${escapeLikePattern(search)}%`;
    const routes = await this.routes.findAll({
      where: {
        school_id: schoolId,
        [Op.or]: [{ name: { [Op.iLike]: pattern } }, { code: { [Op.iLike]: pattern } }],
      },
      attributes: ['id'],
    });
    const or: Array<Record<PropertyKey, unknown>> = [{ code: { [Op.iLike]: pattern } }];
    const routeIds = routes.map((route) => route.id);
    if (routeIds.length) or.push({ route_id: { [Op.in]: routeIds } });
    return or;
  }

  /**
   * Explicit field-by-field projection — no internal or sensitive field leaks.
   * Route, shift, bus, active crew names and rider counts are resolved with
   * batched lookups so callers get names, never bare ids.
   */
  private async toResponses(runs: Run[], transaction?: Transaction): Promise<RunResponse[]> {
    if (runs.length === 0) {
      return [];
    }
    const options = transaction ? { transaction } : {};
    const schoolId = runs[0].school_id;
    const runIds = runs.map((run) => run.id);
    const routeIds = [...new Set(runs.map((run) => run.route_id))];
    const shiftIds = [...new Set(runs.map((run) => run.shift_id).filter(isId))];
    const busIds = [...new Set(runs.map((run) => run.bus_id).filter(isId))];

    const [routes, shifts, buses, crew, students] = await Promise.all([
      this.routes.findAll({
        where: { school_id: schoolId, id: { [Op.in]: routeIds } },
        attributes: ['id', 'name', 'code'],
        ...options,
      }),
      shiftIds.length
        ? this.shifts.findAll({
            where: { school_id: schoolId, id: { [Op.in]: shiftIds } },
            attributes: ['id', 'name', 'start_time', 'end_time'],
            ...options,
          })
        : Promise.resolve([] as Shift[]),
      busIds.length
        ? this.buses.findAll({
            where: { school_id: schoolId, id: { [Op.in]: busIds } },
            attributes: ['id', 'bus_number', 'registration_number'],
            ...options,
          })
        : Promise.resolve([] as Bus[]),
      this.runCrew.findAll({
        where: { school_id: schoolId, run_id: { [Op.in]: runIds }, is_active: true },
        attributes: ['run_id', 'user_id', 'role', 'effective_from'],
        order: [['effective_from', 'ASC']],
        ...options,
      }),
      this.students.findAll({
        where: { school_id: schoolId, run_id: { [Op.in]: runIds }, is_active: true },
        // Only the allocation key is read; whole student rows are not needed.
        attributes: ['run_id'],
        ...options,
      }),
    ]);

    const userIds = [...new Set(crew.map((row) => row.user_id))];
    const users = userIds.length
      ? await this.users.findAll({
          where: { school_id: schoolId, id: { [Op.in]: userIds } },
          // Display names only — the enrichment never reads other columns.
          attributes: ['id', 'first_name', 'last_name'],
          ...options,
        })
      : [];

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    const busById = new Map(buses.map((bus) => [bus.id, bus]));
    const userById = new Map(users.map((user) => [user.id, user]));

    const crewByRun = new Map<string, RunCrew[]>();
    for (const row of crew) {
      const list = crewByRun.get(row.run_id) ?? [];
      list.push(row);
      crewByRun.set(row.run_id, list);
    }
    const studentCountByRun = new Map<string, number>();
    for (const student of students) {
      if (!student.run_id) continue;
      studentCountByRun.set(student.run_id, (studentCountByRun.get(student.run_id) ?? 0) + 1);
    }

    return runs.map((run) => {
      const route = routeById.get(run.route_id);
      const shift = run.shift_id ? shiftById.get(run.shift_id) : undefined;
      const bus = run.bus_id ? busById.get(run.bus_id) : undefined;
      const roster = crewByRun.get(run.id) ?? [];
      const driverRow = roster.find((row) => row.role === RouteAssignmentRole.DRIVER);
      const conductorRow = roster.find((row) => row.role === RouteAssignmentRole.CONDUCTOR);
      const driver = driverRow ? userById.get(driverRow.user_id) : undefined;
      const conductor = conductorRow ? userById.get(conductorRow.user_id) : undefined;
      return {
        id: run.id,
        school_id: run.school_id,
        route_id: run.route_id,
        shift_id: run.shift_id ?? null,
        bus_id: run.bus_id ?? null,
        code: run.code,
        is_default: run.is_default,
        is_active: run.is_active,
        created_at: run.created_at.toISOString(),
        updated_at: run.updated_at.toISOString(),
        route_name: route?.name ?? null,
        route_code: route?.code ?? null,
        shift_name: shift?.name ?? null,
        shift_start_time: shift ? normalizeTime(shift.start_time) : null,
        shift_end_time: shift ? normalizeTime(shift.end_time) : null,
        bus_number: bus?.bus_number ?? null,
        bus_registration_number: bus?.registration_number ?? null,
        driver_name: driver ? `${driver.first_name} ${driver.last_name}`.trim() : null,
        conductor_name: conductor ? `${conductor.first_name} ${conductor.last_name}`.trim() : null,
        student_count: studentCountByRun.get(run.id) ?? 0,
      };
    });
  }
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
