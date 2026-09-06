import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QueryTypes } from 'sequelize';
import { RouteAssignmentRole, UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import {
  prepareDatabase,
  runMigrations,
  undoMigration,
  undoThroughMigration,
} from '../support/database';

const BACKFILL_MIGRATION = '20260906120400-backfill-default-runs';
import {
  createAssignment,
  createBus,
  createRoute,
  createSchool,
  createStop,
  createStudent,
  createTrip,
  createUser,
} from '../support/fixtures';

/**
 * The default-run backfill (`20260906120400-backfill-default-runs`), verified
 * against a real PostgreSQL.
 *
 * This is the migration the whole operating-model refactor rests on: it is what
 * makes `1 route = 1 run = the behaviour before the refactor` true for every
 * tenant that already had data. If it loses a roster row, misattributes a bus,
 * or cannot be reversed, an operator's existing schedule silently changes.
 *
 * The fixture is built to be awkward on purpose — a route whose roster names one
 * bus, one whose roster names two, one with no roster at all, a soft-deleted
 * route, an inactive route, two soft-deleted assignments that share a natural
 * key, and a route code reused by a soft-deleted sibling in the same tenant plus
 * a second tenant using the same codes again.
 *
 * The sequence is migrate → seed → `db:migrate:undo --name <backfill>`
 * (reverting only the backfill, even though later migrations were applied on
 * top of it) → `db:migrate`, using the project's own sequelize-cli runner, so
 * what is under test is the real migration file rather than a re-implementation
 * of it.
 */
describe('default-run backfill (real PostgreSQL)', () => {
  let sequelize: Sequelize;

  /** Route ids, keyed by the shape each one represents. */
  const R: Record<string, string> = {};
  let schoolA = '';
  let schoolB = '';
  let assignmentsBefore = 0;

  const count = async (sql: string, replacements: Record<string, unknown> = {}): Promise<number> =>
    Number(
      (
        await sequelize.query<{ c: string }>(sql, {
          type: QueryTypes.SELECT,
          replacements,
        })
      )[0].c,
    );

  before(async () => {
    sequelize = await prepareDatabase();

    // ---------------------------------------------------------------- fixture
    const school = await createSchool({ name: 'Backfill A' });
    schoolA = school.id;
    const other = await createSchool({ name: 'Backfill B' });
    schoolB = other.id;

    const driver1 = await createUser(schoolA, UserRole.DRIVER);
    const driver2 = await createUser(schoolA, UserRole.DRIVER);
    const driver3 = await createUser(schoolA, UserRole.DRIVER);
    const conductor = await createUser(schoolA, UserRole.CONDUCTOR);
    const bus1 = await createBus(schoolA);
    const bus2 = await createBus(schoolA);
    const bus3 = await createBus(schoolA);

    // One bus on the roster.
    const oneBus = await createRoute(schoolA, { name: 'One bus', code: 'BF-01' });
    // Two different buses on the roster -> the bus is ambiguous.
    const twoBuses = await createRoute(schoolA, { name: 'Two buses', code: 'BF-02' });
    // No roster at all.
    const noRoster = await createRoute(schoolA, { name: 'No roster', code: 'BF-03' });
    // Soft-deleted, but with history that must still resolve.
    const deleted = await createRoute(schoolA, {
      name: 'Soft deleted',
      code: 'BF-04',
      deleted_at: new Date('2026-08-01T00:00:00Z'),
    });
    // Inactive.
    const inactive = await createRoute(schoolA, {
      name: 'Inactive',
      code: 'BF-05',
      is_active: false,
    });
    // Same code as `oneBus`, legal only because this one is soft-deleted.
    const codeTwin = await createRoute(schoolA, {
      name: 'Code twin',
      code: 'BF-01',
      deleted_at: new Date('2026-08-02T00:00:00Z'),
    });
    // A second tenant reusing the same codes.
    const foreign = await createRoute(schoolB, { name: 'Foreign', code: 'BF-01' });

    R.oneBus = oneBus.id;
    R.twoBuses = twoBuses.id;
    R.noRoster = noRoster.id;
    R.deleted = deleted.id;
    R.inactive = inactive.id;
    R.codeTwin = codeTwin.id;
    R.foreign = foreign.id;

    await createAssignment(schoolA, oneBus.id, bus1.id, driver1.id, RouteAssignmentRole.DRIVER);
    await createAssignment(
      schoolA,
      oneBus.id,
      bus1.id,
      conductor.id,
      RouteAssignmentRole.CONDUCTOR,
    );
    await createAssignment(schoolA, twoBuses.id, bus1.id, driver1.id, RouteAssignmentRole.DRIVER);
    await createAssignment(schoolA, twoBuses.id, bus2.id, driver2.id, RouteAssignmentRole.DRIVER);
    await createAssignment(schoolA, deleted.id, bus2.id, driver2.id, RouteAssignmentRole.DRIVER);
    await createAssignment(schoolA, inactive.id, bus3.id, driver3.id, RouteAssignmentRole.DRIVER);
    // Two soft-deleted rows sharing (route, user, role, effective_from): the
    // partial unique index allows it, and the backfill must keep both.
    for (const updatedAt of ['2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z']) {
      await createAssignment(schoolA, oneBus.id, bus1.id, driver3.id, RouteAssignmentRole.DRIVER, {
        deleted_at: new Date('2026-08-03T00:00:00Z'),
        updated_at: new Date(updatedAt),
      });
    }

    const stopOnOneBus = await createStop(schoolA, oneBus.id);
    const stopOnNoRoster = await createStop(schoolA, noRoster.id);
    await createStudent(schoolA, stopOnOneBus.id, { admission_number: 'BF-A1' });
    await createStudent(schoolA, stopOnNoRoster.id, { admission_number: 'BF-A2' });
    // Enrolled but not yet allocated transport.
    await createStudent(schoolA, null, { admission_number: 'BF-A3' });

    await createTrip(schoolA, oneBus.id, bus1.id, driver1.id, conductor.id);
    await createTrip(schoolA, twoBuses.id, bus1.id, driver1.id);

    const foreignBus = await createBus(schoolB);
    const foreignDriver = await createUser(schoolB, UserRole.DRIVER);
    await createTrip(schoolB, foreign.id, foreignBus.id, foreignDriver.id);

    assignmentsBefore = await count('SELECT count(*) c FROM route_assignments');

    // ------------------------------------------------- rewind to pre-backfill
    // The schema stays; only the backfilled data is removed. That is exactly the
    // state an existing production database is in the moment before the
    // migration runs.
    undoMigration(BACKFILL_MIGRATION);
  });

  after(async () => {
    // Leave the shared test database fully migrated for the next suite.
    runMigrations();
    await sequelize?.close();
  });

  it('starts from a database with routes but no runs', async () => {
    assert.ok(assignmentsBefore >= 8, 'the fixture roster should be in place');
    assert.equal(await count('SELECT count(*) c FROM runs'), 0);
    assert.equal(await count('SELECT count(*) c FROM run_crew'), 0);
    assert.equal(await count('SELECT count(*) c FROM trips WHERE run_id IS NOT NULL'), 0);
    assert.equal(await count('SELECT count(*) c FROM students WHERE run_id IS NOT NULL'), 0);
  });

  it('creates exactly one default run per route, including soft-deleted ones', async () => {
    runMigrations();

    assert.equal(await count('SELECT count(*) c FROM routes'), 7);
    assert.equal(await count('SELECT count(*) c FROM runs'), 7);
    assert.equal(await count('SELECT count(*) c FROM runs WHERE is_default'), 7);
    assert.equal(
      await count(
        `SELECT count(*) c FROM routes r
          WHERE NOT EXISTS (SELECT 1 FROM runs x WHERE x.route_id = r.id AND x.is_default)`,
      ),
      0,
      'every route must have a default run',
    );
    assert.equal(
      await count(
        `SELECT count(*) c FROM (
           SELECT route_id FROM runs WHERE is_default AND deleted_at IS NULL
            GROUP BY route_id HAVING count(*) > 1) d`,
      ),
      0,
      'no route may have two default runs',
    );
  });

  it('copies is_active and deleted_at across, and leaves shift_id null', async () => {
    const rows = await sequelize.query<{ route_id: string; is_active: boolean; deleted: boolean; shift_id: string | null }>(
      'SELECT route_id, is_active, (deleted_at IS NOT NULL) AS deleted, shift_id FROM runs',
      { type: QueryTypes.SELECT },
    );
    const byRoute = new Map(rows.map((row) => [row.route_id, row]));

    assert.equal(byRoute.get(R.deleted)?.deleted, true, 'a soft-deleted route gets a soft-deleted run');
    assert.equal(byRoute.get(R.inactive)?.is_active, false, 'an inactive route gets an inactive run');
    assert.equal(byRoute.get(R.oneBus)?.is_active, true);
    assert.equal(
      rows.every((row) => row.shift_id === null),
      true,
      'no shifts existed yet, so the backfill must not invent one',
    );
  });

  it('takes the bus only when the roster is unambiguous about it', async () => {
    const busOf = async (routeId: string): Promise<string | null> =>
      (
        await sequelize.query<{ bus_id: string | null }>(
          'SELECT bus_id FROM runs WHERE route_id = :routeId',
          { type: QueryTypes.SELECT, replacements: { routeId } },
        )
      )[0].bus_id;

    assert.ok(await busOf(R.oneBus), 'a single bus on the roster is carried over');
    assert.equal(await busOf(R.twoBuses), null, 'two different buses is ambiguous -> left null');
    assert.equal(await busOf(R.noRoster), null, 'no roster -> no bus');
    assert.ok(await busOf(R.deleted), 'a soft-deleted route still resolves its bus');
    assert.ok(await busOf(R.inactive), 'an inactive route still resolves its bus');
  });

  it('copies the route code verbatim and never collides', async () => {
    assert.equal(
      await count(
        `SELECT count(*) c FROM runs r JOIN routes rt ON rt.id = r.route_id
          WHERE r.code <> rt.code`,
      ),
      0,
      'the run code must equal its route code',
    );
    assert.equal(
      await count(
        `SELECT count(*) c FROM (
           SELECT school_id, code FROM runs WHERE deleted_at IS NULL
            GROUP BY school_id, code HAVING count(*) > 1) d`,
      ),
      0,
      'no two live runs of one tenant may share a code',
    );
    // The soft-deleted code twin and the second tenant both reuse BF-01.
    assert.equal(await count(`SELECT count(*) c FROM runs WHERE code = 'BF-01'`), 3);
  });

  it('copies the roster onto run_crew with no loss', async () => {
    assert.equal(
      await count('SELECT count(*) c FROM run_crew'),
      assignmentsBefore,
      'one run_crew row per route_assignments row',
    );
    assert.equal(
      await count(
        `SELECT count(*) c FROM route_assignments ra
           JOIN runs r ON r.school_id = ra.school_id AND r.route_id = ra.route_id AND r.is_default
           JOIN run_crew rc
             ON rc.run_id = r.id
            AND rc.user_id = ra.user_id
            AND rc.role::text = ra.role::text
            AND rc.effective_from = ra.effective_from
            AND rc.effective_to IS NOT DISTINCT FROM ra.effective_to
            AND rc.is_active = ra.is_active
            AND rc.deleted_at IS NOT DISTINCT FROM ra.deleted_at
            AND rc.updated_at = ra.updated_at`,
      ),
      assignmentsBefore,
      'every roster row must have an exact column-by-column twin',
    );
    // The two soft-deleted rows sharing a natural key must both survive the
    // idempotency guard.
    assert.equal(
      await count(
        `SELECT count(*) c FROM run_crew rc JOIN runs r ON r.id = rc.run_id
          WHERE r.route_id = :routeId AND rc.deleted_at IS NOT NULL`,
        { routeId: R.oneBus },
      ),
      2,
    );
  });

  it('re-attaches every trip to its route’s default run', async () => {
    assert.equal(await count('SELECT count(*) c FROM trips WHERE run_id IS NULL'), 0);
    assert.equal(
      await count(
        `SELECT count(*) c FROM trips t
          WHERE NOT EXISTS (
            SELECT 1 FROM runs r
             WHERE r.id = t.run_id AND r.route_id = t.route_id AND r.is_default)`,
      ),
      0,
    );
  });

  it('assigns allocated pupils to their home stop’s run, and leaves the rest alone', async () => {
    assert.equal(
      await count(
        `SELECT count(*) c FROM students s JOIN stops st ON st.id = s.home_stop_id
          WHERE s.run_id IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM runs r
                WHERE r.id = s.run_id AND r.route_id = st.route_id AND r.is_default)`,
      ),
      0,
    );
    assert.equal(
      await count(
        `SELECT count(*) c FROM students WHERE home_stop_id IS NULL AND run_id IS NOT NULL`,
      ),
      0,
      'an unallocated pupil must stay unassigned',
    );
  });

  it('is idempotent — replaying it changes nothing', async () => {
    const before = {
      runs: await count('SELECT count(*) c FROM runs'),
      crew: await count('SELECT count(*) c FROM run_crew'),
      trips: await count('SELECT count(*) c FROM trips WHERE run_id IS NOT NULL'),
      students: await count('SELECT count(*) c FROM students WHERE run_id IS NOT NULL'),
    };

    // Replay the backfill's own statements in place (the migrator will not
    // re-run a recorded migration, so this exercises the guards directly).
    await sequelize.query(
      `INSERT INTO runs (id, school_id, route_id, shift_id, bus_id, code,
                         is_default, is_active, created_at, updated_at, deleted_at)
       SELECT gen_random_uuid(), r.school_id, r.id, NULL, rb.bus_id, r.code,
              true, r.is_active, now(), now(), r.deleted_at
         FROM routes r
         LEFT JOIN (
           SELECT school_id, route_id, MIN(bus_id::text)::uuid AS bus_id
             FROM route_assignments
            WHERE deleted_at IS NULL AND bus_id IS NOT NULL
            GROUP BY school_id, route_id
           HAVING COUNT(DISTINCT bus_id) = 1
         ) rb ON rb.school_id = r.school_id AND rb.route_id = r.id
        WHERE NOT EXISTS (
          SELECT 1 FROM runs x WHERE x.school_id = r.school_id AND x.route_id = r.id)`,
    );
    await sequelize.query(
      `INSERT INTO run_crew (id, school_id, run_id, user_id, role, effective_from,
                             effective_to, is_active, created_at, updated_at, deleted_at)
       SELECT gen_random_uuid(), ra.school_id, r.id, ra.user_id,
              ra.role::text::"enum_run_crew_role", ra.effective_from, ra.effective_to,
              ra.is_active, ra.created_at, ra.updated_at, ra.deleted_at
         FROM route_assignments ra
         JOIN runs r
           ON r.school_id = ra.school_id AND r.route_id = ra.route_id AND r.is_default
        WHERE NOT EXISTS (
          SELECT 1 FROM run_crew rc
           WHERE rc.run_id = r.id AND rc.user_id = ra.user_id
             AND rc.role::text = ra.role::text
             AND rc.effective_from = ra.effective_from
             AND rc.deleted_at IS NOT DISTINCT FROM ra.deleted_at
             AND rc.updated_at = ra.updated_at)`,
    );

    assert.deepEqual(
      {
        runs: await count('SELECT count(*) c FROM runs'),
        crew: await count('SELECT count(*) c FROM run_crew'),
        trips: await count('SELECT count(*) c FROM trips WHERE run_id IS NOT NULL'),
        students: await count('SELECT count(*) c FROM students WHERE run_id IS NOT NULL'),
      },
      before,
    );
  });

  it('reverses exactly, leaving the original roster untouched', async () => {
    undoMigration(BACKFILL_MIGRATION);

    assert.equal(await count('SELECT count(*) c FROM runs'), 0);
    assert.equal(await count('SELECT count(*) c FROM run_crew'), 0);
    assert.equal(await count('SELECT count(*) c FROM trips WHERE run_id IS NOT NULL'), 0);
    assert.equal(await count('SELECT count(*) c FROM students WHERE run_id IS NOT NULL'), 0);

    // Zero data loss means the source rows are still exactly as they were.
    assert.equal(
      await count('SELECT count(*) c FROM route_assignments'),
      assignmentsBefore,
      'the backfill never writes to route_assignments',
    );
    assert.equal(await count('SELECT count(*) c FROM trips'), 3);
    assert.equal(await count('SELECT count(*) c FROM students'), 3);
    assert.equal(await count('SELECT count(*) c FROM routes'), 7);

    // The schema survives a data-only rollback.
    assert.equal(
      await count(
        `SELECT count(*) c FROM pg_tables
          WHERE schemaname = 'public' AND tablename IN ('shifts','runs','run_crew')`,
      ),
      3,
    );
  });

  it('reproduces the same result when applied a second time', async () => {
    runMigrations();
    assert.equal(await count('SELECT count(*) c FROM runs'), 7);
    assert.equal(await count('SELECT count(*) c FROM run_crew'), assignmentsBefore);
    assert.equal(await count('SELECT count(*) c FROM trips WHERE run_id IS NULL'), 0);
  });

  /**
   * Verifies `undoThroughMigration(name)` (undoMigration(name) + runMigrations)
   * correctly targets the backfill's down() — even though later migrations now
   * sit on top of it — and restores a clean migrated state. This is the
   * canonical use of the helper: undo one migration and immediately re-apply
   * everything, ending up at the same state as a fresh `runMigrations()` call.
   */
  it('undoThroughMigration reverts and re-applies the backfill cleanly', async () => {
    // Apply the backfill on top of whatever state the database is in (it may
    // already be migrated from a previous test in this suite).
    runMigrations();
    assert.ok((await count('SELECT count(*) c FROM runs')) > 0, 'precondition: backfill applied');

    // undoThroughMigration = undoMigration(name) + runMigrations. The
    // `reverses exactly` test above observes the down() result in isolation;
    // here the helper must leave the database fully migrated again.
    undoThroughMigration(BACKFILL_MIGRATION);

    assert.equal(await count('SELECT count(*) c FROM runs'), 7);
    assert.equal(await count('SELECT count(*) c FROM run_crew'), assignmentsBefore);
    assert.equal(await count('SELECT count(*) c FROM routes'), 7);
    assert.equal(
      await count('SELECT count(*) c FROM route_assignments'),
      assignmentsBefore,
      'route_assignments is untouched',
    );
  });
});
