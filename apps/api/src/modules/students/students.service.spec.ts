import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import { StudentGender } from '@school-bus-tracking/shared-types';
import { Bus, Route, RouteAssignment, Student, StudentGuardian, Stop } from '../../database/models';
import { PlanLimitsService } from '../../common/plan-limits';
import { StudentsService } from './students.service';
import {
  STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE,
  STUDENT_DATE_OF_BIRTH_INVALID_MESSAGE,
  STUDENT_DELETED_MESSAGE,
  STUDENT_HOME_STOP_INVALID_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
} from './students.constants';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STOP_A = '11111111-1111-4111-8111-111111111111';
const STOP_B = '22222222-2222-4222-8222-222222222222';

interface StubStudentRecord {
  id: string;
  school_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  home_stop_id: string | null;
  date_of_birth: Date | null;
  gender: StudentGender | null;
  grade_level: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Partial<StubStudentRecord>) => Promise<StubStudentRecord>;
  destroy: () => Promise<void>;
}

let nextId = 1;

function makeStudentRecord(overrides: Partial<StubStudentRecord> = {}): StubStudentRecord {
  const record: StubStudentRecord = {
    id: `student-${nextId}`,
    school_id: SCHOOL_A,
    admission_number: `ADM-${nextId}`,
    first_name: 'Alice',
    last_name: 'Adams',
    home_stop_id: null,
    date_of_birth: new Date('2016-03-15T00:00:00.000Z'),
    gender: StudentGender.FEMALE,
    grade_level: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    medical_notes: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(record, values, { updated_at: new Date('2026-02-01T00:00:00.000Z') });
      return record;
    },
    destroy: async () => {
      record.deleted_at = new Date('2026-03-01T00:00:00.000Z');
      record.updated_at = record.deleted_at;
    },
  };
  Object.assign(record, overrides, { id: overrides.id ?? record.id });
  nextId += 1;
  return record;
}

function makeStudentsRepository(
  records: StubStudentRecord[] = [],
  capture: {
    createPayload?: Partial<StubStudentRecord>;
    findOneWhere?: Record<PropertyKey, unknown>;
    findAndCountWhere?: Record<PropertyKey, unknown>;
  } = {},
) {
  const all = [...records];
  return {
    all,
    repo: {
      findOne: async (options: { where: Record<PropertyKey, unknown> }) => {
        capture.findOneWhere = options.where;
        const match = all.find(
          (record) =>
            record.id === options.where.id &&
            record.school_id === options.where.school_id &&
            record.deleted_at === null,
        );
        return (match ?? null) as unknown as Student;
      },
      create: async (payload: Partial<StubStudentRecord>) => {
        capture.createPayload = payload;
        const record = makeStudentRecord({
          ...payload,
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          updated_at: new Date('2026-04-01T00:00:00.000Z'),
        });
        all.push(record);
        return record as unknown as Student;
      },
      findAndCountAll: async (options: {
        where?: Record<PropertyKey, unknown>;
        limit?: number;
        offset?: number;
        order?: unknown;
      }) => {
        capture.findAndCountWhere = options.where;
        let rows = all.filter(
          (record) =>
            record.school_id === options.where?.['school_id'] && record.deleted_at === null,
        );

        const or = options.where?.[Op.or] as
          Array<Record<string, Record<PropertyKey, string>>> | undefined;
        if (or) {
          const fields = ['first_name', 'last_name', 'admission_number', 'grade_level'] as const;
          rows = rows.filter((record) =>
            or.some((clause) =>
              fields.some((field) => {
                const pattern = clause[field]?.[Op.iLike];
                if (!pattern) return false;
                const needle = pattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
                return String(record[field] ?? '').toLowerCase().includes(needle);
              }),
            ),
          );
        }

        const offset = options.offset ?? 0;
        const limit = options.limit ?? rows.length;
        return {
          rows: rows.slice(offset, offset + limit).map((record) => record as unknown as Student),
          count: rows.length,
        };
      },
    } as unknown as typeof Student,
  };
}

function makeStopsRepository(
  records: Array<{ id: string; school_id: string; route_id?: string; name?: string }> = [],
) {
  return {
    repo: {
      findOne: async (options: { where: Record<string, unknown> }) =>
        records.find(
          (record) =>
            record.id === options.where.id && record.school_id === options.where.school_id,
        ) ?? null,
      findAll: async (options: { where: Record<string, unknown> }) =>
        records.filter((record) => record.school_id === options.where.school_id),
    } as unknown as typeof Stop,
  };
}

function emptyGuardians(): typeof StudentGuardian {
  return {
    findOne: async () => null,
  } as unknown as typeof StudentGuardian;
}

/** Builds the service with empty route / assignment / bus relation stubs. */
function allowAllPlanLimits(): PlanLimitsService {
  return {
    assertWithinLimit: async () => undefined,
    assertStaffWithinLimit: async () => undefined,
    // Transactional reservation used by the create paths. Without a database
    // the real service behaves the same way: assert, then run the work with
    // no transaction.
    runWithinLimit: async <T>(_schoolId: string, _resource: unknown, work: () => Promise<T>) =>
      work(),
    runWithinStaffLimit: async <T>(_schoolId: string, _role: unknown, work: () => Promise<T>) =>
      work(),
  } as unknown as PlanLimitsService;
}

function makeService(
  students: typeof Student,
  stops: typeof Stop,
  guardians: typeof StudentGuardian,
): StudentsService {
  const empty = { findAll: async () => [] } as unknown as typeof Route;
  return new StudentsService(
    students,
    stops,
    guardians,
    empty as unknown as typeof Route,
    empty as unknown as typeof RouteAssignment,
    empty as unknown as typeof Bus,
    allowAllPlanLimits(),
  );
}

function makeCreateDto(overrides: Partial<CreateStudentDto> = {}): CreateStudentDto {
  const dto = new CreateStudentDto();
  dto.admission_number = 'STU-101';
  dto.first_name = 'Alice';
  dto.last_name = 'Adams';
  dto.gender = StudentGender.FEMALE;
  dto.date_of_birth = '2016-03-15';
  dto.grade_level = 'Grade 5';
  return Object.assign(dto, overrides);
}

function makeUpdateDto(overrides: Partial<UpdateStudentDto> = {}): UpdateStudentDto {
  const dto = new UpdateStudentDto();
  return Object.assign(dto, overrides);
}

function makeQuery(overrides: Partial<ListStudentsQueryDto> = {}): ListStudentsQueryDto {
  const dto = new ListStudentsQueryDto();
  return Object.assign(dto, overrides);
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException, 'expected a NotFoundException');
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, STUDENT_NOT_FOUND_MESSAGE);
    return true;
  });
}

async function expectBadRequest(promise: Promise<unknown>, expectedMessage: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof BadRequestException, 'expected a BadRequestException');
    assert.equal(error.getStatus(), 400);
    assert.equal(error.message, expectedMessage);
    return true;
  });
}

describe('StudentsService.create', () => {
  it('creates a student scoped to the authenticated school', async () => {
    const capture: { createPayload?: Partial<StubStudentRecord> } = {};
    const { repo: students } = makeStudentsRepository([], capture);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.create(SCHOOL_A, makeCreateDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.admission_number, 'STU-101');
    assert.equal(capture.createPayload?.is_active, true);
    assert.equal(response.school_id, SCHOOL_A);
    assert.equal(response.admission_number, 'STU-101');
    assert.equal(response.date_of_birth, '2016-03-15');
    assert.equal(response.gender, StudentGender.FEMALE);
    assert.equal(typeof response.created_at, 'string');
    assert.equal(typeof response.updated_at, 'string');

    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes('password'), 'no credential material may appear');
    assert.ok(!serialized.includes('deleted_at'), 'internal fields are not serialized');
  });

  it('accepts a home stop that belongs to the same school', async () => {
    const capture: { createPayload?: Partial<StubStudentRecord> } = {};
    const { repo: students } = makeStudentsRepository([], capture);
    const service = makeService(
      students,
      makeStopsRepository([{ id: STOP_A, school_id: SCHOOL_A }]).repo,
      emptyGuardians(),
    );

    await service.create(SCHOOL_A, makeCreateDto({ home_stop_id: STOP_A }));

    assert.equal(capture.createPayload?.home_stop_id, STOP_A);
  });

  it('rejects a home stop that belongs to another school', async () => {
    const { repo: students } = makeStudentsRepository();
    const service = makeService(
      students,
      makeStopsRepository([{ id: STOP_B, school_id: SCHOOL_B }]).repo,
      emptyGuardians(),
    );

    await expectBadRequest(
      service.create(SCHOOL_A, makeCreateDto({ home_stop_id: STOP_B })),
      STUDENT_HOME_STOP_INVALID_MESSAGE,
    );
  });

  it('rejects an invalid calendar date even when it matches the shape', async () => {
    const { repo: students } = makeStudentsRepository();
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await expectBadRequest(
      service.create(SCHOOL_A, makeCreateDto({ date_of_birth: '2024-99-99' })),
      STUDENT_DATE_OF_BIRTH_INVALID_MESSAGE,
    );
  });

  it('translates an admission-number unique violation into 409', async () => {
    const { repo: students } = makeStudentsRepository();
    (students as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message: 'duplicate key value violates unique constraint "uq_students_school_admission"',
          fields: { admission_number: 'STU-101' },
        }),
      );
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await assert.rejects(service.create(SCHOOL_A, makeCreateDto()), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(error.message, STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE);
      return true;
    });
  });
});

describe('StudentsService.findAll', () => {
  it('returns only the students of the authenticated school', async () => {
    const ownOne = makeStudentRecord({ id: 'own-1', school_id: SCHOOL_A, first_name: 'Alice' });
    const ownTwo = makeStudentRecord({ id: 'own-2', school_id: SCHOOL_A, first_name: 'Bob' });
    const other = makeStudentRecord({ id: 'other-1', school_id: SCHOOL_B, first_name: 'Mallory' });
    const { repo: students } = makeStudentsRepository([ownOne, ownTwo, other]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.findAll(SCHOOL_A, makeQuery());

    assert.equal(response.items.length, 2);
    assert.ok(response.items.every((item) => item.school_id === SCHOOL_A));
    assert.equal(response.meta.total, 2);
    assert.ok(!JSON.stringify(response).includes('Mallory'));
  });

  it('supports pagination with useful metadata', async () => {
    const records = Array.from({ length: 25 }, (_, index) =>
      makeStudentRecord({
        id: `page-${index}`,
        school_id: SCHOOL_A,
        first_name: `Student${index}`,
        admission_number: `P-${index}`,
      }),
    );
    const { repo: students } = makeStudentsRepository(records);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.findAll(SCHOOL_A, makeQuery({ page: 2, limit: 10 }));

    assert.equal(response.items.length, 10);
    assert.deepEqual(response.meta, {
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('filters by case-insensitive name search and stays tenant scoped', async () => {
    const capture: { findAndCountWhere?: Record<PropertyKey, unknown> } = {};
    const { repo: students } = makeStudentsRepository(
      [
        makeStudentRecord({
          id: 's1',
          school_id: SCHOOL_A,
          first_name: 'Alice',
          last_name: 'Adams',
        }),
        makeStudentRecord({ id: 's2', school_id: SCHOOL_A, first_name: 'Bob', last_name: 'Brown' }),
        makeStudentRecord({
          id: 's3',
          school_id: SCHOOL_B,
          first_name: 'Alice',
          last_name: 'Other',
        }),
      ],
      capture,
    );
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.findAll(SCHOOL_A, makeQuery({ search: 'aliCE' }));

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].id, 's1');
    assert.equal(response.meta.total, 1);
    assert.ok(capture.findAndCountWhere?.[Op.or], 'search must be applied via Op.or');
  });

  it('filters by admission number and grade level', async () => {
    const { repo: students } = makeStudentsRepository([
      makeStudentRecord({
        id: 's1',
        school_id: SCHOOL_A,
        first_name: 'Alice',
        admission_number: 'P-2041',
        grade_level: 'Grade 5',
      }),
      makeStudentRecord({
        id: 's2',
        school_id: SCHOOL_A,
        first_name: 'Bob',
        admission_number: 'P-9988',
        grade_level: 'Grade 9',
      }),
    ]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const byAdmission = await service.findAll(SCHOOL_A, makeQuery({ search: 'P-2041' }));
    assert.deepEqual(byAdmission.items.map((item) => item.id), ['s1']);

    const byGrade = await service.findAll(SCHOOL_A, makeQuery({ search: 'grade 9' }));
    assert.deepEqual(byGrade.items.map((item) => item.id), ['s2']);
  });

  it('returns the home stop, route and bus display fields', async () => {
    const { repo: students } = makeStudentsRepository([
      makeStudentRecord({ id: 's1', school_id: SCHOOL_A, home_stop_id: STOP_A }),
    ]);
    const stops = makeStopsRepository([{ id: STOP_A, school_id: SCHOOL_A, route_id: 'route-1', name: 'Maple & 5th' }]);
    const routes = {
      findAll: async () => [{ id: 'route-1', name: 'North Loop', code: 'N1' }] as unknown as Route[],
    } as unknown as typeof Route;
    const assignments = {
      findAll: async () =>
        [{ route_id: 'route-1', bus_id: 'bus-1', effective_from: '2026-01-01' }] as unknown as RouteAssignment[],
    } as unknown as typeof RouteAssignment;
    const buses = {
      findAll: async () => [{ id: 'bus-1', bus_number: 'B-01' }] as unknown as Bus[],
    } as unknown as typeof Bus;

    const service = new StudentsService(
      students,
      stops.repo,
      emptyGuardians(),
      routes,
      assignments,
      buses,
      allowAllPlanLimits(),
    );

    const response = await service.findAll(SCHOOL_A, makeQuery());

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].home_stop_name, 'Maple & 5th');
    assert.equal(response.items[0].route_name, 'North Loop');
    assert.equal(response.items[0].route_code, 'N1');
    assert.equal(response.items[0].bus_number, 'B-01');
  });
});

describe('StudentsService.findOne', () => {
  it('returns a student of the authenticated school', async () => {
    const record = makeStudentRecord({ id: 'own-student', school_id: SCHOOL_A });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.findOne(SCHOOL_A, 'own-student');

    assert.equal(response.id, 'own-student');
    assert.equal(response.school_id, SCHOOL_A);
  });

  it('returns a generic 404 for a student of another school (no existence leak)', async () => {
    const record = makeStudentRecord({ id: 'cross-tenant', school_id: SCHOOL_B });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await expectNotFound(service.findOne(SCHOOL_A, 'cross-tenant'));
  });

  it('returns a generic 404 for an unknown id', async () => {
    const { repo: students } = makeStudentsRepository();
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await expectNotFound(service.findOne(SCHOOL_A, 'does-not-exist'));
  });
});

describe('StudentsService.update', () => {
  it('updates a student of the authenticated school without touching ownership', async () => {
    const record = makeStudentRecord({ id: 'own-student', school_id: SCHOOL_A });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.update(
      SCHOOL_A,
      'own-student',
      makeUpdateDto({ first_name: 'Alicia', admission_number: 'STU-999' }),
    );

    assert.equal(response.first_name, 'Alicia');
    assert.equal(response.admission_number, 'STU-999');
    assert.equal(record.school_id, SCHOOL_A, 'school ownership must never change');
    assert.equal(record.updated_at.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('allows explicit null to clear a nullable field', async () => {
    const record = makeStudentRecord({
      id: 'own-student',
      school_id: SCHOOL_A,
      home_stop_id: STOP_A,
    });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(
      students,
      makeStopsRepository([{ id: STOP_A, school_id: SCHOOL_A }]).repo,
      emptyGuardians(),
    );

    const response = await service.update(
      SCHOOL_A,
      'own-student',
      makeUpdateDto({ home_stop_id: null }),
    );

    assert.equal(response.home_stop_id, null);
    assert.equal(record.home_stop_id, null);
  });

  it('rejects updating a student of another school with a generic 404', async () => {
    const record = makeStudentRecord({ id: 'cross-tenant', school_id: SCHOOL_B });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await expectNotFound(
      service.update(SCHOOL_A, 'cross-tenant', makeUpdateDto({ first_name: 'Hacked' })),
    );
  });

  it('rejects reassigning a home stop to another school', async () => {
    const record = makeStudentRecord({ id: 'own-student', school_id: SCHOOL_A });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(
      students,
      makeStopsRepository([{ id: STOP_B, school_id: SCHOOL_B }]).repo,
      emptyGuardians(),
    );

    await expectBadRequest(
      service.update(SCHOOL_A, 'own-student', makeUpdateDto({ home_stop_id: STOP_B })),
      STUDENT_HOME_STOP_INVALID_MESSAGE,
    );
  });

  it('translates a unique violation during update into 409', async () => {
    const record = makeStudentRecord({ id: 'own-student', school_id: SCHOOL_A });
    record.update = async () => {
      throw new UniqueConstraintError({
        message: 'duplicate key value violates unique constraint "uq_students_school_admission"',
        fields: { admission_number: 'STU-101' },
      });
    };
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await assert.rejects(
      service.update(SCHOOL_A, 'own-student', makeUpdateDto({ admission_number: 'STU-101' })),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.message, STUDENT_ADMISSION_NUMBER_TAKEN_MESSAGE);
        return true;
      },
    );
  });
});

describe('StudentsService.remove', () => {
  it('soft deletes a student of the authenticated school only', async () => {
    const record = makeStudentRecord({ id: 'own-student', school_id: SCHOOL_A });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    const response = await service.remove(SCHOOL_A, 'own-student');

    assert.equal(response.id, 'own-student');
    assert.equal(response.message, STUDENT_DELETED_MESSAGE);
    assert.ok(record.deleted_at instanceof Date, 'paranoid delete must set deleted_at');

    // The soft-deleted row is no longer visible through tenant-scoped reads.
    await expectNotFound(service.findOne(SCHOOL_A, 'own-student'));
  });

  it('rejects deleting a student of another school with a generic 404', async () => {
    const record = makeStudentRecord({ id: 'cross-tenant', school_id: SCHOOL_B });
    const { repo: students } = makeStudentsRepository([record]);
    const service = makeService(students, makeStopsRepository().repo, emptyGuardians());

    await expectNotFound(service.remove(SCHOOL_A, 'cross-tenant'));
    assert.equal(record.deleted_at, null, 'other tenant rows must never be touched');
  });
});
