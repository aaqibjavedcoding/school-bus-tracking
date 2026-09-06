import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  ShiftDeleteResponse,
  ShiftListResponse,
  ShiftResponse,
} from '@school-bus-tracking/shared-types';
import { Run, Shift, ShiftAttributes } from '../../database/models';
import {
  SHIFT_DELETED_MESSAGE,
  SHIFT_HAS_RUNS_MESSAGE,
  SHIFT_NAME_TAKEN_MESSAGE,
  SHIFT_NOT_FOUND_MESSAGE,
  SHIFT_WINDOW_INVALID_MESSAGE,
} from './shifts.constants';
import { CreateShiftDto } from './dto/create-shift.dto';
import { ListShiftsQueryDto } from './dto/list-shifts-query.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

/**
 * Tenant-safe bell-window (shift) management — `docs/operating-model.md` §3.1.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Shift not found` as a missing record.
 *
 * Shifts are reference data: there is no plan limit on them, and a shift is
 * never deleted while a live run still points at it (§8.1).
 */
export class ShiftsService {
  constructor(
    private readonly shifts: typeof Shift,
    private readonly runs: typeof Run,
  ) {}

  /**
   * Creates a shift inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input. The name is unique per tenant among live shifts (soft-deleted rows
   * release their name), and the window must have positive length.
   */
  async create(schoolId: string, dto: CreateShiftDto): Promise<ShiftResponse> {
    const name = dto.name.trim();
    const startTime = normalizeTime(dto.start_time);
    const endTime = normalizeTime(dto.end_time);
    assertWindow(startTime, endTime);
    await this.assertNameFree(schoolId, name);

    try {
      const shift = await this.shifts.create({
        school_id: schoolId,
        name,
        start_time: startTime,
        end_time: endTime,
        is_active: dto.is_active ?? true,
      });
      const [response] = await this.toResponses([shift]);
      return response;
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(SHIFT_NAME_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Lists shifts of the authenticated school only, ordered by window start,
   * with pagination and optional name search / active filter.
   */
  async findAll(schoolId: string, query: ListShiftsQueryDto): Promise<ShiftListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }
    const search = query.search?.trim();
    if (search) {
      where.name = { [Op.iLike]: `%${escapeLikePattern(search)}%` };
    }

    const { rows, count } = await this.shifts.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['start_time', 'ASC'],
        ['end_time', 'ASC'],
        ['name', 'ASC'],
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

  /** Returns one shift only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<ShiftResponse> {
    const shift = await this.findShiftOrThrow(schoolId, id);
    const [response] = await this.toResponses([shift]);
    return response;
  }

  /**
   * Partial update of a shift that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written here. The window rule is re-checked against
   * the merged (stored + patched) times, so shrinking one end past the other
   * is rejected even when only one field is sent.
   */
  async update(schoolId: string, id: string, dto: UpdateShiftDto): Promise<ShiftResponse> {
    const shift = await this.findShiftOrThrow(schoolId, id);
    const updates: Partial<ShiftAttributes> = {};

    if (dto.name !== undefined) {
      updates.name = dto.name.trim();
      await this.assertNameFree(schoolId, updates.name, id);
    }
    if (dto.start_time !== undefined) {
      updates.start_time = normalizeTime(dto.start_time);
    }
    if (dto.end_time !== undefined) {
      updates.end_time = normalizeTime(dto.end_time);
    }
    if (dto.start_time !== undefined || dto.end_time !== undefined) {
      assertWindow(
        updates.start_time ?? normalizeTime(shift.start_time),
        updates.end_time ?? normalizeTime(shift.end_time),
      );
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await shift.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(SHIFT_NAME_TAKEN_MESSAGE);
      }
      throw error;
    }

    const [response] = await this.toResponses([shift]);
    return response;
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a shift of the
   * authenticated school.
   *
   * Refused with 409 while any live run still references the shift — see
   * `docs/operating-model.md` §8.1. The database would only `SET NULL` the
   * run's clock on a hard delete; silently turning timed runs into
   * whole-day runs is exactly the kind of invisible change this refuses.
   */
  async remove(schoolId: string, id: string): Promise<ShiftDeleteResponse> {
    const shift = await this.findShiftOrThrow(schoolId, id);
    const attached = await this.runs.count({
      where: { school_id: schoolId, shift_id: id } as WhereOptions,
    });
    if (attached > 0) {
      throw new ConflictException(SHIFT_HAS_RUNS_MESSAGE);
    }
    await shift.destroy();
    return { id, message: SHIFT_DELETED_MESSAGE };
  }
  private async findShiftOrThrow(schoolId: string, id: string): Promise<Shift> {
    const shift = await this.shifts.findOne({ where: { id, school_id: schoolId } });
    if (!shift) {
      throw new NotFoundException(SHIFT_NOT_FOUND_MESSAGE);
    }
    return shift;
  }

  /** Rejects a name already used by another live shift of the same school. */
  private async assertNameFree(schoolId: string, name: string, excludeId?: string): Promise<void> {
    const where: Record<PropertyKey, unknown> = { school_id: schoolId, name };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.shifts.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(SHIFT_NAME_TAKEN_MESSAGE);
    }
  }

  /**
   * Explicit field-by-field projection plus the live run count per shift,
   * resolved with one grouped query for the whole page.
   */
  private async toResponses(shifts: Shift[]): Promise<ShiftResponse[]> {
    if (shifts.length === 0) {
      return [];
    }
    const schoolId = shifts[0].school_id;
    const shiftIds = shifts.map((shift) => shift.id);
    const runs = await this.runs.findAll({
      where: { school_id: schoolId, shift_id: { [Op.in]: shiftIds } } as WhereOptions,
      attributes: ['shift_id'],
    });
    const countByShift = new Map<string, number>();
    for (const run of runs) {
      if (!run.shift_id) continue;
      countByShift.set(run.shift_id, (countByShift.get(run.shift_id) ?? 0) + 1);
    }
    return shifts.map((shift) => ({
      id: shift.id,
      school_id: shift.school_id,
      name: shift.name,
      start_time: normalizeTime(shift.start_time),
      end_time: normalizeTime(shift.end_time),
      is_active: shift.is_active,
      created_at: shift.created_at.toISOString(),
      updated_at: shift.updated_at.toISOString(),
      run_count: countByShift.get(shift.id) ?? 0,
    }));
  }
}

/**
 * Normalises `HH:MM` to `HH:MM:SS` — the form PostgreSQL returns for a `time`
 * column — so `07:00` and `07:00:00` compare equal and responses are uniform.
 */
export function normalizeTime(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

/** Mirrors `ck_shifts_window`: a window must have positive length. */
function assertWindow(startTime: string, endTime: string): void {
  if (endTime <= startTime) {
    throw new BadRequestException(SHIFT_WINDOW_INVALID_MESSAGE);
  }
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
