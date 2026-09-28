import { Sequelize } from 'sequelize-typescript';
import { models } from './models';
import { BaseModel } from './models/base.model';

/** The three timestamp attributes `BaseModel` maps on every model. */
export const BASE_MODEL_TIMESTAMP_COLUMNS = ['created_at', 'updated_at', 'deleted_at'] as const;

/**
 * Physical table names of every model that inherits `BaseModel`.
 *
 * Those tables **must** carry all three timestamp columns, even when the
 * model disables writing them (`updatedAt: false` / `deletedAt: false`):
 * Sequelize still names every mapped attribute in the `RETURNING` clause it
 * appends to PostgreSQL INSERTs, so a missing column makes `Model.create()`
 * fail with `column "…" does not exist`.
 *
 * Resolving the names needs an initialized registry, so this attaches the
 * models to a throwaway, never-connected Sequelize instance. It performs no
 * I/O and is intended for schema guards (unit and integration).
 */
export function baseModelTableNames(): string[] {
  const registry = new Sequelize({ dialect: 'postgres', models: [...models], logging: false });

  const tables = new Set<string>();
  for (const model of Object.values(registry.models)) {
    if (!(model.prototype instanceof BaseModel)) {
      continue;
    }
    tables.add(String(model.getTableName()));
  }

  return [...tables].sort();
}
