import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { RouteAssignmentRole, UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createRoute,
  createRun,
  createRunCrew,
  createSchool,
  createShift,
  createStop,
  createStudent,
  createTrip,
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

  // -------------------------------------------------------------------------
  // Operating model: shifts, runs, run crew
  // (docs/operating-model.md §3 — only PostgreSQL can prove these.)
  // -------------------------------------------------------------------------

  it('rejects a shift window that does not end after it starts (ck_shifts_window)', async () => {
    const school = await createSchool();
    const shift = await createShift(school.id, { start_time: '07:00:00', end_time: '11:00:00' });
    assert.equal(shift.start_time.slice(0, 8), '07:00:00');

    await assert.rejects(
      createShift(school.id, { start_time: '11:00:00', end_time: '07:00:00' }),
      /ck_shifts_window|check/i,
    );
    await assert.rejects(
      createShift(school.id, { start_time: '09:00:00', end_time: '09:00:00' }),
      /ck_shifts_window|check/i,
    );
  });

  it('allows several runs on one route — that is tiering', async () => {
    const school = await createSchool();
    const route = await createRoute(school.id);
    const bus = await createBus(school.id);
    const morning = await createShift(school.id, { name: 'AM', start_time: '07:00:00', end_time: '11:00:00' });
    const afternoon = await createShift(school.id, { name: 'PM', start_time: '12:00:00', end_time: '17:00:00' });

    // The same bus in two disjoint windows is the point of the refactor.
    await createRun(school.id, route.id, { shift_id: morning.id, bus_id: bus.id, code: 'T-1' });
    const second = await createRun(school.id, route.id, {
      shift_id: afternoon.id,
      bus_id: bus.id,
      code: 'T-2',
    });
    assert.equal(second.route_id, route.id);
  });

  it('refuses a second default run on the same route (uq_runs_route_default)', async () => {
    const school = await createSchool();
    const route = await createRoute(school.id);
    await createRun(school.id, route.id, { code: 'D-1', is_default: true });
    await assert.rejects(
      createRun(school.id, route.id, { code: 'D-2', is_default: true }),
      /uq_runs_route_default|unique|duplicate/i,
    );
    // A non-default run alongside it is fine.
    await createRun(school.id, route.id, { code: 'D-3' });
  });

  it('enforces a unique live run code per tenant, and releases it on soft delete', async () => {
    const school = await createSchool();
    const other = await createSchool();
    const route = await createRoute(school.id);

    const run = await createRun(school.id, route.id, { code: 'BUS-7' });
    await assert.rejects(
      createRun(school.id, route.id, { code: 'BUS-7' }),
      /uq_runs_school_code|unique|duplicate/i,
    );
    // A different tenant may reuse the code — it is what a parent reads.
    const foreignRoute = await createRoute(other.id);
    const foreign = await createRun(other.id, foreignRoute.id, { code: 'BUS-7' });
    assert.equal(foreign.code, 'BUS-7');

    await run.destroy();
    const replacement = await createRun(school.id, route.id, { code: 'BUS-7' });
    assert.notEqual(replacement.id, run.id);
  });

  it('refuses to attach a run to another tenant’s route (composite FK)', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const routeB = await createRoute(schoolB.id);
    await assert.rejects(createRun(schoolA.id, routeB.id, { code: 'X' }), /foreign key|violates/i);
  });

  it('refuses to roster crew from another tenant onto a run (composite FK)', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const route = await createRoute(schoolA.id);
    const run = await createRun(schoolA.id, route.id);
    const foreignDriver = await createUser(schoolB.id, UserRole.DRIVER);

    await assert.rejects(
      createRunCrew(schoolA.id, run.id, foreignDriver.id),
      /foreign key|violates/i,
    );
  });

  it('enforces one roster row per person, role and start date — and releases it on soft delete', async () => {
    const school = await createSchool();
    const route = await createRoute(school.id);
    const run = await createRun(school.id, route.id);
    const driver = await createUser(school.id, UserRole.DRIVER);
    const conductor = await createUser(school.id, UserRole.CONDUCTOR);

    const roster = await createRunCrew(school.id, run.id, driver.id, RouteAssignmentRole.DRIVER);
    await assert.rejects(
      createRunCrew(school.id, run.id, driver.id, RouteAssignmentRole.DRIVER),
      /uq_run_crew_run_user_role|unique|duplicate/i,
    );
    // The driver + conductor pair on the same run is legal.
    await createRunCrew(school.id, run.id, conductor.id, RouteAssignmentRole.CONDUCTOR);
    // So is the same person on a different start date (rotation).
    await createRunCrew(school.id, run.id, driver.id, RouteAssignmentRole.DRIVER, {
      effective_from: '2026-06-01',
    });

    await roster.destroy();
    const replacement = await createRunCrew(school.id, run.id, driver.id, RouteAssignmentRole.DRIVER);
    assert.notEqual(replacement.id, roster.id);
  });

  it('refuses a roster period that ends before it starts (ck_run_crew_effective_range)', async () => {
    const school = await createSchool();
    const route = await createRoute(school.id);
    const run = await createRun(school.id, route.id);
    const driver = await createUser(school.id, UserRole.DRIVER);

    await assert.rejects(
      sequelize.query(
        `INSERT INTO run_crew (id, school_id, run_id, user_id, role, effective_from,
                               effective_to, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), :school, :run, :user, 'DRIVER'::"enum_run_crew_role",
                 '2026-06-01', '2026-01-01', true, now(), now())`,
        { replacements: { school: school.id, run: run.id, user: driver.id } },
      ),
      /ck_run_crew_effective_range|check/i,
    );
  });

  it('refuses two trips of one run at the same departure', async () => {
    const school = await createSchool();
    const route = await createRoute(school.id);
    const run = await createRun(school.id, route.id);
    const bus = await createBus(school.id);
    const driver = await createUser(school.id, UserRole.DRIVER);
    const departure = new Date('2026-09-20T07:00:00Z');

    const first = await createTrip(school.id, route.id, bus.id, driver.id, null, undefined, departure, run.id);
    assert.equal(first.run_id, run.id);
    // A run belongs to exactly one route, so this clash is caught by whichever
    // of `uq_trips_run_scheduled_start` / `uq_trips_route_scheduled_start`
    // PostgreSQL reaches first — see docs/operating-model.md §3.6.
    await assert.rejects(
      createTrip(school.id, route.id, bus.id, driver.id, null, undefined, departure, run.id),
      /uq_trips_(run|route)_scheduled_start|unique|duplicate/i,
    );
  });

  it('refuses to point a student at another tenant’s run (composite FK)', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const routeB = await createRoute(schoolB.id);
    const runB = await createRun(schoolB.id, routeB.id);

    await assert.rejects(
      sequelize.query(
        `INSERT INTO students (id, school_id, run_id, admission_number, first_name,
                               last_name, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), :school, :run, 'ADM-X', 'Kid', 'Test', true, now(), now())`,
        { replacements: { school: schoolA.id, run: runB.id } },
      ),
      /fk_students_run|foreign key|violates/i,
    );
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
