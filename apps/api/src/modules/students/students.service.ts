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
  StudentDeleteResponse,
  StudentListResponse,
  StudentResponse,
} from '@school-bus-tracking/shared-types';
import { Student, StudentAttributes, Stop } from '../../database/models';
import {
  STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE,
  STUDENT_DATE_OF_BIRTH_INVALID_MESSAGE,
  STUDENT_DELETED_MESSAGE,
  STUDENT_HOME_STOP_INVALID_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
  STUDENTS_REPOSITORY,
  STUDENTS_STOPS_REPOSITORY,
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
 * Parent/guardian linkage is intentionally NOT part of this API: the current
 * `students` model has no parent/user column by design (see the model and
 * migration docs — a many-to-many `student_guardians` join table arrives with
 * the parent-accounts task). Until then there is no parent assignment field to
 * validate, so no cross-tenant parent reference can be submitted.
 */
@Injectable()
export class StudentsService {
  constructor(
    @Inject(STUDENTS_REPOSITORY) private readonly students: typeof Student,
    @Inject(STUDENTS_STOPS_REPOSITORY) private readonly stops: typeof Stop,
  ) {}

  /**
   * Creates a student inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input, and every referenced home stop is verified to belong to the same
   * school before the row is written.
   */
  async create(schoolId: string, dto: CreateStudentDto): Promise<StudentResponse> {
    const homeStopId = dto.home_stop_id ?? null;
    if (homeStopId) {
      await this.assertHomeStopInSchool(schoolId, homeStopId);
    }

    try {
      const student = await this.students.create({
        school_id: schoolId,
        admission_number: dto.admission_number.trim(),
        first_name: dto.first_name.trim(),
        last_name: dto.last_name.trim(),
        home_stop_id: homeStopId,
        date_of_birth: this.toDate(dto.date_of_birth),
        gender: dto.gender ?? null,
        grade_level: nullableTrim(dto.grade_level),
        emergency_contact_name: nullableTrim(dto.emergency_contact_name),
        emergency_contact_phone: nullableTrim(dto.emergency_contact_phone),
        medical_notes: nullableTrim(dto.medical_notes),
        is_active: dto.is_active ?? true,
      });
      return this.toStudentResponse(student);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Lists students of the authenticated school only, with pagination and an
   * optional case-insensitive name search. No other tenant's rows can match
   * because `school_id` is always part of the where clause.
   */
  async findAll(schoolId: string, query: ListStudentsQueryDto): Promise<StudentListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { first_name: { [Op.iLike]: pattern } },
        { last_name: { [Op.iLike]: pattern } },
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

    return {
      items: rows.map((student) => this.toStudentResponse(student)),
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

  /** Explicit field-by-field projection — no internal or sensitive field leaks. */
  private toStudentResponse(student: Student): StudentResponse {
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
      emergency_contact_name: student.emergency_contact_name,
      emergency_contact_phone: student.emergency_contact_phone,
      medical_notes: student.medical_notes,
      is_active: student.is_active,
      created_at: student.created_at.toISOString(),
      updated_at: student.updated_at.toISOString(),
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
