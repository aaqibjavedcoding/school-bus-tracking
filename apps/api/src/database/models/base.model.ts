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
 * Shared base model for all tenant-owned entities.
 *
 * Provides:
 * - UUIDv4 primary key (`id`)
 * - Automatic `createdAt` / `updatedAt` timestamps
 * - Soft-delete support (`deletedAt`, `paranoid`)
 * - snake_case column mapping to match the migration-driven schema
 *
 * Concrete domain models (Tenant, School, Bus, Route, Student, ...) extend
 * this class in later Phase 2 tasks. Tenant/school isolation columns and
 * scopes will be introduced with those models — no business models are
 * defined in Task 1.
 */
export abstract class BaseModel extends Model<BaseModelAttributes> {
  @IsUUID(4)
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    field: 'id',
  })
  declare id: string;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
    field: 'created_at',
  })
  declare created_at: Date;

  @UpdatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
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
