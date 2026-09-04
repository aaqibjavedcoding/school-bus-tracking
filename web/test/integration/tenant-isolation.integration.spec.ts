import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PlanLimitResource, UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createPlan,
  createRoute,
  createSchool,
  createStop,
  createStudent,
  createSubscription,
  createTrip,
  createUser,
} from '../support/fixtures';
import { BusesService } from '../../src/server/modules/buses/buses.service';
import { StudentsService } from '../../src/server/modules/students/students.service';
import { PlanLimitsService } from '../../src/server/common/plan-limits';
import {
  Bus,
  Plan,
  Route,
  RouteAssignment,
  SchoolSubscription,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../src/server/database/models';

/**
 * Tenant isolation verified against a real database.
 *
 * Unit tests can only prove that a service *passes* a `school_id` to a stub.
 * These tests run the real services over real rows of two tenants, so a
 * missing `where` clause or a leaking association shows up immediately.
 */
describe('tenant isolation (real PostgreSQL)', () => {
  let sequelize: Sequelize;
  let planLimits: PlanLimitsService;
  let buses: BusesService;
  let students: StudentsService;

  before(async () => {
    sequelize = await prepareDatabase();
    planLimits = new PlanLimitsService(
      SchoolSubscription,
      Plan,
      Student,
      Bus,
      Route,
      Stop,
      User,
      Trip,
      sequelize,
    );
    buses = new BusesService(Bus, RouteAssignment, Route, User, Trip, planLimits);
    students = new StudentsService(
      Student,
      Stop,
      StudentGuardian,
      Route,
      RouteAssignment,
      Bus,
      planLimits,
    );
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  it('never lists another tenant\'s buses', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    await createBus(schoolA.id);
    await createBus(schoolB.id);

    const listA = await buses.findAll(schoolA.id, { page: 1, limit: 20 });
    assert.equal(listA.items.length, 1);
    assert.ok(listA.items.every((bus: { school_id: string }) => bus.school_id === schoolA.id));
  });

  it('returns the generic 404 for another tenant\'s bus (no existence disclosure)', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const busB = await createBus(schoolB.id);

    await assert.rejects(buses.findOne(schoolA.id, busB.id), (error: { message?: string }) => {
      assert.match(String(error.message), /not found/i);
      return true;
    });
    // The row is untouched: nothing was leaked and nothing was modified.
    assert.ok(await Bus.findOne({ where: { id: busB.id, school_id: schoolB.id } }));
  });

  it('cannot update or delete across tenants', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const busB = await createBus(schoolB.id);

    await assert.rejects(buses.update(schoolA.id, busB.id, { capacity: 1 }), /not found/i);
    await assert.rejects(buses.remove(schoolA.id, busB.id), /not found/i);

    const reloaded = await Bus.findByPk(busB.id);
    assert.equal(reloaded?.capacity, 40);
  });

  it('forces school_id on create even when the tenant argument is the only source', async () => {
    const schoolA = await createSchool();
    const created = await buses.create(schoolA.id, {
      registration_number: 'REG-TENANT-1',
      capacity: 20,
    } as never);
    const row = await Bus.findByPk(created.id);
    assert.equal(row?.school_id, schoolA.id);
  });

  it('refuses to attach a student to a stop of another tenant', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const routeB = await createRoute(schoolB.id);
    const stopB = await createStop(schoolB.id, routeB.id);

    await assert.rejects(
      students.create(schoolA.id, {
        admission_number: 'ADM-X',
        first_name: 'A',
        last_name: 'B',
        home_stop_id: stopB.id,
      } as never),
      /does not belong to this school/i,
    );
  });

  it('counts plan usage per tenant only', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    await createStudent(schoolA.id);
    await createStudent(schoolA.id);
    await createStudent(schoolB.id);

    assert.equal(await planLimits.countUsage(schoolA.id, PlanLimitResource.STUDENTS), 2);
    assert.equal(await planLimits.countUsage(schoolB.id, PlanLimitResource.STUDENTS), 1);
  });

  it('does not count soft-deleted or deactivated resources towards the plan', async () => {
    const school = await createSchool();
    const keep = await createStudent(school.id);
    const deactivated = await createStudent(school.id);
    const deleted = await createStudent(school.id);

    await deactivated.update({ is_active: false });
    await deleted.destroy();

    assert.equal(await planLimits.countUsage(school.id, PlanLimitResource.STUDENTS), 1);
    assert.ok(keep.is_active);
  });

  it('resolves the live plan of the requested school only', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 3 },
    });
    await createSubscription(schoolA.id, plan.id);

    assert.equal((await planLimits.resolveLivePlan(schoolA.id))?.id, plan.id);
    assert.equal(await planLimits.resolveLivePlan(schoolB.id), null);
  });

  it('keeps trips, routes and crew of two tenants separate', async () => {
    const schoolA = await createSchool();
    const schoolB = await createSchool();
    const routeA = await createRoute(schoolA.id);
    const routeB = await createRoute(schoolB.id);
    const busA = await createBus(schoolA.id);
    const busB = await createBus(schoolB.id);
    const driverA = await createUser(schoolA.id, UserRole.DRIVER);
    const driverB = await createUser(schoolB.id, UserRole.DRIVER);
    await createTrip(schoolA.id, routeA.id, busA.id, driverA.id);
    await createTrip(schoolB.id, routeB.id, busB.id, driverB.id);

    const tripsA = await Trip.findAll({ where: { school_id: schoolA.id } });
    assert.equal(tripsA.length, 1);
    assert.equal(tripsA[0].route_id, routeA.id);
  });
});
