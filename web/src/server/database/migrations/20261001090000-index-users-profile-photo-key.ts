'use strict';

import type { QueryInterface } from 'sequelize';
import { Op } from 'sequelize';

/**
 * Indexes the lookup the profile-photo **read** route performs.
 *
 * `GET /api/v1/crew-photos/{key…}` serves bytes only after proving that a
 * `users` row *inside the caller's tenant* references exactly the requested
 * storage key — `WHERE school_id = :tenant AND profile_photo_key = :key`
 * (`AccountService.readProfilePhotoByKey`). That check is the whole tenant
 * isolation of the route, so it runs on every avatar a parent screen paints;
 * without an index it is a sequential scan of the tenant's users on each one,
 * and the cheapest way to make a security check get quietly relaxed later is
 * to leave it slow.
 *
 * Partial on purpose: only rows that actually have a photo are indexed, which
 * is a small minority of `users` and keeps the index tiny. The leading
 * `school_id` matches the lookup's own ordering and every other index on this
 * table (`uq_users_school_id`, `idx_users_school_role`).
 *
 * Reversible and touching nothing else: `down` drops exactly this index.
 */
export const PROFILE_PHOTO_KEY_INDEX = 'idx_users_school_profile_photo_key';

export async function up(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.addIndex('users', ['school_id', 'profile_photo_key'], {
      name: PROFILE_PHOTO_KEY_INDEX,
      // Sequelize renders `{ [Op.ne]: null }` as `IS NOT NULL`, which is the
      // predicate a partial index needs here.
      where: { profile_photo_key: { [Op.ne]: null } },
      transaction,
    });
  });
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeIndex('users', PROFILE_PHOTO_KEY_INDEX, { transaction });
  });
}
