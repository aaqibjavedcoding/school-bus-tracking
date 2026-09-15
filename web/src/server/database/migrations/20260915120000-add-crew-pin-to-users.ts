'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Adds the crew mobile-login PIN to `users` (Mobile-UX Phase 4).
 *
 * Drivers and conductors sign in to the phone app with a 4-digit PIN instead of
 * an email + password. Two nullable columns are added:
 *
 * - `pin_hash`       — bcrypt digest of the PIN, produced by the same
 *                      `hashPassword()` / cost factor 12 the password path uses
 *                      (`web/src/server/auth/password.util.ts`). **The plaintext
 *                      PIN is never stored, never logged and never returned by
 *                      any API.** Like `password_hash` it is excluded from the
 *                      model's default scope and stripped in `toJSON()`.
 * - `pin_updated_at` — when the PIN was last set or reset. Not derivable from
 *                      `updated_at` (which moves on any profile edit), and the
 *                      admin console shows it next to "PIN set".
 *
 * A second CHECK constraint keeps the two columns in step: either both are set or
 * both are null. That is not bookkeeping for its own sake — see "Why the pair is
 * constrained together" below.
 *
 * ### Why on `users` and not a crew-specific table
 *
 * A PIN is a *credential of a user*, exactly like `password_hash`, and the login
 * path already resolves a tenant-scoped `users` row before comparing anything.
 * A separate `crew_pins` table would need its own `(school_id, user_id)`
 * composite foreign key, its own lifecycle on user deletion, and a second query
 * on the hot login path — all to hold one column that belongs beside the other
 * one. The role restriction is enforced instead by a CHECK constraint below,
 * which is stronger than a separate table would have been: the database itself
 * refuses to store a PIN for a PARENT, SCHOOL_ADMIN or SUPER_ADMIN.
 *
 * ### Why the pair is constrained together
 *
 * The staff list has to tell an administrator *which* crew members still need a
 * PIN issued. `pin_hash` is excluded from the model's default scope (as
 * `password_hash` is), so the projection cannot read it — and widening the scope,
 * or running an `unscoped()` query per page, would pull every driver's bcrypt
 * digest into application memory to answer a yes/no question. That is a bad
 * trade for a badge.
 *
 * `pin_updated_at` *is* scope-visible, and `CrewAuthService.setPin()` already
 * writes and clears it exactly alongside `pin_hash`. So the projection derives
 * `pin_set` from it. This constraint is what upgrades that from a convention the
 * service happens to follow into an invariant the database enforces: no direct
 * SQL, import job or future refactor can leave the two disagreeing, and
 * therefore no UI can ever report a PIN that does not exist or hide one that
 * does.
 *
 * Every existing row has both columns NULL, so the constraint holds on arrival.
 *
 * ### Effect on existing rows
 *
 * Both columns are nullable with no default, so every existing user — including
 * every existing driver and conductor — keeps `pin_hash IS NULL` and simply has
 * no PIN until an administrator sets one. Nothing is backfilled and no existing
 * login path changes: `POST /auth/login` still reads `password_hash` only.
 *
 * ### Reversibility
 *
 * `down` drops both CHECK constraints and both columns, in reverse order. PIN
 * hashes are lost, which is the intended semantics of a rollback (they are
 * unrecoverable by design and can be re-issued from the admin console). No
 * other column, index or foreign key on `users` is touched.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn(
      'users',
      'pin_hash',
      {
        // Same width as `password_hash`: a bcrypt digest is 60 characters, and
        // the extra headroom keeps a future work-factor/algorithm change from
        // needing another migration.
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.addColumn(
      'users',
      'pin_updated_at',
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
      { transaction },
    );

    // Defence in depth: the PIN login endpoint is role-gated in the service
    // layer, and this makes the same rule a data invariant. Safe to add because
    // `users.role` is never mutated in place anywhere in the application —
    // staff, parents and school admins are created role-pinned and every query
    // is filtered by role, so no legitimate flow can trip the constraint.
    await queryInterface.sequelize.query(
      `ALTER TABLE "users"
         ADD CONSTRAINT "ck_users_pin_hash_crew_only"
         CHECK ("pin_hash" IS NULL OR "role" IN ('DRIVER', 'CONDUCTOR'));`,
      { transaction },
    );

    // Ties `pin_updated_at` to `pin_hash` so the staff projection can derive
    // `pin_set` from the scope-visible column. Postgres compares the two
    // null-tests as booleans, which reads as exactly the rule intended: both
    // set, or both null.
    await queryInterface.sequelize.query(
      `ALTER TABLE "users"
         ADD CONSTRAINT "ck_users_pin_hash_matches_pin_updated_at"
         CHECK (("pin_hash" IS NULL) = ("pin_updated_at" IS NULL));`,
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "ck_users_pin_hash_matches_pin_updated_at";`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "ck_users_pin_hash_crew_only";`,
      { transaction },
    );

    await queryInterface.removeColumn('users', 'pin_updated_at', { transaction });
    await queryInterface.removeColumn('users', 'pin_hash', { transaction });
  });
}
