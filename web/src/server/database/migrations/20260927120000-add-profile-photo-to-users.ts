'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Adds crew profile-photo references to `users`.
 *
 * Two nullable columns:
 *
 * - `profile_photo_key`        — the storage key the configured
 *                                `DocumentStorageProvider` wrote the
 *                                validated photo bytes under (see
 *                                `web/src/server/modules/account`). It is a
 *                                *reference*, never a URL and never the
 *                                bytes themselves, so rotating storage or
 *                                re-keying blobs is a data move, not a
 *                                schema change.
 * - `profile_photo_updated_at` — when the photo was last set or cleared.
 *                                Kept apart from `updated_at` (which moves on
 *                                any profile edit), it lets clients
 *                                cache-bust the rendered photo and an audit
 *                                reader order "photo changed" against other
 *                                profile changes.
 *
 * Both columns are plain `NULL`-able columns with no default: every existing
 * user simply has no photo. The role restriction (DRIVER / CONDUCTOR only) is
 * enforced by the role guard on `PUT /api/v1/account/me/photo`, mirroring how
 * application-level guards gate every other self-service surface.
 *
 * ### No CHECK constraints
 *
 * Unlike the PIN pair, nothing here is a credential and no reporting query
 * derives state from the pair, so a database-level invariant would only
 * duplicate application logic. The service always writes the two columns
 * together (set stores key + timestamp, clear nulls both).
 *
 * ### Reversibility
 *
 * `down` drops both columns. Photo storage keys are lost, which is the
 * intended semantics of a rollback (the blobs in storage are
 * provider-managed and orphaned harmlessly). No other column, index,
 * constraint or foreign key on `users` is touched.
 */
export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addColumn(
      'users',
      'profile_photo_key',
      {
        // Storage keys embed school id, entity folder, user id, an 8-char
        // uniqueness fragment and a sanitised filename (≤ 200 chars); 512
        // leaves headroom for a provider switch without another migration.
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      { transaction },
    );

    await queryInterface.addColumn(
      'users',
      'profile_photo_updated_at',
      {
        type: DataTypes.DATE,
        allowNull: true,
      },
      { transaction },
    );
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeColumn('users', 'profile_photo_updated_at', {
      transaction,
    });
    await queryInterface.removeColumn('users', 'profile_photo_key', { transaction });
  });
}
