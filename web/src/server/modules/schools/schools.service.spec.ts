import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException } from '../../framework';
import { UniqueConstraintError } from 'sequelize';
import { UserRole } from '@school-bus-tracking/shared-types';
import { comparePassword } from '../../auth';
import { School, User } from '../../database/models';
import { SchoolsService } from './schools.service';
import {
  ADMIN_EMAIL_TAKEN_MESSAGE,
  ONBOARDING_CONFLICT_MESSAGE,
  SCHOOL_CODE_TAKEN_MESSAGE,
} from './schools.constants';
import { OnboardSchoolDto } from './dto/onboard-school.dto';

const SCHOOL_NAME = '  Lincoln High School  ';
const SCHOOL_CODE = 'lincoln-high';
const ADMIN_NAME = 'Alicia Adams';
const ADMIN_EMAIL = '  Admin@Lincoln-High.ORG  ';
const ADMIN_PASSWORD = 'correct-horse-battery';

interface StubSchool {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface StubUser {
  id: string;
  school_id: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
  password_hash: string | null;
  email_verified_at: Date | null;
  is_active: boolean;
}

/** In-memory Sequelize transaction that records commit/rollback. */
interface StubTransaction {
  state: 'active' | 'committed' | 'rolled-back';
  commitCalls: number;
  rollbackCalls: number;
}

function makeOnboardDto(overrides: Partial<OnboardSchoolDto> = {}): OnboardSchoolDto {
  const dto = new OnboardSchoolDto();
  dto.school = { name: SCHOOL_NAME, code: SCHOOL_CODE };
  dto.admin = { name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
  return Object.assign(dto, overrides);
}

function makeSchoolsRepository(
  existing: StubSchool[] = [],
  capture: {
    transaction?: StubTransaction;
    transactionCalls?: number;
    created?: StubSchool[];
    findOneWhere?: unknown;
  } = {},
) {
  const records = [...existing];
  capture.created = [];

  const transactionRunner = async (
    callback: (transaction: StubTransaction) => Promise<unknown>,
  ): Promise<unknown> => {
    capture.transactionCalls = (capture.transactionCalls ?? 0) + 1;
    const transaction: StubTransaction = { state: 'active', commitCalls: 0, rollbackCalls: 0 };
    capture.transaction = transaction;
    try {
      const result = await callback(transaction);
      transaction.state = 'committed';
      transaction.commitCalls += 1;
      return result;
    } catch (error) {
      transaction.state = 'rolled-back';
      transaction.rollbackCalls += 1;
      throw error;
    }
  };

  return {
    records,
    repo: {
      sequelize: { transaction: transactionRunner },
      findOne: (options: { where: Record<string, unknown> }) => {
        capture.findOneWhere = options.where;
        return Promise.resolve(
          records.find((record) => record.code === options.where.code) ?? null,
        );
      },
      create: (payload: Partial<StubSchool>) => {
        const record: StubSchool = {
          id: `school-${records.length + 1}`,
          name: payload.name ?? '',
          code: payload.code ?? '',
          is_active: payload.is_active ?? true,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        };
        records.push(record);
        capture.created?.push(record);
        return Promise.resolve(record);
      },
    } as unknown as typeof School,
  };
}

function makeUsersRepository(
  existing: StubUser[] = [],
  options: { failCreate?: boolean; createError?: Error } = {},
  capture: { created?: StubUser[]; findOneWhere?: unknown } = {},
) {
  const records = [...existing];
  capture.created = [];

  return {
    records,
    repo: {
      unscoped: () => ({
        findOne: (query: { where: Record<string, unknown> }) => {
          capture.findOneWhere = query.where;
          return Promise.resolve(
            records.find(
              (record) =>
                record.school_id === query.where.school_id && record.email === query.where.email,
            ) ?? null,
          );
        },
      }),
      create: (payload: Partial<StubUser>) => {
        if (options.failCreate) {
          return Promise.reject(options.createError ?? new Error('user create failed'));
        }
        const record: StubUser = {
          id: `user-${records.length + 1}`,
          school_id: payload.school_id ?? '',
          role: payload.role ?? UserRole.SCHOOL_ADMIN,
          first_name: payload.first_name ?? '',
          last_name: payload.last_name ?? '',
          email: payload.email ?? null,
          password_hash: payload.password_hash ?? null,
          email_verified_at: payload.email_verified_at ?? null,
          is_active: payload.is_active ?? true,
        };
        records.push(record);
        capture.created?.push(record);
        return Promise.resolve(record);
      },
    } as unknown as typeof User,
  };
}

async function expectConflict(promise: Promise<unknown>, expectedMessage: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ConflictException, 'expected a ConflictException');
    assert.equal(error.getStatus(), 409);
    assert.equal(error.message, expectedMessage);
    return true;
  });
}

describe('SchoolsService.onboard', () => {
  it('creates the school and the initial admin atomically', async () => {
    const schoolCapture: {
      created?: StubSchool[];
      transactionCalls?: number;
      transaction?: StubTransaction;
    } = {};
    const userCapture: { created?: StubUser[] } = {};
    const { repo: schools } = makeSchoolsRepository([], schoolCapture);
    const { repo: users } = makeUsersRepository([], {}, userCapture);
    const service = new SchoolsService(schools, users);

    const response = await service.onboard(makeOnboardDto());

    // One transaction used for both writes
    assert.equal(schoolCapture.transactionCalls, 1);
    assert.equal(schoolCapture.transaction?.state, 'committed');

    // School created with trimmed name + code
    assert.equal(schoolCapture.created?.length, 1);
    const createdSchool = schoolCapture.created![0];
    assert.equal(createdSchool.name, 'Lincoln High School');
    assert.equal(createdSchool.code, SCHOOL_CODE);
    assert.equal(createdSchool.is_active, true);

    // Admin linked to the new school with the SCHOOL_ADMIN role
    assert.equal(userCapture.created?.length, 1);
    const createdAdmin = userCapture.created![0];
    assert.equal(createdAdmin.school_id, createdSchool.id);
    assert.equal(createdAdmin.role, UserRole.SCHOOL_ADMIN);
    assert.equal(createdAdmin.first_name, 'Alicia');
    assert.equal(createdAdmin.last_name, 'Adams');

    // Response is the clean projection
    assert.equal(response.school.id, createdSchool.id);
    assert.equal(response.school.code, SCHOOL_CODE);
    assert.equal(response.admin.id, createdAdmin.id);
    assert.equal(response.admin.school_id, createdSchool.id);
    assert.equal(response.admin.role, UserRole.SCHOOL_ADMIN);
  });

  it('normalizes the admin email before storing it', async () => {
    const userCapture: { created?: StubUser[] } = {};
    const { repo: schools } = makeSchoolsRepository();
    const { repo: users } = makeUsersRepository([], {}, userCapture);
    const service = new SchoolsService(schools, users);

    await service.onboard(makeOnboardDto());

    assert.equal(userCapture.created![0].email, 'admin@lincoln-high.org');
  });

  it('hashes the password with the existing utility and never stores plaintext', async () => {
    const userCapture: { created?: StubUser[] } = {};
    const { repo: schools } = makeSchoolsRepository();
    const { repo: users } = makeUsersRepository([], {}, userCapture);
    const service = new SchoolsService(schools, users);

    await service.onboard(makeOnboardDto());

    const storedHash = userCapture.created![0].password_hash as string;
    assert.ok(storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$'));
    assert.notEqual(storedHash, ADMIN_PASSWORD, 'plaintext password must never be stored');
    assert.equal(
      await comparePassword(ADMIN_PASSWORD, storedHash),
      true,
      'stored hash must verify the original password',
    );
  });

  it('never returns password or password_hash in the response', async () => {
    const { repo: schools } = makeSchoolsRepository();
    const { repo: users } = makeUsersRepository();
    const service = new SchoolsService(schools, users);

    const response = await service.onboard(makeOnboardDto());
    const serialized = JSON.stringify(response);

    assert.ok(!serialized.includes('password'), 'response must not contain a password field');
    assert.ok(!serialized.includes(ADMIN_PASSWORD), 'response must not contain the plaintext');
    assert.ok(!serialized.includes('password_hash'), 'response must not contain the hash column');
    assert.ok(!('password_hash' in response.admin), 'admin projection has no hash key');
  });

  it('rejects a duplicate school code with 409 before creating anything', async () => {
    const existingSchool: StubSchool = {
      id: 'school-existing',
      name: 'Existing',
      code: SCHOOL_CODE,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const userCapture: { created?: StubUser[] } = {};
    const { repo: schools } = makeSchoolsRepository([existingSchool]);
    const { repo: users } = makeUsersRepository([], {}, userCapture);
    const service = new SchoolsService(schools, users);

    await expectConflict(service.onboard(makeOnboardDto()), SCHOOL_CODE_TAKEN_MESSAGE);
    assert.equal(userCapture.created?.length, 0, 'no admin must be created');
  });

  it('rejects a duplicate admin email inside the new school with 409', async () => {
    const capture: { transaction?: StubTransaction } = {};
    const { repo: schools } = makeSchoolsRepository([], capture);
    // The duplicate check happens after the school row is created, so the
    // stub needs a pre-existing user record for the freshly generated school.
    const duplicateUser: StubUser = {
      id: 'user-duplicate',
      school_id: 'school-1',
      role: UserRole.SCHOOL_ADMIN,
      first_name: 'Dup',
      last_name: 'Admin',
      email: 'admin@lincoln-high.org',
      password_hash: '$2b$12$placeholder',
      email_verified_at: null,
      is_active: true,
    };
    const { repo: users } = makeUsersRepository([duplicateUser]);
    const service = new SchoolsService(schools, users);

    await expectConflict(service.onboard(makeOnboardDto()), ADMIN_EMAIL_TAKEN_MESSAGE);
    assert.equal(capture.transaction?.state, 'rolled-back');
  });

  it('rolls back the transaction when the admin write fails', async () => {
    const capture: { transaction?: StubTransaction; created?: StubSchool[] } = {};
    const { repo: schools } = makeSchoolsRepository([], capture);
    const { repo: users } = makeUsersRepository([], { failCreate: true });
    const service = new SchoolsService(schools, users);

    await assert.rejects(service.onboard(makeOnboardDto()), /user create failed/);
    assert.equal(capture.transaction?.state, 'rolled-back');
    assert.equal(capture.transaction?.rollbackCalls, 1);
  });

  it('translates a school code unique-constraint race into 409', async () => {
    const { repo: schools } = makeSchoolsRepository();
    // Stub the SQL-level conflict on school creation.
    (schools as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message: 'duplicate key value violates unique constraint "uq_schools_code"',
          fields: { code: SCHOOL_CODE },
        }),
      );
    const { repo: users } = makeUsersRepository();
    const service = new SchoolsService(schools, users);

    await expectConflict(service.onboard(makeOnboardDto()), SCHOOL_CODE_TAKEN_MESSAGE);
  });

  it('translates an admin email unique-constraint race into 409', async () => {
    const { repo: schools } = makeSchoolsRepository();
    const { repo: users } = makeUsersRepository();
    (users as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message: 'duplicate key value violates unique constraint "uq_users_school_email"',
          fields: { email: 'admin@lincoln-high.org' },
        }),
      );
    const service = new SchoolsService(schools, users);

    await expectConflict(service.onboard(makeOnboardDto()), ADMIN_EMAIL_TAKEN_MESSAGE);
  });

  it('falls back to a generic conflict message for other unique violations', async () => {
    const { repo: schools } = makeSchoolsRepository();
    const { repo: users } = makeUsersRepository();
    (users as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message: 'duplicate key value violates unique constraint "uq_somewhere"',
          fields: { something: 'value' },
        }),
      );
    const service = new SchoolsService(schools, users);

    await expectConflict(service.onboard(makeOnboardDto()), ONBOARDING_CONFLICT_MESSAGE);
  });
});
