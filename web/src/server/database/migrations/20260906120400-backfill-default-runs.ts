'use strict';

import type { QueryInterface } from 'sequelize';

/**
 * Backfill — gives every existing route its **default run**, then re-attaches
 * everything that used to hang off the route to that run.
 *
 * This is the back-compatibility step of the operating-model refactor
 * (`docs/operating-model.md` §6). The invariant it establishes is:
 *
 *   1 route = 1 default run = exactly today's behaviour.
 *
 * An operator who does nothing after this migration sees no difference: the
 * same buses, the same crews, the same parent-facing route codes. What changes
 * is that the model can now express a *second* run on the same route, which is
 * what tiering needs.
 *
 * ## Zero data loss
 *
 * Nothing is deleted and no column is dropped. Every statement below is a copy
 * or a pointer, and each one is idempotent, so a partially applied or manually
 * replayed migration cannot duplicate rows:
 *
 * 1. **one run per route** — `code` is copied verbatim from `routes.code`
 *    (parent-facing continuity: "bus R-01" means the same thing before and
 *    after, and it is collision-free by construction because
 *    `uq_routes_school_code` already makes live route codes unique per school).
 *    `is_active` and `deleted_at` are copied too, so a soft-deleted route's run
 *    is soft-deleted and its history still resolves. `bus_id` is taken from the
 *    route's roster **only when every non-deleted assignment on that route
 *    agrees on exactly one bus** — `HAVING COUNT(DISTINCT bus_id) = 1` — because
 *    copying an ambiguous bus would invent a dispatch decision nobody made.
 *    `shift_id` stays `NULL`: these schools have no shifts yet, and inventing a
 *    synthetic one inside a data migration would write reference data no
 *    operator chose. A `NULL` shift is treated by the Session 2 conflict rules
 *    as occupying the whole day, which reproduces today's behaviour exactly.
 * 2. **trips** — each trip points at its route's default run (1:1, because step
 *    1 creates exactly one run per route).
 * 3. **roster** — every `route_assignments` row is copied onto `run_crew`
 *    against that route's default run. All columns are copied 1:1, including
 *    `created_at`, `updated_at` **and** `deleted_at`, so the copy is a faithful
 *    snapshot of the roster as it stood, soft-deleted history included.
 * 4. **students** — `run_id` is set from the pupil's home stop:
 *    `home_stop → stops.route_id → that route's default run`. This is not an
 *    inference; it is the link the system already derived implicitly (a
 *    student's bus *was* their home stop's route's bus), now stored. Pupils
 *    with no `home_stop_id` are unallocated and stay `NULL`.
 *
 * `route_assignments` is **not** modified. It remains the audit record of what
 * the roster was; `docs/operating-model.md` §6.3 sets out when it stops being
 * written.
 *
 * ## Notes on the SQL
 *
 * - `gen_random_uuid()` is built into PostgreSQL 13+; the deployment target is
 *   PostgreSQL 16 (`infrastructure/docker-compose.yml` pins
 *   `postgis/postgis:16-3.4`).
 * - `MIN(bus_id::text)::uuid` casts because PostgreSQL has no `min(uuid)`
 *   aggregate — the `uuid` type has btree operators but is not registered with
 *   the min/max aggregates. The `HAVING COUNT(DISTINCT bus_id) = 1` guard means
 *   every row in the group holds the same value, so *any* aggregate over it
 *   returns that value; the text round-trip only makes one available.
 * - `ra.role::text::enum_run_crew_role` is a deliberate double cast: the two
 *   role columns use *different* enum types (see
 *   `20260906120200-create-run-crew.ts`), so a direct assignment is rejected.
 * - `updated_at` is bumped on the `trips` / `students` rows this migration
 *   touches, because the row genuinely changed. The `run_crew` copy keeps the
 *   source `updated_at` — it is part of the snapshot, and it is also what makes
 *   the anti-join below an exact natural key.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // ---------------------------------------------------------------------
    // 1. One default run per route.
    //
    // `WHERE NOT EXISTS` keeps this idempotent even if the statement is
    // replayed by hand; `SequelizeMeta` already records the migration once.
    // ---------------------------------------------------------------------
    await queryInterface.sequelize.query(
      `INSERT INTO "runs" (
         "id", "school_id", "route_id", "shift_id", "bus_id", "code",
         "is_default", "is_active", "created_at", "updated_at", "deleted_at"
       )
       SELECT gen_random_uuid(),
              r."school_id",
              r."id",
              NULL,
              rb."bus_id",
              r."code",
              true,
              r."is_active",
              now(),
              now(),
              r."deleted_at"
         FROM "routes" r
         LEFT JOIN (
           SELECT "school_id",
                  "route_id",
                  MIN("bus_id"::text)::uuid AS "bus_id"
             FROM "route_assignments"
            WHERE "deleted_at" IS NULL
              AND "bus_id" IS NOT NULL
            GROUP BY "school_id", "route_id"
           HAVING COUNT(DISTINCT "bus_id") = 1
         ) rb
           ON rb."school_id" = r."school_id"
          AND rb."route_id" = r."id"
        WHERE NOT EXISTS (
          SELECT 1 FROM "runs" x
           WHERE x."school_id" = r."school_id"
             AND x."route_id" = r."id"
        );`,
      { transaction },
    );

    // ---------------------------------------------------------------------
    // 2. Point every trip at its route's default run.
    // ---------------------------------------------------------------------
    await queryInterface.sequelize.query(
      `UPDATE "trips" t
          SET "run_id" = r."id",
              "updated_at" = now()
         FROM "runs" r
        WHERE r."is_default" = true
          AND r."school_id" = t."school_id"
          AND r."route_id" = t."route_id"
          AND t."run_id" IS NULL;`,
      { transaction },
    );

    // ---------------------------------------------------------------------
    // 3. Copy the roster onto `run_crew`.
    //
    // The anti-join matches the full natural key *including* `deleted_at` and
    // `updated_at`, so two soft-deleted rows that share
    // (run, user, role, effective_from) both survive — nothing is silently
    // swallowed by the idempotency guard.
    // ---------------------------------------------------------------------
    await queryInterface.sequelize.query(
      `INSERT INTO "run_crew" (
         "id", "school_id", "run_id", "user_id", "role",
         "effective_from", "effective_to", "is_active",
         "created_at", "updated_at", "deleted_at"
       )
       SELECT gen_random_uuid(),
              ra."school_id",
              r."id",
              ra."user_id",
              ra."role"::text::"enum_run_crew_role",
              ra."effective_from",
              ra."effective_to",
              ra."is_active",
              ra."created_at",
              ra."updated_at",
              ra."deleted_at"
         FROM "route_assignments" ra
         JOIN "runs" r
           ON r."school_id" = ra."school_id"
          AND r."route_id" = ra."route_id"
          AND r."is_default" = true
        WHERE NOT EXISTS (
          SELECT 1 FROM "run_crew" rc
           WHERE rc."run_id" = r."id"
             AND rc."user_id" = ra."user_id"
             AND rc."role"::text = ra."role"::text
             AND rc."effective_from" = ra."effective_from"
             AND rc."deleted_at" IS NOT DISTINCT FROM ra."deleted_at"
             AND rc."updated_at" = ra."updated_at"
        );`,
      { transaction },
    );

    // ---------------------------------------------------------------------
    // 4. Attach pupils to the run their home stop already implied.
    // ---------------------------------------------------------------------
    await queryInterface.sequelize.query(
      `UPDATE "students" s
          SET "run_id" = r."id",
              "updated_at" = now()
         FROM "stops" st
         JOIN "runs" r
           ON r."school_id" = st."school_id"
          AND r."route_id" = st."route_id"
          AND r."is_default" = true
        WHERE s."home_stop_id" IS NOT NULL
          AND st."id" = s."home_stop_id"
          AND st."school_id" = s."school_id"
          AND s."run_id" IS NULL;`,
      { transaction },
    );
  });
}

/**
 * Removes exactly what {@link up} added, in dependency order.
 *
 * Hand-created runs (Session 2 and later) and their crew are left alone, and
 * `route_assignments` — which `up` never touched — is left alone too. The
 * `run_crew` delete matches on the same full natural key the insert's
 * anti-join used, so only mirrored rows go.
 */
export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `UPDATE "students"
          SET "run_id" = NULL
        WHERE "run_id" IN (SELECT "id" FROM "runs" WHERE "is_default" = true);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `UPDATE "trips"
          SET "run_id" = NULL
        WHERE "run_id" IN (SELECT "id" FROM "runs" WHERE "is_default" = true);`,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `DELETE FROM "run_crew" rc
        USING "route_assignments" ra, "runs" r
        WHERE r."id" = rc."run_id"
          AND r."is_default" = true
          AND ra."school_id" = rc."school_id"
          AND ra."route_id" = r."route_id"
          AND ra."user_id" = rc."user_id"
          AND ra."role"::text = rc."role"::text
          AND ra."effective_from" = rc."effective_from"
          AND ra."deleted_at" IS NOT DISTINCT FROM rc."deleted_at"
          AND ra."updated_at" = rc."updated_at";`,
      { transaction },
    );

    await queryInterface.sequelize.query(`DELETE FROM "runs" WHERE "is_default" = true;`, {
      transaction,
    });
  });
}
