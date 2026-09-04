import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createRoute,
  createSchool,
  createStop,
  createStudent,
  createUser,
} from '../support/fixtures';
import { Student, User } from '../../src/server/database/models';

/**
 * Schema-level guarantees, verified against the real database.
 *
 * These are the invariants the application layer *relies on*: if a foreign key
 * or unique index is missing, tenant isolation and the plan-limit reservation
 * both degrade silently. Only PostgreSQL can prove them.
 */
describe('database constraints (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  before(async () => {
    sequelize = await prepareDatabase();
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  it('rejects a bus that references a non-existent school (foreign key)', async () => {
    await assert.rejects(createBus(randomUUID()), /foreign key|violates/i);
  });

  it('rejects a stop that references a non-existent route', async () => {
    const school = await createSchool();
    await assert.rejects(createStop(school.id, randomUUID()), /foreign key|violates/i);
  });

  it('refuses to attach a student to another tenant\'s stop (composite FK)', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const routeB = await createRoute(schoolB.id);
    const stopB = await createStop(schoolB.id, routeB.id);

    await assert.rejects(createStudent(schoolA.id, stopB.id), /foreign key|violates/i);
  });

  it('enforces a unique admission number per tenant, but allows reuse across tenants', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();

    await createStudent(schoolA.id, null, { admission_number: 'ADM-1' });
    await assert.rejects(
      createStudent(schoolA.id, null, { admission_number: 'ADM-1' }),
      /unique|duplicate/i,
    );
    // A different tenant may use the same admission number.
    const other = await createStudent(schoolB.id, null, { admission_number: 'ADM-1' });
    assert.equal(other.admission_number, 'ADM-1');
  });

  it('releases a unique identifier once the row is soft-deleted', async () => {
    const school = await createSchool();
    const student = await createStudent(school.id, null, { admission_number: 'ADM-2' });
    await student.destroy();
    const replacement = await createStudent(school.id, null, { admission_number: 'ADM-2' });
    assert.notEqual(replacement.id, student.id);

    const withDeleted = await Student.unscoped().count({
      where: { school_id: school.id },
      paranoid: false,
    });
    assert.equal(withDeleted, 2);
  });

  it('enforces a unique email per tenant across all roles', async () => {
    const school = await createSchool();
    await createUser(school.id, UserRole.SCHOOL_ADMIN, { email: 'shared@example.test' });
    await assert.rejects(
      createUser(school.id, UserRole.PARENT, { email: 'shared@example.test' }),
      /unique|duplicate/i,
    );
  });

  it('allows the same email in two different tenants', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    await createUser(schoolA.id, UserRole.PARENT, { email: 'parent@example.test' });
    const other = await createUser(schoolB.id, UserRole.PARENT, { email: 'parent@example.test' });
    assert.equal(other.email, 'parent@example.test');
  });

  it('enforces one platform SUPER_ADMIN per email (partial unique index)', async () => {
    await createUser(null, UserRole.SUPER_ADMIN, { email: 'root@platform.test' });
    await assert.rejects(
      createUser(null, UserRole.SUPER_ADMIN, { email: 'root@platform.test' }),
      /unique|duplicate/i,
    );
  });

  it('enforces a unique stop sequence per route', async () => {
    const school = await createSchool();
    const route = await createRoute(school.id);
    await createStop(school.id, route.id, 1);
    await assert.rejects(createStop(school.id, route.id, 1), /unique|duplicate/i);
    const second = await createStop(school.id, route.id, 2);
    assert.equal(second.sequence_number, 2);
  });

  it('cascades a school delete to its tenant rows', async () => {
    const school = await createSchool();
    await createUser(school.id, UserRole.PARENT);
    await sequelize.query('DELETE FROM schools WHERE id = $id', { bind: { id: school.id } });
    const remaining = await User.unscoped().count({
      where: { school_id: school.id },
      paranoid: false,
    });
    assert.equal(remaining, 0);
  });
});
