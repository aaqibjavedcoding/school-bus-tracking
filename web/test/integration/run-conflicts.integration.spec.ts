import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UniqueConstraintError } from 'sequelize';
import { ConfigService } from '../../src/server/framework';
import { RouteAssignmentRole, RunCrewRole, UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createPlan,
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
import { PlanLimitsService } from '../../src/server/common/plan-limits';
import { RunsService } from '../../src/server/modules/runs/runs.service';
import { RunCrewService } from '../../src/server/modules/run-crew/run-crew.service';
import { ShiftsService } from '../../src/server/modules/shifts/shifts.service';
import { StudentsService } from '../../src/server/modules/students/students.service';
import { CreateRunDto } from '../../src/server/modules/runs/dto/create-run.dto';
import { CreateShiftDto } from '../../src/server/modules/shifts/dto/create-shift.dto';
import { CreateRunCrewDto } from '../../src/server/modules/run-crew/dto/create-run-crew.dto';
import { ListRunCrewQueryDto } from '../../src/server/modules/run-crew/dto/list-run-crew-query.dto';
import { SHIFT_DELETED_MESSAGE } from '../../src/server/modules/shifts/shifts.constants';
import { CreateStudentDto } from '../../src/server/modules/students/dto/create-student.dto';
import { UpdateStudentDto } from '../../src/server/modules/students/dto/update-student.dto';
import { STUDENT_RUN_ROUTE_MISMATCH_MESSAGE } from '../../src/server/modules/students/students.constants';
import {
  Bus,
  Plan,
  Route,
  RouteAssignment,
  Run,
  RunCrew,
  SchoolSubscription,
  Shift,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../src/server/database/models';

function configStub(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: <T>(key: string, fallback?: T) => (key in values ? (values[key] as T) : (fallback as T)),
  } as unknown as ConfigService;
}

/**
 * The §4 conflict engine and the `run_id` write paths, driven through the real
 * services against a real PostgreSQL (`docs/operating-model.md` Phase 2/3
 * exit criteria: tiering is legal, same-window double-booking is not, and
 * `NULL`-shift runs still conflict with everything).
 *
 * The unit suites mock the repositories; this one exists for the parts a mock
 * cannot prove: that shift windows read back from `TIMESTAMPTZ`-free
 * `TIME`/`DATEONLY` columns still compare correctly through the engine, that
 * `uq_trips_run_scheduled_start` and `uq_trips_route_scheduled_start` both
 * stay enforced, and that the student cross-check works against the same rows
 * the dispatch path will later read.
 */
describe('run conflicts + run_id assignment (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  function services() {
    const planLimits = new PlanLimitsService(
      SchoolSubscription,
      Plan,
      Student,
      Bus,
      Route,
      Stop,
      User,
      Trip,
      Run,
      sequelize,
      configStub(),
    );
    const runs = new RunsService(Run, Route, Shift, Bus, RunCrew, User, Student, planLimits);
    const runCrew = new RunCrewService(RunCrew, Run, Route, User, Shift, RouteAssignment, sequelize);
    const students = new StudentsService(
      Student,
      Stop,
      StudentGuardian,
      Route,
      RouteAssignment,
      Bus,
      planLimits,
      Run,
    );
    return { runs, runCrew, students };
  }

  before(async () => {
    sequelize = await prepareDatabase();
  });

  after(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
    // A plan row so PlanLimitsService has its reference data (unlimited).
    await createPlan();
  });

  async function makeTenantFixture() {
    const school = await createSchool();
    const route1 = await createRoute(school.id);
    const route2 = await createRoute(school.id);
    const bus = await createBus(school.id);
    const driver = await createUser(school.id, UserRole.DRIVER);
    const conductor = await createUser(school.id, UserRole.CONDUCTOR);
    const morning = await createShift(school.id, {
      name: 'Morning',
      start_time: '07:00:00',
      end_time: '11:00:00',
    });
    const afternoon = await createShift(school.id, {
      name: 'Afternoon',
      start_time: '12:00:00',
      end_time: '17:00:00',
    });
    const overlapping = await createShift(school.id, {
      name: 'Late Morning',
      start_time: '10:00:00',
      end_time: '13:00:00',
    });
    return { school, route1, route2, bus, driver, conductor, morning, afternoon, overlapping };
  }

  function runDto(overrides: Partial<CreateRunDto> = {}): CreateRunDto {
    return Object.assign(new CreateRunDto(), {
      route_id: 'missing',
      ...overrides,
    }) as CreateRunDto;
  }

  it('accepts one bus tiered across disjoint shift windows (§4.2 BUS)', async () => {
    const { runs } = services();
    const f = await makeTenantFixture();

    await runs.create(f.school.id, runDto({ route_id: f.route1.id, bus_id: f.bus.id, shift_id: f.morning.id, code: 'T-A' }));
    const second = await runs.create(
      f.school.id,
      runDto({ route_id: f.route2.id, bus_id: f.bus.id, shift_id: f.afternoon.id, code: 'T-B' }),
    );
    assert.equal(second.bus_id, f.bus.id);
    const count = await Run.count({ where: { school_id: f.school.id } as never });
    assert.equal(count, 2);
  });

  it('rejects the same bus on overlapping windows (the pre-refactor rule, kept)', async () => {
    const { runs } = services();
    const f = await makeTenantFixture();
    await runs.create(f.school.id, runDto({ route_id: f.route1.id, bus_id: f.bus.id, shift_id: f.morning.id, code: 'O-A' }));
    await assert.rejects(
      runs.create(f.school.id, runDto({ route_id: f.route2.id, bus_id: f.bus.id, shift_id: f.overlapping.id, code: 'O-B' })),
      (error: unknown) => (error as { status: number }).status === 409,
    );
  });

  it('treats a NULL-shift run as the whole day — both directions (§4.3)', async () => {
    const { runs } = services();
    const f = await makeTenantFixture();

    // A whole-day run first…
    await createRun(f.school.id, f.route1.id, { bus_id: f.bus.id, shift_id: null, code: 'D-0' });
    await assert.rejects(
      runs.create(
        f.school.id,
        runDto({ route_id: f.route2.id, bus_id: f.bus.id, shift_id: f.afternoon.id, code: 'D-1' }),
      ),
      (error: unknown) => (error as { status: number }).status === 409,
    );

    // …and second: same result, no ordering escape hatch.
    const school2 = await createSchool();
    const bus2 = await createBus(school2.id);
    const r1 = await createRoute(school2.id);
    const r2 = await createRoute(school2.id);
    await runs.create(
      school2.id,
      runDto({ route_id: r1.id, bus_id: bus2.id, shift_id: f.morning.id, code: 'E-1' }),
    );
    await assert.rejects(
      runs.create(school2.id, runDto({ route_id: r2.id, bus_id: bus2.id, code: 'E-2' })),
      (error: unknown) => (error as { status: number }).status === 409,
    );
  });

  it('CREW_RUN: one driver is legal across disjoint windows only', async () => {
    const { runs, runCrew } = services();
    const f = await makeTenantFixture();
    const morningRun = await runs.create(
      f.school.id,
      runDto({ route_id: f.route1.id, bus_id: f.bus.id, shift_id: f.morning.id, code: 'C-A' }),
    );
    const afternoonRun = await runs.create(
      f.school.id,
      runDto({ route_id: f.route2.id, bus_id: f.bus.id, shift_id: f.afternoon.id, code: 'C-B' }),
    );
    const overlappingRun = await runs.create(
      f.school.id,
      runDto({ route_id: f.route1.id, shift_id: f.overlapping.id, code: 'C-C' }),
    );

    const crewDto = (userId: string) => {
      const dto = new CreateRunCrewDto();
      dto.user_id = userId;
      dto.role = RouteAssignmentRole.DRIVER as never;
      dto.effective_from = '2026-01-01';
      return dto;
    };
    await runCrew.create(f.school.id, morningRun.id, crewDto(f.driver.id));
    // Afternoon on the same driver: tiering, legal.
    await runCrew.create(f.school.id, afternoonRun.id, crewDto(f.driver.id));
    // Overlapping window on the same driver: illegal (10:00–13:00 ∩ 12:00–17:00).
    await assert.rejects(
      runCrew.create(f.school.id, overlappingRun.id, crewDto(f.driver.id)),
      (error: unknown) => (error as { status: number }).status === 409,
    );
    // A second driver on the same run/role violates RUN_ROLE.
    const driver2 = await createUser(f.school.id, UserRole.DRIVER);
    await assert.rejects(
      runCrew.create(f.school.id, morningRun.id, crewDto(driver2.id)),
      (error: unknown) => (error as { status: number }).status === 409,
    );
    // …and the dual-write mirrored the accepted roster to route_assignments.
    const mirrored = await RouteAssignment.count({
      where: { school_id: f.school.id, user_id: f.driver.id } as never,
    });
    assert.ok(mirrored >= 2);
  });

  it('uq_trips_run_scheduled_start and the route index both reject double departures', async () => {
    const f = await makeTenantFixture();
    const runA = await createRun(f.school.id, f.route1.id, { bus_id: f.bus.id, code: 'TI-A' });
    const runB = await createRun(f.school.id, f.route1.id, { shift_id: f.afternoon.id, code: 'TI-B' });
    const start = new Date('2026-09-07T06:30:00.000Z');
    await createTrip(f.school.id, f.route1.id, f.bus.id, f.driver.id, null, undefined, start, runA.id);

    // Same run, same instant → run-level index (or, whichever the planner
    // reaches first, §3.6: the route index is still in force too).
    await assert.rejects(
      createTrip(f.school.id, f.route1.id, f.bus.id, f.driver.id, null, undefined, start, runA.id),
      (error: unknown) => error instanceof UniqueConstraintError,
    );
    // Different run of the same route, same instant → route-level index.
    await assert.rejects(
      createTrip(f.school.id, f.route1.id, f.bus.id, f.driver.id, null, undefined, start, runB.id),
      (error: unknown) => error instanceof UniqueConstraintError,
    );
    // Different run, different instant → legal (tiering of trips).
    const later = new Date('2026-09-07T12:30:00.000Z');
    const ok = await createTrip(
      f.school.id,
      f.route1.id,
      f.bus.id,
      f.conductor.id,
      null,
      undefined,
      later,
      runB.id,
    );
    assert.equal(ok.run_id, runB.id);
  });

  it('students.run_id: the §3.4 cross-check against the home-stop route', async () => {
    const { runs, students } = services();
    const f = await makeTenantFixture();
    const stopOnRoute1 = await createStop(f.school.id, f.route1.id);
    const stopOnRoute2 = await createStop(f.school.id, f.route2.id);
    const run = await runs.create(
      f.school.id,
      runDto({ route_id: f.route1.id, bus_id: f.bus.id, code: 'S-A' }),
    );

    const create = (stopId: string | null) => {
      const dto = new CreateStudentDto();
      dto.admission_number = `adm-${Math.random().toString(36).slice(2)}`;
      dto.first_name = 'Kid';
      dto.last_name = 'Test';
      dto.home_stop_id = stopId;
      dto.run_id = run.id;
      return dto;
    };

    const ok = await students.create(f.school.id, create(stopOnRoute1.id));
    assert.equal(ok.run_id, run.id);
    assert.equal(ok.run_code, 'S-A');

    await assert.rejects(
      students.create(f.school.id, create(stopOnRoute2.id)),
      (error: unknown) =>
        (error as { status: number }).status === 400 &&
        (error as { message: string }).message === STUDENT_RUN_ROUTE_MISMATCH_MESSAGE,
    );

    // Moving the stop off the run's route re-triggers the cross-check.
    await assert.rejects(
      students.update(
        f.school.id,
        ok.id,
        Object.assign(new UpdateStudentDto(), { home_stop_id: stopOnRoute2.id }),
      ),
      (error: unknown) =>
        (error as { message: string }).message === STUDENT_RUN_ROUTE_MISMATCH_MESSAGE,
    );

    // A pre-refactor student (created by fixture) can be allocated afterwards.
    const legacy = await createStudent(f.school.id, null);
    const patched = await students.update(
      f.school.id,
      legacy.id,
      Object.assign(new UpdateStudentDto(), { home_stop_id: stopOnRoute1.id, run_id: run.id }),
    );
    assert.equal(patched.run_id, run.id);

    // Unassigning is allowed and keeps the stop.
    const cleared = await students.update(
      f.school.id,
      legacy.id,
      Object.assign(new UpdateStudentDto(), { run_id: null }),
    );
    assert.equal(cleared.run_id, null);
    assert.equal(cleared.home_stop_id, stopOnRoute1.id);
  });

  it('shift lifecycle: a shift with live runs cannot be deleted (§8.1), then can once unused', async () => {
    const { runs } = services();
    const f = await makeTenantFixture();
    const shifts = new ShiftsService(Shift, Run);

    const run = await runs.create(
      f.school.id,
      runDto({ route_id: f.route1.id, bus_id: f.bus.id, shift_id: f.morning.id, code: 'L-A' }),
    );
    assert.equal(run.shift_id, f.morning.id);

    // A live run references the shift: the reference-data delete guard fires.
    await assert.rejects(
      shifts.remove(f.school.id, f.morning.id),
      (error: unknown) => (error as { status: number }).status === 409,
    );

    // Free the shift (delete the run — soft delete via paranoid model), then
    // the shift goes.
    await runs.remove(f.school.id, run.id);
    const result = await shifts.remove(f.school.id, f.morning.id);
    assert.equal(result.message, SHIFT_DELETED_MESSAGE);

    // Soft-deleted shift rows release their name (uq is partial).
    const recreated = await shifts.create(
      f.school.id,
      Object.assign(new CreateShiftDto(), {
        name: 'Morning',
        start_time: '07:00:00',
        end_time: '11:00:00',
      }),
    );
    assert.equal(recreated.name, 'Morning');
  });

  it('run-crew writes still mirror to route_assignments (the read-only legacy table)', async () => {
    const { runCrew } = services();
    const f = await makeTenantFixture();
    const run = await createRun(f.school.id, f.route1.id, {
      bus_id: f.bus.id,
      shift_id: f.morning.id,
      code: 'M-A',
    });

    const dto = new CreateRunCrewDto();
    dto.user_id = f.driver.id;
    dto.role = RunCrewRole.DRIVER;
    dto.effective_from = '2026-09-07';

    const created = await runCrew.create(f.school.id, run.id, dto);

    // The new table holds the roster of record…
    const roster = await runCrew.findAllForRun(f.school.id, run.id, new ListRunCrewQueryDto());
    assert.equal(roster.items.length, 1);
    assert.equal(roster.items[0].id, created.id);

    // …and the retired table stays a faithful readable mirror (§10).
    const mirrors = await RouteAssignment.findAll({
      where: { school_id: f.school.id, route_id: f.route1.id, deleted_at: null },
    });
    assert.equal(mirrors.length, 1);
    assert.equal(mirrors[0].user_id, f.driver.id);
    assert.equal(mirrors[0].bus_id, f.bus.id);
    assert.equal(String(mirrors[0].effective_from).slice(0, 10), '2026-09-07');

    // Deleting the roster row soft-deletes the mirror too — the mirror never
    // outlives its source.
    await runCrew.remove(f.school.id, created.id);
    const afterDelete = await RouteAssignment.findAll({
      where: { school_id: f.school.id, route_id: f.route1.id, deleted_at: null },
    });
    assert.equal(afterDelete.length, 0);
  });
});
