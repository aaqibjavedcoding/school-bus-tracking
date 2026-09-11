import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  PlanLimitResource,
  StudentDeleteResponse,
  StudentListResponse,
  StudentMinimalListResponse,
  StudentMinimalResponse,
  StudentResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { PlanLimitsService } from '../../common/plan-limits';
import {
  Bus,
  Route,
  RouteAssignment,
  Run,
  Student,
  StudentAttributes,
  StudentGuardian,
  Stop,
} from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import {
  STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE,
  STUDENT_DATE_OF_BIRTH_INVALID_MESSAGE,
  STUDENT_DELETED_MESSAGE,
  STUDENT_HOME_STOP_INVALID_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
  STUDENT_RUN_INVALID_MESSAGE,
  STUDENT_RUN_INACTIVE_MESSAGE,
  STUDENT_RUN_ROUTE_MISMATCH_MESSAGE,
} from './students.constants';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

/**
 * Tenant-safe student management.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Student not found` as a missing record — the
 * existence of another school's student is never revealed.
 *
 * Parent/guardian linkage is managed by the dedicated ParentsModule and its
 * tenant-pinned `student_guardians` service. Student CRUD remains focused on
 * the student record itself, so parent references cannot change a student's
 * ownership or bypass the relationship service's cross-tenant checks.
 */
export class StudentsService {
  constructor(
    private readonly students: typeof Student,
    private readonly stops: typeof Stop,
    private readonly guardians: typeof StudentGuardian,
    private readonly routes: typeof Route,
    private readonly assignments: typeof RouteAssignment,
    private readonly buses: typeof Bus,
    private readonly planLimits: PlanLimitsService,
    private readonly runs: typeof Run,
  ) {}

  /**
   * Creates a student inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input, and every referenced home stop is verified to belong to the same
   * school before the row is written.
   */
  async create(schoolId: string, dto: CreateStudentDto): Promise<StudentResponse> {
    return this.planLimits.runWithinLimit(
      schoolId,
      PlanLimitResource.STUDENTS,
      async (transaction) => {
        const homeStopId = dto.home_stop_id ?? null;
        if (homeStopId) {
          await this.assertHomeStopInSchool(schoolId, homeStopId);
        }
        const runId = dto.run_id ?? null;
        if (runId) {
          await this.assertRunAllocation(schoolId, runId, homeStopId, {
            requireActive: true,
          });
        }

        try {
          const student = await this.students.create(
            {
              school_id: schoolId,
              admission_number: dto.admission_number.trim(),
              first_name: dto.first_name.trim(),
              last_name: dto.last_name.trim(),
              home_stop_id: homeStopId,
              run_id: runId,
              date_of_birth: this.toDate(dto.date_of_birth),
              gender: dto.gender ?? null,
              grade_level: nullableTrim(dto.grade_level),
              emergency_contact_name: nullableTrim(dto.emergency_contact_name),
              emergency_contact_phone: nullableTrim(dto.emergency_contact_phone),
              medical_notes: nullableTrim(dto.medical_notes),
              is_active: dto.is_active ?? true,
            },
            transaction ? { transaction } : {},
          );
          return this.toStudentResponse(student);
        } catch (error) {
          if (error instanceof UniqueConstraintError) {
            throw new ConflictException(STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE);
          }
          throw error;
        }
      },
    );
  }

  /**
   * Roster size of the authenticated school.
   *
   * One `COUNT(*)` query, no enrichment — the dashboard stats endpoint uses
   * it so the stat cards never pay for projections they do not render.
   */
  async count(schoolId: string): Promise<number> {
    return this.students.count({ where: { school_id: schoolId } as WhereOptions });
  }

  /**
   * Lists students of the authenticated school only, with pagination and an
   * optional case-insensitive name search. No other tenant's rows can match
   * because `school_id` is always part of the where clause.
   *
   * `include: 'minimal'` skips `toStudentResponses` entirely and returns the
   * raw student fields — zero stop/route/bus enrichment queries, the shape
   * pickers and rosters need. The overloads keep the return type honest for
   * both shapes.
   */
  async findAll(
    schoolId: string,
    query: ListStudentsQueryDto & { include: 'minimal' },
  ): Promise<StudentMinimalListResponse>;
  async findAll(schoolId: string, query: ListStudentsQueryDto): Promise<StudentListResponse>;
  async findAll(
    schoolId: string,
    query: ListStudentsQueryDto,
  ): Promise<StudentListResponse | StudentMinimalListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    if (query.run_id !== undefined) where.run_id = query.run_id;
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { first_name: { [Op.iLike]: pattern } },
        { last_name: { [Op.iLike]: pattern } },
        { admission_number: { [Op.iLike]: pattern } },
        { grade_level: { [Op.iLike]: pattern } },
      ];
    }

    const { rows, count } = await this.students.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
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

    if (query.include === 'minimal') {
      return {
        items: rows.map((student) => toStudentMinimalResponse(student)),
        meta,
      };
    }

    return {
      items: await this.toStudentResponses(rows),
      meta,
    };
  }

  /**
   * Returns one student only when both the id and the authenticated school_id
   * match. Anything else is a generic 404.
   */
  async findOne(schoolId: string, id: string): Promise<StudentResponse> {
    const student = await this.findStudentOrThrow(schoolId, id);
    return this.toStudentResponse(student);
  }

  /**
   * Visibility-checked student lookup. School admins may read any student of
   * their school; a parent may read only a child they are actively linked to.
   * Every other combination is the same generic 404.
   */
  async findOneForActor(actor: AuthenticatedRequestUser, id: string): Promise<StudentResponse> {
    const student = await this.findStudentOrThrow(actor.school_id, id);
    if (actor.role === UserRole.PARENT) {
      const link = await this.guardians.findOne({
        where: {
          school_id: actor.school_id,
          user_id: actor.id,
          student_id: id,
          is_active: true,
        },
      });
      if (!link) {
        throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
      }
    }
    return this.toStudentResponse(student);
  }

  /**
   * Partial update of a student that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written by this method. Explicit `null` clears a
   * nullable field.
   */
  async update(schoolId: string, id: string, dto: UpdateStudentDto): Promise<StudentResponse> {
    const student = await this.findStudentOrThrow(schoolId, id);

    const updates: Partial<StudentAttributes> = {};
    if (dto.admission_number !== undefined) {
      updates.admission_number = dto.admission_number.trim();
    }
    if (dto.first_name !== undefined) {
      updates.first_name = dto.first_name.trim();
    }
    if (dto.last_name !== undefined) {
      updates.last_name = dto.last_name.trim();
    }
    if (dto.date_of_birth !== undefined) {
      updates.date_of_birth = this.toDate(dto.date_of_birth);
    }
    if (dto.gender !== undefined) {
      updates.gender = dto.gender ?? null;
    }
    if (dto.grade_level !== undefined) {
      updates.grade_level = nullableTrim(dto.grade_level);
    }
    if (dto.home_stop_id !== undefined) {
      if (dto.home_stop_id !== null) {
        await this.assertHomeStopInSchool(schoolId, dto.home_stop_id);
      }
      updates.home_stop_id = dto.home_stop_id;
    }
    if (dto.run_id !== undefined) {
      if (dto.run_id !== null) {
        // Cross-check the *final* pair: a stop change alone can also break
        // the invariant, so re-validate whenever either side moves.
        const finalStopId =
          dto.home_stop_id !== undefined ? dto.home_stop_id : student.home_stop_id;
        await this.assertRunAllocation(schoolId, dto.run_id, finalStopId, {
          requireActive: true,
        });
      }
      updates.run_id = dto.run_id;
    } else if (dto.home_stop_id !== undefined && student.run_id) {
      const finalStopId = dto.home_stop_id;
      if (finalStopId !== null) {
        await this.assertRunAllocation(schoolId, student.run_id, finalStopId, {
          requireActive: false,
        });
      }
    }
    if (dto.emergency_contact_name !== undefined) {
      updates.emergency_contact_name = nullableTrim(dto.emergency_contact_name);
    }
    if (dto.emergency_contact_phone !== undefined) {
      updates.emergency_contact_phone = nullableTrim(dto.emergency_contact_phone);
    }
    if (dto.medical_notes !== undefined) {
      updates.medical_notes = nullableTrim(dto.medical_notes);
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await student.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toStudentResponse(student);
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a student of the
   * authenticated school. Records are never physically removed.
   */
  async remove(schoolId: string, id: string): Promise<StudentDeleteResponse> {
    const student = await this.findStudentOrThrow(schoolId, id);
    await student.destroy();
    return { id, message: STUDENT_DELETED_MESSAGE };
  }
  private async findStudentOrThrow(schoolId: string, id: string): Promise<Student> {
    const student = await this.students.findOne({
      where: { id, school_id: schoolId },
    });
    if (!student) {
      throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
    }
    return student;
  }

  /**
   * Rejects any referenced stop that does not belong to the authenticated
   * school — a cross-tenant stop id is indistinguishable from a nonexistent
   * one, and ownership is never taken from client-supplied values.
   */
  private async assertHomeStopInSchool(schoolId: string, stopId: string): Promise<void> {
    const stop = await this.stops.findOne({
      where: { id: stopId, school_id: schoolId },
    });
    if (!stop) {
      throw new BadRequestException(STUDENT_HOME_STOP_INVALID_MESSAGE);
    }
  }

  /**
   * Validates a (run, home stop) allocation (`docs/operating-model.md` §3.4).
   *
   * The run must live in the caller's tenant — a cross-tenant or deleted run
   * is the same generic 400 as a missing one. When the pupil already has a
   * home stop, the run's route must be the stop's route: "which vehicle" may
   * never contradict "where I board". `requireActive` guards fresh allocations
   * only; re-checking an unchanged legacy allocation must not fail on a run
   * that was deactivated after the fact.
   */
  private async assertRunAllocation(
    schoolId: string,
    runId: string,
    homeStopId: string | null,
    options: { requireActive: boolean },
  ): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId, school_id: schoolId } });
    if (!run) {
      throw new BadRequestException(STUDENT_RUN_INVALID_MESSAGE);
    }
    if (options.requireActive && run.is_active === false) {
      throw new BadRequestException(STUDENT_RUN_INACTIVE_MESSAGE);
    }
    if (!homeStopId) {
      return;
    }
    const stop = await this.stops.findOne({
      where: { id: homeStopId, school_id: schoolId },
      attributes: ['id', 'route_id'],
    });
    if (!stop) {
      throw new BadRequestException(STUDENT_HOME_STOP_INVALID_MESSAGE);
    }
    if (stop.route_id !== run.route_id) {
      throw new BadRequestException(STUDENT_RUN_ROUTE_MISMATCH_MESSAGE);
    }
  }

  /** Converts `YYYY-MM-DD` to a UTC Date; rejects invalid calendar dates. */
  private toDate(value: string | null | undefined): Date | null {
    if (value == null) {
      return null;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(STUDENT_DATE_OF_BIRTH_INVALID_MESSAGE);
    }
    return date;
  }

  /**
   * Explicit field-by-field projection — no internal or sensitive field leaks.
   * The home stop label, route and rostered bus are resolved with batched
   * lookups so callers get names, never bare ids.
   */
  private async toStudentResponse(student: Student): Promise<StudentResponse> {
    const [response] = await this.toStudentResponses([student]);
    return response;
  }

  /** Batched projection of students with their home stop / route / bus. */
  private async toStudentResponses(students: Student[]): Promise<StudentResponse[]> {
    if (students.length === 0) {
      return [];
    }
    const schoolId = students[0].school_id;
    const stopIds = [...new Set(students.map((s) => s.home_stop_id).filter(isId))];

    const stops = stopIds.length
      ? await this.stops.findAll({
          where: { school_id: schoolId, id: { [Op.in]: stopIds } },
          // Only the stop → route link and the label are projected below.
          attributes: ['id', 'route_id', 'name'],
        })
      : [];
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));

    const routeIds = [...new Set(stops.map((stop) => stop.route_id))];
    // Runs allocated to pupils are resolved in the same batch: the run
    // supplies the run code and the *actual* vehicle (the run's bus beats the
    // legacy route-assignment bus). Soft-deleted runs resolve to `null` — the
    // row keeps the id but the display falls back to the route view.
    const runIds = [...new Set(students.map((s) => s.run_id).filter(isId))];
    const [routes, assignments, runs] = await Promise.all([
      routeIds.length
        ? this.routes.findAll({
            where: { school_id: schoolId, id: { [Op.in]: routeIds } },
            attributes: ['id', 'name', 'code'],
          })
        : Promise.resolve([] as Route[]),
      routeIds.length
        ? this.assignments.findAll({
            where: { school_id: schoolId, route_id: { [Op.in]: routeIds }, is_active: true },
            order: [['effective_from', 'ASC']],
          })
        : Promise.resolve([] as RouteAssignment[]),
      runIds.length
        ? this.runs.findAll({
            where: { school_id: schoolId, id: { [Op.in]: runIds } },
            attributes: ['id', 'route_id', 'code', 'bus_id'],
          })
        : Promise.resolve([] as Run[]),
    ]);
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const runById = new Map(runs.map((run) => [run.id, run]));

    const busIds = [
      ...new Set(
        [
          ...assignments.map((assignment) => assignment.bus_id),
          ...runs.map((run) => run.bus_id),
        ].filter(isId),
      ),
    ];
    const buses = busIds.length
      ? await this.buses.findAll({
          where: { school_id: schoolId, id: { [Op.in]: busIds } },
          attributes: ['id', 'bus_number'],
        })
      : [];
    const busById = new Map(buses.map((bus) => [bus.id, bus]));
    const busByRoute = new Map<string, Bus>();
    for (const assignment of assignments) {
      if (assignment.bus_id && !busByRoute.has(assignment.route_id)) {
        const bus = busById.get(assignment.bus_id);
        if (bus) busByRoute.set(assignment.route_id, bus);
      }
    }

    return students.map((student) => {
      const stop = student.home_stop_id ? stopById.get(student.home_stop_id) : undefined;
      const route = stop ? routeById.get(stop.route_id) : undefined;
      const run = student.run_id ? runById.get(student.run_id) : undefined;
      const runBus = run?.bus_id ? busById.get(run.bus_id) : undefined;
      const bus = runBus ?? (route ? busByRoute.get(route.id) : undefined);
      return {
        id: student.id,
        school_id: student.school_id,
        admission_number: student.admission_number,
        first_name: student.first_name,
        last_name: student.last_name,
        date_of_birth: formatDateOnly(student.date_of_birth),
        gender: student.gender,
        grade_level: student.grade_level,
        home_stop_id: student.home_stop_id,
        run_id: student.run_id,
        emergency_contact_name: student.emergency_contact_name,
        emergency_contact_phone: student.emergency_contact_phone,
        medical_notes: student.medical_notes,
        is_active: student.is_active,
        created_at: student.created_at.toISOString(),
        updated_at: student.updated_at.toISOString(),
        home_stop_name: stop?.name ?? null,
        route_id: route?.id ?? null,
        route_name: route?.name ?? null,
        route_code: route?.code ?? null,
        run_code: run?.code ?? null,
        bus_number: bus?.bus_number ?? null,
      };
    });
  }
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * `include=minimal` projection of a student — the raw row fields only. Pure
 * and synchronous by design: any query here would defeat the point of the
 * mode.
 */
function toStudentMinimalResponse(student: Student): StudentMinimalResponse {
  return {
    id: student.id,
    school_id: student.school_id,
    admission_number: student.admission_number,
    first_name: student.first_name,
    last_name: student.last_name,
    grade_level: student.grade_level,
    home_stop_id: student.home_stop_id,
    run_id: student.run_id,
    is_active: student.is_active,
  };
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDateOnly(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
