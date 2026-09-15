'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Creates the `crew_pairing_tokens` table (Mobile-UX Phase 4).
 *
 * Backs the QR half of crew login: a school administrator generates a
 * short-lived code for one driver or conductor, the admin console renders it as
 * a QR, the crew member scans it with the phone app, and the app redeems the
 * code for an ordinary session. A device that has never logged in before pairs
 * this way, which is what lets the 4-digit PIN path exist at all — the PIN is
 * always checked against the one user the device already paired with.
 *
 * Security & data integrity:
 *
 * - `token_hash` stores the **SHA-256 digest** of a 256-bit random token, the
 *   same construction `refresh_tokens` uses. The plaintext is returned to the
 *   administrator exactly once and is never persisted, so a later database read
 *   — or a leaked backup — cannot resurrect a live code.
 * - Single use is enforced by `consumed_at` plus the *unique* index on
 *   `token_hash`. Redemption is one atomic
 *   `UPDATE … WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > now()`;
 *   Postgres row locking means that of N concurrent scans of the same code,
 *   exactly one updates a row and the rest match zero. No read-then-write race.
 * - Short life is enforced by `expires_at` and checked in that same statement,
 *   so an expired code cannot be redeemed even if the application forgets to
 *   look at the clock.
 * - Multi-tenant isolation mirrors `refresh_tokens`: `school_id` references
 *   `schools(id)` and the composite foreign key `(school_id, user_id)`
 *   references `users(school_id, id)`, so a code can never pair a device to a
 *   user in a different tenant.
 *
 * ### Why a table and not the in-memory store
 *
 * The PIN attempt lockout is process-local (see `docs/security.md` → "Crew PIN
 * brute force"), which is acceptable because it is an abuse *throttle* — losing
 * it on a restart costs an attacker nothing an administrator would notice, and
 * the audit trail survives. A pairing code is different: it is a credential the
 * administrator reads off one screen and the driver scans on another, minutes
 * later. That must survive an app restart and must not be silently invalidated
 * by a deploy, so it lives in PostgreSQL — which also means this half of the
 * flow is correct under more than one API instance even though the lockout is
 * not.
 *
 * ### Cleanup
 *
 * Codes live for minutes, so this table never accumulates the way GPS or audit
 * rows do. The retention worker is deliberately **not** extended for it;
 * instead `CrewAuthService` supersedes a user's outstanding code whenever it
 * mints a new one and purges expired rows on the same write. The
 * `expires_at` index below is what makes that purge a range scan.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable(
      'crew_pairing_tokens',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        school_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'schools', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        user_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        token_hash: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        expires_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        consumed_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    // Tenant-pinned composite foreign key: (school_id, user_id) -> users(school_id, id)
    await queryInterface.sequelize.query(
      `ALTER TABLE "crew_pairing_tokens"
         ADD CONSTRAINT "fk_crew_pairing_tokens_user"
         FOREIGN KEY ("school_id", "user_id")
         REFERENCES "users" ("school_id", "id")
         ON UPDATE CASCADE
         ON DELETE CASCADE;`,
      { transaction },
    );

    // Unique digest for live records — also what makes single-use redemption
    // resolve to at most one row.
    await queryInterface.addIndex('crew_pairing_tokens', ['token_hash'], {
      name: 'uq_crew_pairing_tokens_token_hash',
      unique: true,
      where: { deleted_at: null },
      transaction,
    });

    // "Outstanding codes for this crew member" — the supersede + purge query.
    await queryInterface.addIndex('crew_pairing_tokens', ['school_id', 'user_id'], {
      name: 'idx_crew_pairing_tokens_school_user',
      transaction,
    });

    // Expired-code purge is a range scan on the clock.
    await queryInterface.addIndex('crew_pairing_tokens', ['expires_at'], {
      name: 'idx_crew_pairing_tokens_expires_at',
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // `dropTable` removes the columns, both indexes and the composite foreign
  // key with them, so the migration is fully reversible: nothing outside this
  // table is touched, and the crew PIN columns added by
  // 20260915120000-add-crew-pin-to-users are rolled back by that migration's
  // own `down`.
  await queryInterface.dropTable('crew_pairing_tokens');
}
