'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Seeder skeleton (TypeScript).
 *
 * Seeders use CommonJS-compatible named exports because Umzug loads them via
 * `require()`. Seed data for local development / test environments belongs in
 * the seeders directory and is applied with `npm run db:seed`.
 */
export async function up(
  _queryInterface: QueryInterface,
  _Sequelize: typeof DataTypes,
): Promise<void> {
  // Seed data, e.g.:
  // await queryInterface.bulkInsert('table_name', [...], {});
}

export async function down(
  _queryInterface: QueryInterface,
  _Sequelize: typeof DataTypes,
): Promise<void> {
  // Remove seeded data, e.g.:
  // await queryInterface.bulkDelete('table_name', {});
}
