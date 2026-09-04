'use strict';

import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

/**
 * Migration skeleton (TypeScript).
 *
 * Migrations use CommonJS-compatible named exports because Umzug loads them
 * via `require()`. Schema changes are applied exclusively through migrations —
 * never call `sequelize.sync()`.
 *
 * Naming: <14-digit-timestamp>-<kebab-case-name>.ts (created automatically by
 * `npm run migration:create -- <kebab-case-name>`).
 */
export async function up(
  _queryInterface: QueryInterface,
  _Sequelize: typeof DataTypes,
): Promise<void> {
  // Forward migration commands, e.g.:
  // await queryInterface.createTable('table_name', { ... });
}

export async function down(
  _queryInterface: QueryInterface,
  _Sequelize: typeof DataTypes,
): Promise<void> {
  // Revert migration commands, e.g.:
  // await queryInterface.dropTable('table_name');
}
