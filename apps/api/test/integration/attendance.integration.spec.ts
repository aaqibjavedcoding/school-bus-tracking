import '../support/env';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import {
  TripAttendanceStatus,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createBus,
  createGuardianLink,
  createRoute,
  createSchool,
  createStop,
  createStudent,
  createTrip,
  createUser,
} from '../support/fixtures';
import { TripAttendanceService } from '../../src/modules/trip-attendance/trip-attendance.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import {
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripStudentAttendance,
} from '../../src/database/models';

const notificationsStub = {
  notifyStudentAttendance: async () => undefined,
} as unknown as NotificationsService;

/**
 * Attendance uniqueness and concurrency against a real database.
 *
 * Boarding the same student twice in parallel must not create two rows: the
 * service serializes with `SELECT … FOR UPDATE` inside a transaction, and the
 * partial unique index `uq_trip_student_attendance_trip_student` is the
 * database-level backstop. Neither can be verified with a mocked repository.
 */
describe('trip attendance (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  function makeService(): TripAttendanceService {
    return new TripAttendanceService(
      TripStudentAttendance,
      Trip,
      Stop,
      Student,
      StudentGuardian,
      RouteAssignment,
      notificationsStub,
    );
  }

  async function seedTrip() {
    const school = await createSchool();
    const driver = await createUser(school.id, UserRole.DRIVER);
    const parent = await createUser(school.id, UserRole.PARENT);
    const bus = await createBus(school.id);
    const route = await createRoute(school.id);
    const stop = await createStop(school.id, route.id);
    const student = await createStudent(school.id, stop.id);
    await createGuardianLink(school.id, student.id, parent.id);
    const trip = await createTrip(
      school.id,
      route.id,
      bus.id,
      driver.id,
      null,
      TripStatus.IN_PROGRESS,
    );
    return { school, driver, parent, student, trip, stop };
  }

  before(async () => {
    sequelize = await prepareDatabase();
  });

  beforeEach(async () => {
    await truncateAll(sequelize);
  });

  after(async () => {
    await sequelize?.close();
  });

  it('records exactly one attendance row per (trip, student)', async () => {
    const { school, driver, student, trip } = await seedTrip();
    const service = makeService();
    const actor = { id: driver.id, school_id: school.id, role: UserRole.DRIVER };

    await service.board(actor, trip.id, student.id);
    await assert.rejects(service.board(actor, trip.id, student.id), /already/i);

    assert.equal(
      await TripStudentAttendance.count({ where: { trip_id: trip.id, student_id: student.id } }),
      1,
    );
  });

  it('rejects a duplicate row at the database level', async () => {
    const { school, driver, student, trip, stop } = await seedTrip();
    const row = {
      school_id: school.id,
      trip_id: trip.id,
      student_id: student.id,
      stop_id: stop.id,
      status: TripAttendanceStatus.BOARDED,
      boarded_at: new Date(),
      boarded_by: driver.id,
      dropped_at: null,
      dropped_by: null,
    };
    await TripStudentAttendance.create({ id: randomUUID(), ...row } as never);
    await assert.rejects(
      TripStudentAttendance.create({ id: randomUUID(), ...row } as never),
      /unique|duplicate/i,
    );
  });

  it('two concurrent boardings of the same student → one row, one conflict', async () => {
    const { school, driver, student, trip } = await seedTrip();
    const actor = { id: driver.id, school_id: school.id, role: UserRole.DRIVER };

    const results = await Promise.allSettled([
      makeService().board(actor, trip.id, student.id),
      makeService().board(actor, trip.id, student.id),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(
      await TripStudentAttendance.count({ where: { trip_id: trip.id, student_id: student.id } }),
      1,
    );
    const row = await TripStudentAttendance.findOne({ where: { trip_id: trip.id } });
    assert.equal(row?.status, TripAttendanceStatus.BOARDED);
  });

  it('two concurrent drops after boarding → one drop, one conflict', async () => {
    const { school, driver, student, trip } = await seedTrip();
    const actor = { id: driver.id, school_id: school.id, role: UserRole.DRIVER };
    await makeService().board(actor, trip.id, student.id);

    const results = await Promise.allSettled([
      makeService().drop(actor, trip.id, student.id),
      makeService().drop(actor, trip.id, student.id),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);

    const row = await TripStudentAttendance.findOne({ where: { trip_id: trip.id } });
    assert.equal(row?.status, TripAttendanceStatus.DROPPED);
    assert.ok(row?.dropped_at);
  });

  it('never lets a crew member of another tenant mark attendance', async () => {
    const { student, trip } = await seedTrip();
    const otherSchool = await createSchool();
    const otherDriver = await createUser(otherSchool.id, UserRole.DRIVER);

    await assert.rejects(
      makeService().board(
        { id: otherDriver.id, school_id: otherSchool.id, role: UserRole.DRIVER },
        trip.id,
        student.id,
      ),
      /not found/i,
    );
    assert.equal(await TripStudentAttendance.count(), 0);
  });

  it('stores server-side timestamps and the acting user', async () => {
    const { school, driver, student, trip } = await seedTrip();
    const actor = { id: driver.id, school_id: school.id, role: UserRole.DRIVER };
    await makeService().board(actor, trip.id, student.id);

    const row = await TripStudentAttendance.findOne({ where: { trip_id: trip.id } });
    assert.equal(row?.boarded_by, driver.id);
    assert.ok(row?.boarded_at instanceof Date);
    assert.equal(row?.school_id, school.id);
  });
});
