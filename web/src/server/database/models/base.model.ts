import {
  Column,
  CreatedAt,
  DataType,
  DeletedAt,
  IsUUID,
  Model,
  PrimaryKey,
  UpdatedAt,
} from 'sequelize-typescript';

/**
 * Common attributes inherited by every database model.
 */
export interface BaseModelAttributes {
  id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Attribute keys managed by the ORM itself.
 *
 * Callers may omit them on create/update: `id` is generated as a UUIDv4 and
 * `created_at` / `updated_at` / `deleted_at` are maintained by the timestamp
 * and paranoid (soft delete) options enabled on every model.
 */
export type BaseModelManagedFields = 'id' | 'created_at' | 'updated_at' | 'deleted_at';

/**
 * Shared base model for all tenant-owned entities.
 *
 * Provides:
 * - UUIDv4 primary key (`id`)
 * - Automatic `createdAt` / `updatedAt` timestamps
 * - Soft-delete support (`deletedAt`, `paranoid`)
 * - snake_case column mapping to match the migration-driven schema
 *
 * The class is generic so that concrete domain models get fully typed
 * attributes and creation payloads:
 *
 * ```ts
 * export class School extends BaseModel<SchoolAttributes, SchoolCreationAttributes> {}
 * ```
 *
 * Both type parameters are defaulted, therefore `BaseModel` on its own still
 * behaves exactly as before (`Model<BaseModelAttributes, BaseModelAttributes>`).
 *
 * The physical schema is migration-driven — models are never synced.
 */
export abstract class BaseModel<
  TAttributes extends BaseModelAttributes = BaseModelAttributes,
  TCreationAttributes extends object = TAttributes,
> extends Model<TAttributes, TCreationAttributes> {
  @IsUUID(4)
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    field: 'id',
  })
  declare id: string;

  /**
   * `allowNull` is deliberately NOT declared on the timestamp attributes.
   * Sequelize fills timestamps *after* `bulkCreate` validation, and models
   * that disable a mapping (`updatedAt: false`, e.g. the append-only audit
   * log) still carry the attribute — a model-level NOT NULL would fail
   * validation for rows the database itself accepts and defaults correctly.
   * The physical NOT NULL constraints live in the migrations.
   */
  @CreatedAt
  @Column({
    type: DataType.DATE,
    field: 'created_at',
  })
  declare created_at: Date;

  @UpdatedAt
  @Column({
    type: DataType.DATE,
    field: 'updated_at',
  })
  declare updated_at: Date;

  @DeletedAt
  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'deleted_at',
  })
  declare deleted_at: Date | null;
}
