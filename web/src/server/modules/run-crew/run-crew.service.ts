import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, QueryTypes, Transaction, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  PaginationMeta,
  RouteAssignmentRole,
  RunCrewDeleteResponse,
  RunCrewListResponse,
  RunCrewResponse,
  RunCrewRole,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Route, RouteAssignment, Run, RunCrew, Shift, User } from '../../database/models';
import { findRunCrewConflict, type RunCrewCandidate } from '../runs/run-conflicts';
import { normalizeTime } from '../shifts/shifts.service';
import {
  RUN_CREW_DATE_INVALID_MESSAGE,
  RUN_CREW_DATE_RANGE_MESSAGE,
  RUN_CREW_DELETED_MESSAGE,
  RUN_CREW_DUPLICATE_MESSAGE,
  RUN_CREW_INACTIVE_RESOURCE_MESSAGE,
  RUN_CREW_NOT_FOUND_MESSAGE,
  RUN_CREW_ROLE_CONFLICT_MESSAGE,
  RUN_CREW_ROLE_INVALID_MESSAGE,
  RUN_CREW_ROLE_MISMATCH_MESSAGE,
  RUN_CREW_USER_INVALID_MESSAGE,
} from './run-crew.constants';
import { RUN_NOT_FOUND_MESSAGE } from '../runs/runs.constants';
import { CreateRunCrewDto } from './dto/create-run-crew.dto';
import { ListRunCrewQueryDto } from './dto/list-run-crew-query.dto';
import { UpdateRunCrewDto } from './dto/update-run-crew.dto';

/**
 * Tenant-safe per-run roster management — `docs/operating-model.md` §3.3
 * and §8.3.
 *
 * `run_crew` stores one row per person and role, so a run with a driver and a
 * conductor has two rows sharing the run and (usually) the effective period.
 * Every related-resource lookup is pinned to the JWT-derived school id.
 *
 * ## Conflict rules (Session 2B, §4)
 *
 * The rules live in the pure `run-conflicts` module and are enforced before
 * every write:
 *
 * - `RUN_ROLE` — one run, one role, overlapping roster windows;
 * - `CREW_RUN` — one person cannot be rostered on two runs whose **shift
 *   windows** overlap. Tiering falls out for free: the same driver covering
 *   the 07:00 and the 13:00 runs on one day is legal, and a `NULL`-shift
 *   (legacy default) run occupies the whole day so it conflicts with
 *   everything.
 *
 * The check is a check-then-act pair, so it runs inside one transaction that
 * holds a PostgreSQL transaction-scoped advisory lock keyed by school —
 * concurrent roster writes of the same tenant are serialised, exactly like
 * the plan-limit reservation does for quotas (§4.4.2).
 *
 * ## Dual write (§6.3)
 *
 * `run_crew` is **authoritative**. During the migration period every
 * create/update/soft-delete mirrors the row onto `route_assignments`
 * (linked through `route_assignments.run_crew_id`) so legacy reads and
 * reports keep working; the mirror is best-effort — when a route-level row
 * already holds the natural key (e.g. two runs of one route roster the same
 * person in the same role from the same date), the existing row is adopted or
 * the write is skipped rather than failing the authoritative insert.
 */
export class RunCrewService {
  constructor(
    private readonly runCrew: typeof RunCrew,
    private readonly runs: typeof Run,
    private readonly routes: typeof Route,
    private readonly users: typeof User,
    private readonly shifts: typeof Shift,
    private readonly routeAssignments: typeof RouteAssignment,
    private readonly sequelize?: Sequelize | null,
  ) {}

  /** `POST /api/v1/runs/:id/crew` — rosters one DRIVER or CONDUCTOR onto a run. */
  async create(schoolId: string, runId: string, dto: CreateRunCrewDto): Promise<RunCrewResponse> {
    return this.runSerialized(schoolId, async (transaction) => {
      const options = transaction ? { transaction } : {};
      const run = await this.runs.findOne({
        where: { id: runId, school_id: schoolId },
        ...options,
      });
      if (!run) {
        throw new NotFoundException(RUN_NOT_FOUND_MESSAGE);
      }
      const values = this.normalizedCreateValues(run.id, dto);
      await this.assertRelatedResources(schoolId, run, values.user_id, values.role, values.is_active, options);
      await this.assertNoConflicts(schoolId, run, values, undefined, options);

      try {
        const row = await this.runCrew.create(
          {
            school_id: schoolId,
            run_id: values.run_id,
            user_id: values.user_id,
            role: values.role as unknown as RouteAssignmentRole,
            effective_from: values.effective_from,
            effective_to: values.effective_to,
            is_active: values.is_active,
          },
          options,
        );
        await this.mirrorToRouteAssignments(schoolId, row, run, transaction);
        return this.toResponse(row);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new ConflictException(RUN_CREW_DUPLICATE_MESSAGE);
        }
        throw error;
      }
    });
  }

  /** `GET /api/v1/runs/:id/crew` — the roster of one run; 404 unless the run is in the tenant. */
  async findAllForRun(
    schoolId: string,
    runId: string,
    query: ListRunCrewQueryDto,
  ): Promise<RunCrewListResponse> {
    const run = await this.runs.findOne({ where: { id: runId, school_id: schoolId } });
    if (!run) {
      throw new NotFoundException(RUN_NOT_FOUND_MESSAGE);
    }
    return this.findAll(schoolId, { run_id: runId }, query);
  }

  /**
   * `GET /api/v1/users/:id/run-crew` — "this driver's roster": every run the
   * person is rostered on. 404 unless the user is a staff member of the
   * tenant (a parent or admin id is not disclosed as existing either way).
   */
  async findAllForUser(
    schoolId: string,
    userId: string,
    query: ListRunCrewQueryDto,
  ): Promise<RunCrewListResponse> {
    const user = await this.users.findOne({
      where: {
        id: userId,
        school_id: schoolId,
        role: { [Op.in]: [UserRole.DRIVER, UserRole.CONDUCTOR] },
      } as WhereOptions,
    });
    if (!user) {
      throw new NotFoundException(RUN_CREW_USER_INVALID_MESSAGE);
    }
    return this.findAll(schoolId, { user_id: userId }, query);
  }

  /** Returns a roster row only when its id and school both match. */
  async findOne(schoolId: string, id: string): Promise<RunCrewResponse> {
    const row = await this.findRowOrThrow(schoolId, id);
    return this.toResponse(row);
  }

  /**
   * `PATCH /api/v1/run-crew/:id`
   *
   * Person, role, period and active flag may change; the run may not. The
   * resulting user/role pair, `RUN_ROLE` and `CREW_RUN` are validated again
   * against the merged values before the update and its mirror are written.
   */
  async update(schoolId: string, id: string, dto: UpdateRunCrewDto): Promise<RunCrewResponse> {
    return this.runSerialized(schoolId, async (transaction) => {
      const options = transaction ? { transaction } : {};
      const row = await this.findRowOrThrow(schoolId, id, transaction);
      const run = await this.runs.findOne({
        where: { id: row.run_id, school_id: schoolId },
        ...options,
      });
      if (!run) {
        // The run was soft-deleted underneath its roster; nothing to roster onto.
        throw new NotFoundException(RUN_NOT_FOUND_MESSAGE);
      }
      const values = this.normalizedUpdateValues(row, dto);
      await this.assertRelatedResources(schoolId, run, values.user_id, values.role, values.is_active, options);
      await this.assertNoConflicts(schoolId, run, values, id, options);

      try {
        await row.update(
          {
            user_id: values.user_id,
            role: values.role as unknown as RouteAssignmentRole,
            effective_from: values.effective_from,
            effective_to: values.effective_to,
            is_active: values.is_active,
          },
          options,
        );
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new ConflictException(RUN_CREW_DUPLICATE_MESSAGE);
        }
        throw error;
      }

      await this.mirrorToRouteAssignments(schoolId, row, run, transaction);
      return this.toResponse(row);
    });
  }

  /** Soft-deletes a roster row while retaining history and its mirror. */
  async remove(schoolId: string, id: string): Promise<RunCrewDeleteResponse> {
    return this.runSerialized(schoolId, async (transaction) => {
      const row = await this.findRowOrThrow(schoolId, id, transaction);
      await row.destroy(transaction ? { transaction } : {});
      await this.softDeleteMirror(schoolId, row.id, transaction);
      return { id, message: RUN_CREW_DELETED_MESSAGE };
    });
  }

  /**
   * Runs `work` under a transaction-scoped advisory lock keyed by school so
   * the conflict check and the write are atomic with respect to concurrent
   * roster mutations of the same tenant. Without a live Sequelize (unit test
   * bootstraps) the write degrades to the plain check-then-act.
   */
  private async runSerialized<T>(
    schoolId: string,
    work: (transaction?: Transaction) => Promise<T>,
  ): Promise<T> {
    if (!this.sequelize) {
      return work();
    }
    return this.sequelize.transaction(async (transaction) => {
      await this.sequelize!.query('SELECT pg_advisory_xact_lock(hashtextextended($key, 0))', {
        bind: { key: `run-conflict:${schoolId}` },
        type: QueryTypes.SELECT,
        transaction,
      });
      return work(transaction);
    });
  }

  private async findAll(
    schoolId: string,
    pin: { run_id?: string; user_id?: string },
    query: ListRunCrewQueryDto,
  ): Promise<RunCrewListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = { school_id: schoolId, ...pin };
    if (query.role !== undefined) where.role = query.role;
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const { rows, count } = await this.runCrew.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['effective_from', 'DESC'],
        ['run_id', 'ASC'],
        ['role', 'ASC'],
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

  private async findRowOrThrow(
    schoolId: string,
    id: string,
    transaction?: Transaction,
  ): Promise<RunCrew> {
    const row = await this.runCrew.findOne({
      where: { id, school_id: schoolId },
      ...(transaction ? { transaction } : {}),
    });
    if (!row) {
      throw new NotFoundException(RUN_CREW_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Validates the person against the authenticated tenant and the requested
   * role. A user from another school produces the same generic 400 as a
   * missing one, so their existence is not disclosed.
   */
  private async assertRelatedResources(
    schoolId: string,
    run: Run,
    userId: string,
    role: RunCrewRole,
    isActive: boolean,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    if (!isRunCrewRole(role)) {
      throw new BadRequestException(RUN_CREW_ROLE_INVALID_MESSAGE);
    }
    const user = await this.users.findOne({
      where: { id: userId, school_id: schoolId },
      ...options,
    });
    if (!user) {
      throw new BadRequestException(RUN_CREW_USER_INVALID_MESSAGE);
    }
    if (String(user.role) !== role) {
      throw new BadRequestException(RUN_CREW_ROLE_MISMATCH_MESSAGE);
    }
    if (isActive && (run.is_active === false || user.is_active === false)) {
      throw new BadRequestException(RUN_CREW_INACTIVE_RESOURCE_MESSAGE);
    }
  }

  /**
   * Enforces the §4.2 crew rules against every other active roster row of the
   * same run (→ `RUN_ROLE`) or the same person (→ `CREW_RUN`). The shift
   * windows of all involved runs are resolved in batched queries so the pure
   * engine sees the runs' clocks, with a `NULL` shift meaning whole day.
   */
  private async assertNoConflicts(
    schoolId: string,
    run: Run,
    values: CrewValues,
    excludeId: string | undefined,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    if (!values.is_active) {
      return;
    }
    const others = await this.runCrew.findAll({
      where: {
        school_id: schoolId,
        is_active: true,
        [Op.or]: [{ run_id: values.run_id }, { user_id: values.user_id }],
      } as WhereOptions,
      ...options,
    });
    if (others.length === 0) {
      return;
    }

    const runIds = [...new Set([run.id, ...others.map((row) => row.run_id)])];
    const runs = await this.runs.findAll({
      where: { school_id: schoolId, id: { [Op.in]: runIds } },
      attributes: ['id', 'shift_id'],
      ...options,
    });
    const shiftIds = [...new Set(runs.map((row) => row.shift_id).filter(isId))];
    const shifts = shiftIds.length
      ? await this.shifts.findAll({
          where: { school_id: schoolId, id: { [Op.in]: shiftIds } },
          attributes: ['id', 'start_time', 'end_time'],
          ...options,
        })
      : [];
    const runById = new Map(runs.map((row) => [row.id, row]));
    const shiftById = new Map(shifts.map((row) => [row.id, row]));
    const windowOf = (runId: string): { start_time: string; end_time: string } | null => {
      const owner = runById.get(runId);
      const shift = owner?.shift_id ? shiftById.get(owner.shift_id) : undefined;
      return shift
        ? {
            start_time: normalizeTime(shift.start_time),
            end_time: normalizeTime(shift.end_time),
          }
        : null;
    };

    const candidate: RunCrewCandidate = {
      id: excludeId ?? 'pending',
      run_id: values.run_id,
      user_id: values.user_id,
      role: values.role,
      effective_from: values.effective_from,
      effective_to: values.effective_to,
      is_active: values.is_active,
      shift: windowOf(values.run_id),
    };

    for (const other of others) {
      if (excludeId && other.id === excludeId) {
        continue;
      }
      const conflict = findRunCrewConflict(candidate, {
        id: other.id,
        run_id: other.run_id,
        user_id: other.user_id,
        role: other.role as unknown as RunCrewRole,
        effective_from: normalizeDateOnly(other.effective_from),
        effective_to: normalizeNullableDateOnly(other.effective_to),
        is_active: other.is_active,
        shift: windowOf(other.run_id),
      });
      if (conflict) {
        throw new ConflictException(conflict.message);
      }
    }
  }

  /**
   * §6.3 dual write: keeps the `route_assignments` mirror of an
   * authoritative `run_crew` row in step. The mirror is located through
   * `route_assignments.run_crew_id`; a legacy unlinked row holding the same
   * natural key is adopted. When the route-level table cannot represent the
   * run-level fact (the natural key is already owned by another live row),
   * the mirror is skipped rather than failing the authoritative write.
   */
  private async mirrorToRouteAssignments(
    schoolId: string,
    row: RunCrew,
    run: Run,
    transaction?: Transaction,
  ): Promise<void> {
    const options = transaction ? { transaction } : {};
    const values = {
      school_id: schoolId,
      route_id: run.route_id,
      bus_id: run.bus_id ?? null,
      user_id: row.user_id,
      role: row.role,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      is_active: row.is_active,
    };

    const existing = await this.routeAssignments.findOne({
      where: { school_id: schoolId, run_crew_id: row.id },
      paranoid: false,
      ...options,
    });
    if (existing) {
      try {
        if (existing.deleted_at) {
          await existing.restore(options);
        }
        await existing.update(values, options);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          return;
        }
        throw error;
      }
      return;
    }

    const orphan = await this.routeAssignments.findOne({
      where: {
        school_id: schoolId,
        route_id: run.route_id,
        user_id: row.user_id,
        role: row.role,
        effective_from: row.effective_from,
        run_crew_id: null,
      },
      paranoid: false,
      ...options,
    });
    if (orphan) {
      try {
        if (orphan.deleted_at) {
          await orphan.restore(options);
        }
        await orphan.update({ ...values, run_crew_id: row.id }, options);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          return;
        }
        throw error;
      }
      return;
    }

    try {
      await this.routeAssignments.create({ ...values, run_crew_id: row.id }, options);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        return;
      }
      throw error;
    }
  }

  /** Soft-deletes the mirror of a removed roster row (kept for history). */
  private async softDeleteMirror(
    schoolId: string,
    crewId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const options = transaction ? { transaction } : {};
    const mirror = await this.routeAssignments.findOne({
      where: { school_id: schoolId, run_crew_id: crewId },
      paranoid: false,
      ...options,
    });
    if (mirror && !mirror.deleted_at) {
      await mirror.destroy(options);
    }
  }

  private normalizedCreateValues(runId: string, dto: CreateRunCrewDto): CrewValues {
    if (!isRunCrewRole(dto.role)) {
      throw new BadRequestException(RUN_CREW_ROLE_INVALID_MESSAGE);
    }
    if (!dto.user_id) {
      throw new BadRequestException('user_id is required');
    }
    const effectiveFrom = normalizeDateOnly(dto.effective_from);
    const effectiveTo = normalizeNullableDateOnly(dto.effective_to);
    assertDateRange(effectiveFrom, effectiveTo);
    return {
      run_id: runId,
      user_id: dto.user_id,
      role: dto.role,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      is_active: dto.is_active ?? true,
    };
  }

  private normalizedUpdateValues(row: RunCrew, dto: UpdateRunCrewDto): CrewValues {
    const role = (dto.role ?? row.role) as RunCrewRole;
    if (!isRunCrewRole(role)) {
      throw new BadRequestException(RUN_CREW_ROLE_INVALID_MESSAGE);
    }
    const effectiveFrom = normalizeDateOnly(dto.effective_from ?? row.effective_from);
    const effectiveTo =
      dto.effective_to === undefined
        ? normalizeNullableDateOnly(row.effective_to)
        : normalizeNullableDateOnly(dto.effective_to);
    assertDateRange(effectiveFrom, effectiveTo);
    return {
      run_id: row.run_id,
      user_id: dto.user_id ?? row.user_id,
      role,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      is_active: dto.is_active ?? row.is_active,
    };
  }

  private async toResponse(row: RunCrew): Promise<RunCrewResponse> {
    const [response] = await this.toResponses([row]);
    return response;
  }

  /**
   * Explicit projection — ORM internals and associations never leak. Run
   * code, route and person names are resolved with batched lookups so callers
   * get human-readable values, never bare ids.
   */
  private async toResponses(rows: RunCrew[]): Promise<RunCrewResponse[]> {
    if (rows.length === 0) {
      return [];
    }
    const schoolId = rows[0].school_id;
    const runIds = [...new Set(rows.map((row) => row.run_id))];
    const userIds = [...new Set(rows.map((row) => row.user_id))];

    const [runs, users] = await Promise.all([
      this.runs.findAll({
        where: { school_id: schoolId, id: { [Op.in]: runIds } },
        attributes: ['id', 'code', 'route_id'],
        // A roster row may outlive its (soft-deleted) run; the code is still
        // worth showing on a historical entry.
        paranoid: false,
      }),
      this.users.findAll({
        where: { school_id: schoolId, id: { [Op.in]: userIds } },
        attributes: ['id', 'first_name', 'last_name', 'email'],
      }),
    ]);
    const routeIds = [...new Set(runs.map((run) => run.route_id))];
    const routes = routeIds.length
      ? await this.routes.findAll({
          where: { school_id: schoolId, id: { [Op.in]: routeIds } },
          attributes: ['id', 'name', 'code'],
          paranoid: false,
        })
      : [];

    const runById = new Map(runs.map((run) => [run.id, run]));
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return rows.map((row) => {
      const run = runById.get(row.run_id);
      const route = run ? routeById.get(run.route_id) : undefined;
      const user = userById.get(row.user_id);
      return {
        id: row.id,
        school_id: row.school_id,
        run_id: row.run_id,
        user_id: row.user_id,
        role: row.role as unknown as RunCrewRole,
        effective_from: normalizeDateOnly(row.effective_from),
        effective_to: normalizeNullableDateOnly(row.effective_to),
        is_active: row.is_active,
        created_at: toIsoString(row.created_at),
        updated_at: toIsoString(row.updated_at),
        run_code: run?.code ?? null,
        route_id: run?.route_id ?? null,
        route_name: route?.name ?? null,
        route_code: route?.code ?? null,
        user_name: user ? `${user.first_name} ${user.last_name}`.trim() : null,
        user_email: user?.email ?? null,
      };
    });
  }
}

interface CrewValues {
  run_id: string;
  user_id: string;
  role: RunCrewRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

function isRunCrewRole(value: unknown): value is RunCrewRole {
  return value === RunCrewRole.DRIVER || value === RunCrewRole.CONDUCTOR;
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeDateOnly(value: string | Date | null | undefined): string {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new BadRequestException(RUN_CREW_DATE_INVALID_MESSAGE);
  }
  const candidate = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new BadRequestException(RUN_CREW_DATE_INVALID_MESSAGE);
  }
  const [year, month, day] = candidate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(RUN_CREW_DATE_INVALID_MESSAGE);
  }
  return candidate;
}

function normalizeNullableDateOnly(value: string | Date | null | undefined): string | null {
  return value == null ? null : normalizeDateOnly(value);
}

function assertDateRange(effectiveFrom: string, effectiveTo: string | null): void {
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new BadRequestException(RUN_CREW_DATE_RANGE_MESSAGE);
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
