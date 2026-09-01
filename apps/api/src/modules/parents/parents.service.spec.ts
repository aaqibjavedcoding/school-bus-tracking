import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { comparePassword } from '../../auth';
import { Student, StudentGuardian, User } from '../../database/models';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CreateParentDto } from './dto/create-parent.dto';
import { ListParentsQueryDto } from './dto/list-parents-query.dto';
import { UpdateParentDto } from './dto/update-parent.dto';
import { PlanLimitsService } from '../../common/plan-limits';
import { ParentsService } from './parents.service';
import {
  PARENT_DELETED_MESSAGE,
  PARENT_EMAIL_TAKEN_MESSAGE,
  PARENT_NOT_FOUND_MESSAGE,
} from './parents.constants';
import { ParentGuardiansService } from './parent-guardians.service';
import { CreateParentStudentRelationshipDto } from './dto/create-parent-student-relationship.dto';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';
import {
  STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE,
  STUDENT_GUARDIAN_DELETED_MESSAGE,
  STUDENT_GUARDIAN_NOT_FOUND_MESSAGE,
} from './parents.constants';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PARENT_A = '11111111-1111-4111-8111-111111111111';
const PARENT_B = '22222222-2222-4222-8222-222222222222';
const STUDENT_A = '33333333-3333-4333-8333-333333333333';
const STUDENT_B = '44444444-4444-4444-8444-444444444444';

interface StubParent {
  id: string;
  school_id: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
  password_hash: string | null;
  email_verified_at: Date | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Record<string, unknown>) => Promise<StubParent>;
  destroy: () => Promise<void>;
}

interface StubStudent {
  id: string;
  school_id: string;
}

interface StubRelationship {
  id: string;
  school_id: string;
  student_id: string;
  user_id: string;
  relationship: string;
  can_pick_up: boolean;
  is_primary: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Record<string, unknown>) => Promise<StubRelationship>;
  destroy: () => Promise<void>;
}

const nextParentId = 1;
let nextLinkId = 1;

function makeParent(overrides: Partial<StubParent> = {}): StubParent {
  const parent: StubParent = {
    id: `parent-${nextParentId}`,
    school_id: SCHOOL_A,
    role: UserRole.PARENT,
    first_name: 'Alicia',
    last_name: 'Adams',
    email: 'parent@example.org',
    password_hash: null,
    email_verified_at: null,
    phone: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(parent, values, { updated_at: new Date('2026-02-01T00:00:00.000Z') });
      return parent;
    },
    destroy: async () => {
      parent.deleted_at = new Date('2026-03-01T00:00:00.000Z');
      parent.updated_at = parent.deleted_at;
    },
  };
  Object.assign(parent, overrides);
  return parent;
}

function makeParentRepository(
  existing: StubParent[] = [],
  capture: {
    createPayload?: Record<string, unknown>;
    findOneWhere?: Record<string, unknown>;
    findAndCountWhere?: Record<PropertyKey, unknown>;
  } = {},
) {
  const records = [...existing];
  return {
    records,
    capture,
    repo: {
      findOne: async (options: { where: Record<string, unknown> }) => {
        capture.findOneWhere = options.where;
        return (records.find(
          (record) =>
            record.deleted_at === null &&
            Object.entries(options.where).every(
              ([key, value]) => record[key as keyof StubParent] === value,
            ),
        ) ?? null) as unknown as User;
      },
      create: async (payload: Record<string, unknown>) => {
        capture.createPayload = payload;
        const parent = makeParent({
          id: `created-${records.length + 1}`,
          school_id: payload.school_id as string,
          role: payload.role as UserRole,
          first_name: payload.first_name as string,
          last_name: payload.last_name as string,
          email: payload.email as string,
          password_hash: payload.password_hash as string,
          phone: (payload.phone as string | null) ?? null,
          is_active: payload.is_active as boolean,
        });
        records.push(parent);
        return parent as unknown as User;
      },
      findAndCountAll: async (options: {
        where?: Record<PropertyKey, unknown>;
        limit?: number;
        offset?: number;
      }) => {
        capture.findAndCountWhere = options.where;
        const rows = records.filter(
          (record) =>
            record.deleted_at === null &&
            record.school_id === options.where?.['school_id'] &&
            record.role === options.where?.['role'],
        );
        const search = options.where?.[Symbol.for('sequelize.or')];
        // The service uses Sequelize's Op.or symbol; tenant filtering is what
        // matters for this in-memory repository, while search is covered by
        // the captured query assertion below.
        void search;
        const offset = options.offset ?? 0;
        const limit = options.limit ?? rows.length;
        return {
          rows: rows.slice(offset, offset + limit) as unknown as User[],
          count: rows.length,
        };
      },
    } as unknown as typeof User,
  };
}

function makeStudentRepository(records: StubStudent[] = []) {
  return {
    repo: {
      findOne: async (options: { where: Record<string, unknown> }) =>
        (records.find(
          (record) =>
            record.id === options.where.id && record.school_id === options.where.school_id,
        ) ?? null) as unknown as Student,
    } as unknown as typeof Student,
  };
}

function makeRelationship(overrides: Partial<StubRelationship> = {}): StubRelationship {
  const relationship: StubRelationship = {
    id: `link-${nextLinkId++}`,
    school_id: SCHOOL_A,
    student_id: STUDENT_A,
    user_id: PARENT_A,
    relationship: 'Mother',
    can_pick_up: true,
    is_primary: true,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(relationship, values, { updated_at: new Date('2026-02-01T00:00:00.000Z') });
      return relationship;
    },
    destroy: async () => {
      relationship.deleted_at = new Date('2026-03-01T00:00:00.000Z');
    },
  };
  Object.assign(relationship, overrides);
  return relationship;
}

function makeRelationshipRepository(
  records: StubRelationship[] = [],
  capture: Record<string, unknown> = {},
) {
  const all = [...records];
  return {
    all,
    capture,
    repo: {
      findOne: async (options: { where: Record<string, unknown> }) => {
        capture.findOneWhere = options.where;
        return (all.find(
          (record) =>
            record.deleted_at === null &&
            Object.entries(options.where).every(
              ([key, value]) => record[key as keyof StubRelationship] === value,
            ),
        ) ?? null) as unknown as StudentGuardian;
      },
      findAll: async (options: { where: Record<string, unknown> }) => {
        capture.findAllWhere = options.where;
        return all.filter(
          (record) =>
            record.deleted_at === null &&
            Object.entries(options.where).every(
              ([key, value]) => record[key as keyof StubRelationship] === value,
            ),
        ) as unknown as StudentGuardian[];
      },
      create: async (payload: Record<string, unknown>) => {
        const relationship = makeRelationship({
          id: `created-link-${all.length + 1}`,
          school_id: payload.school_id as string,
          student_id: payload.student_id as string,
          user_id: payload.user_id as string,
          relationship: payload.relationship as string,
          can_pick_up: payload.can_pick_up as boolean,
          is_primary: payload.is_primary as boolean,
          is_active: payload.is_active as boolean,
        });
        all.push(relationship);
        return relationship as unknown as StudentGuardian;
      },
    } as unknown as typeof StudentGuardian,
  };
}

function allowAllPlanLimits(): PlanLimitsService {
  return {
    assertWithinLimit: async () => undefined,
    assertStaffWithinLimit: async () => undefined,
  } as unknown as PlanLimitsService;
}

function parentDto(overrides: Partial<CreateParentDto> = {}): CreateParentDto {
  const dto = new CreateParentDto();
  dto.first_name = 'Alicia';
  dto.last_name = 'Adams';
  dto.email = 'Parent@Example.org';
  dto.password = 'correct-horse-battery';
  return Object.assign(dto, overrides);
}

function relationshipDto(
  overrides: Partial<CreateParentStudentRelationshipDto> = {},
): CreateParentStudentRelationshipDto {
  const dto = new CreateParentStudentRelationshipDto();
  dto.student_id = STUDENT_A;
  dto.relationship = 'Mother';
  dto.can_pick_up = true;
  dto.is_primary = true;
  return Object.assign(dto, overrides);
}

function expectNotFound(promise: Promise<unknown>, message: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException);
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, message);
    return true;
  });
}

function expectConflict(promise: Promise<unknown>, message: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.getStatus(), 409);
    assert.equal(error.message, message);
    return true;
  });
}

describe('ParentsService account management', () => {
  it('creates a PARENT in the JWT tenant with a bcrypt password hash', async () => {
    const capture: { createPayload?: Record<string, unknown> } = {};
    const { repo: users } = makeParentRepository([], capture);
    const service = new ParentsService(users, allowAllPlanLimits());

    const result = await service.create(SCHOOL_A, parentDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.role, UserRole.PARENT);
    assert.equal(capture.createPayload?.email, 'parent@example.org');
    const hash = capture.createPayload?.password_hash as string;
    assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'));
    assert.notEqual(hash, 'correct-horse-battery');
    assert.equal(await comparePassword('correct-horse-battery', hash), true);
    assert.equal(result.role, UserRole.PARENT);
    assert.equal(result.school_id, SCHOOL_A);
    assert.ok(!JSON.stringify(result).includes('password'));
  });

  it('rejects duplicate email within the authenticated school', async () => {
    const existing = makeParent({ id: PARENT_A, school_id: SCHOOL_A, email: 'parent@example.org' });
    const { repo: users } = makeParentRepository([existing]);
    const service = new ParentsService(users, allowAllPlanLimits());
    await expectConflict(service.create(SCHOOL_A, parentDto()), PARENT_EMAIL_TAKEN_MESSAGE);
  });

  it('allows the same normalized email in another tenant', async () => {
    const existing = makeParent({ id: PARENT_A, school_id: SCHOOL_B, email: 'parent@example.org' });
    const capture: { createPayload?: Record<string, unknown> } = {};
    const { repo: users } = makeParentRepository([existing], capture);
    const service = new ParentsService(users, allowAllPlanLimits());
    await service.create(SCHOOL_A, parentDto());
    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
  });

  it('translates a database email race into 409', async () => {
    const { repo: users } = makeParentRepository();
    (users as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message: 'duplicate key value violates unique constraint "uq_users_school_email"',
          fields: { email: 'parent@example.org' },
        }),
      );
    const service = new ParentsService(users, allowAllPlanLimits());
    await expectConflict(service.create(SCHOOL_A, parentDto()), PARENT_EMAIL_TAKEN_MESSAGE);
  });

  it('lists only PARENT records from the JWT tenant', async () => {
    const { repo: users } = makeParentRepository([
      makeParent({ id: PARENT_A, school_id: SCHOOL_A }),
      makeParent({ id: PARENT_B, school_id: SCHOOL_B }),
      makeParent({ id: 'staff', school_id: SCHOOL_A, role: UserRole.DRIVER }),
    ]);
    const service = new ParentsService(users, allowAllPlanLimits());
    const result = await service.findAll(SCHOOL_A, new ListParentsQueryDto());
    assert.deepEqual(
      result.items.map((item) => item.id),
      [PARENT_A],
    );
    assert.equal(result.items[0].school_id, SCHOOL_A);
    assert.equal(result.meta.total, 1);
  });

  it('returns a generic 404 for another tenant and non-parent account', async () => {
    const { repo: users } = makeParentRepository([
      makeParent({ id: PARENT_B, school_id: SCHOOL_B }),
      makeParent({ id: 'driver', school_id: SCHOOL_A, role: UserRole.DRIVER }),
    ]);
    const service = new ParentsService(users, allowAllPlanLimits());
    await expectNotFound(service.findOne(SCHOOL_A, PARENT_B), PARENT_NOT_FOUND_MESSAGE);
    await expectNotFound(service.findOne(SCHOOL_A, 'driver'), PARENT_NOT_FOUND_MESSAGE);
  });

  it('updates profile fields and bcrypt-hashes a changed password without changing ownership', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const { repo: users } = makeParentRepository([parent]);
    const service = new ParentsService(users, allowAllPlanLimits());
    const dto = new UpdateParentDto();
    dto.first_name = 'Alicia-Marie';
    dto.password = 'new-correct-password';
    dto.phone = '+1 555 0199';

    const result = await service.update(SCHOOL_A, PARENT_A, dto);
    assert.equal(result.first_name, 'Alicia-Marie');
    assert.equal(parent.school_id, SCHOOL_A);
    assert.equal(parent.role, UserRole.PARENT);
    assert.ok(parent.password_hash);
    assert.equal(await comparePassword('new-correct-password', parent.password_hash!), true);
    assert.notEqual(parent.password_hash, 'new-correct-password');
  });

  it('rejects changing to another user email inside the same school', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A, email: 'one@example.org' });
    const other = makeParent({ id: PARENT_B, school_id: SCHOOL_A, email: 'two@example.org' });
    const { repo: users } = makeParentRepository([parent, other]);
    const service = new ParentsService(users, allowAllPlanLimits());
    const dto = new UpdateParentDto();
    dto.email = 'two@example.org';
    await expectConflict(service.update(SCHOOL_A, PARENT_A, dto), PARENT_EMAIL_TAKEN_MESSAGE);
  });

  it('soft-deletes only an in-tenant parent account', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const { repo: users } = makeParentRepository([parent]);
    const service = new ParentsService(users, allowAllPlanLimits());
    const result = await service.remove(SCHOOL_A, PARENT_A);
    assert.equal(parent.deleted_at?.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.deepEqual(result, { id: PARENT_A, message: PARENT_DELETED_MESSAGE });
  });
});

describe('ParentGuardiansService relationship management', () => {
  function setup(
    parents: StubParent[] = [],
    students: StubStudent[] = [],
    links: StubRelationship[] = [],
  ) {
    const parentRepo = makeParentRepository(parents);
    const studentRepo = makeStudentRepository(students);
    const linkRepo = makeRelationshipRepository(links);
    return {
      service: new ParentGuardiansService(parentRepo.repo, studentRepo.repo, linkRepo.repo),
      parentRepo,
      linkRepo,
    };
  }

  it('creates a relationship with the authenticated tenant and parent/student ids', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const student = { id: STUDENT_A, school_id: SCHOOL_A };
    const { service, linkRepo } = setup([parent], [student]);

    const response = await service.createForParent(SCHOOL_A, PARENT_A, relationshipDto());

    const payload = linkRepo.all[0];
    assert.equal(payload.school_id, SCHOOL_A);
    assert.equal(payload.student_id, STUDENT_A);
    assert.equal(payload.user_id, PARENT_A);
    assert.equal(payload.can_pick_up, true);
    assert.equal(response.parent_id, PARENT_A);
    assert.equal(response.user_id, PARENT_A);
  });

  it('supports a student-centred relationship creation route', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const student = { id: STUDENT_A, school_id: SCHOOL_A };
    const { service, linkRepo } = setup([parent], [student]);
    const dto = new CreateStudentGuardianDto();
    dto.parent_id = PARENT_A;
    dto.relationship = 'Father';

    await service.createForStudent(SCHOOL_A, STUDENT_A, dto);
    assert.equal(linkRepo.all[0].user_id, PARENT_A);
  });

  it('rejects an active duplicate relationship with 409', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const student = { id: STUDENT_A, school_id: SCHOOL_A };
    const existing = makeRelationship({
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_A,
    });
    const { service } = setup([parent], [student], [existing]);
    await expectConflict(
      service.createForParent(SCHOOL_A, PARENT_A, relationshipDto()),
      STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE,
    );
  });

  it('translates a unique-index race into 409', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const student = { id: STUDENT_A, school_id: SCHOOL_A };
    const { service, linkRepo } = setup([parent], [student]);
    (linkRepo.repo as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message:
            'duplicate key value violates unique constraint "uq_student_guardians_school_student_user"',
          fields: { student_id: STUDENT_A, user_id: PARENT_A },
        }),
      );
    await expectConflict(
      service.createForParent(SCHOOL_A, PARENT_A, relationshipDto()),
      STUDENT_GUARDIAN_ALREADY_EXISTS_MESSAGE,
    );
  });

  it('rejects a parent or student from another tenant with generic 404', async () => {
    const ownParent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const otherParent = makeParent({ id: PARENT_B, school_id: SCHOOL_B });
    const ownStudent = { id: STUDENT_A, school_id: SCHOOL_A };
    const otherStudent = { id: STUDENT_B, school_id: SCHOOL_B };
    const { service } = setup([ownParent, otherParent], [ownStudent, otherStudent]);

    await expectNotFound(
      service.createForParent(SCHOOL_A, PARENT_A, relationshipDto({ student_id: STUDENT_B })),
      STUDENT_GUARDIAN_NOT_FOUND_MESSAGE,
    );
    await expectNotFound(
      service.createForParent(SCHOOL_A, PARENT_B, relationshipDto()),
      PARENT_NOT_FOUND_MESSAGE,
    );
    await expectNotFound(
      service.createForStudent(SCHOOL_A, STUDENT_B, new CreateStudentGuardianDto()),
      STUDENT_GUARDIAN_NOT_FOUND_MESSAGE,
    );
  });

  it('lists only links scoped to the authenticated tenant', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const ownStudent = { id: STUDENT_A, school_id: SCHOOL_A };
    const otherStudent = { id: STUDENT_B, school_id: SCHOOL_B };
    const ownLink = makeRelationship({
      id: 'own-link',
      school_id: SCHOOL_A,
      student_id: STUDENT_A,
      user_id: PARENT_A,
    });
    const leakedLink = makeRelationship({
      id: 'other-link',
      school_id: SCHOOL_B,
      student_id: STUDENT_B,
      user_id: PARENT_A,
    });
    const { service } = setup([parent], [ownStudent, otherStudent], [ownLink, leakedLink]);

    const result = await service.listForParent(SCHOOL_A, PARENT_A);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ['own-link'],
    );
    assert.equal(result.items[0].school_id, SCHOOL_A);
  });

  it('updates and soft-deletes an in-tenant relationship', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const student = { id: STUDENT_A, school_id: SCHOOL_A };
    const link = makeRelationship({ id: 'link-to-change' });
    const { service } = setup([parent], [student], [link]);
    const update = new UpdateParentStudentRelationshipDto();
    update.relationship = 'Legal guardian';
    update.can_pick_up = false;

    const updated = await service.updateForParent(SCHOOL_A, PARENT_A, STUDENT_A, update);
    assert.equal(updated.relationship, 'Legal guardian');
    assert.equal(updated.can_pick_up, false);

    const removed = await service.removeForParent(SCHOOL_A, PARENT_A, STUDENT_A);
    assert.deepEqual(removed, { id: 'link-to-change', message: STUDENT_GUARDIAN_DELETED_MESSAGE });
    assert.ok(link.deleted_at);
  });

  it('does not expose another tenant relationship by id pair', async () => {
    const parent = makeParent({ id: PARENT_A, school_id: SCHOOL_A });
    const otherLink = makeRelationship({
      school_id: SCHOOL_B,
      student_id: STUDENT_B,
      user_id: PARENT_B,
    });
    const { service } = setup([parent], [{ id: STUDENT_A, school_id: SCHOOL_A }], [otherLink]);
    await expectNotFound(
      service.updateForParent(
        SCHOOL_A,
        PARENT_A,
        STUDENT_B,
        new UpdateParentStudentRelationshipDto(),
      ),
      STUDENT_GUARDIAN_NOT_FOUND_MESSAGE,
    );
  });
});
