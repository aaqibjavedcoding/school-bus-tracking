import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Student } from './student.model';
import { User } from './user.model';

export interface StudentGuardianAttributes extends BaseModelAttributes {
  school_id: string;
  student_id: string;
  /** The parent account's User.id. The user must have role PARENT. */
  user_id: string;
  /** Human-readable relationship, e.g. Mother, Father or Legal guardian. */
  relationship: string;
  /** Whether the account is authorised to collect the student. */
  can_pick_up: boolean;
  /** Whether this is the primary contact for the student. */
  is_primary: boolean;
  is_active: boolean;
}

export type StudentGuardianCreationAttributes = Optional<
  StudentGuardianAttributes,
  BaseModelManagedFields | 'can_pick_up' | 'is_primary' | 'is_active'
>;

/**
 * Tenant-scoped many-to-many link between a student and a parent account.
 *
 * `school_id` is deliberately denormalised onto the join row and both entity
 * references are tenant-pinned composite foreign keys in the migration:
 * `(school_id, student_id) -> students(school_id, id)` and
 * `(school_id, user_id) -> users(school_id, id)`. This means a malformed
 * application query cannot connect records from different schools at the
 * database boundary.
 *
 * The partial unique index prevents an active duplicate relationship while
 * allowing a soft-deleted link to be recreated later. Soft deletion preserves
 * the relationship audit trail and does not remove either account or student.
 */
@Table({
  tableName: 'student_guardians',
  modelName: 'StudentGuardian',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      name: 'uq_student_guardians_school_student_user',
      unique: true,
      fields: ['school_id', 'student_id', 'user_id'],
      where: { deleted_at: null },
    },
    { name: 'idx_student_guardians_school_student', fields: ['school_id', 'student_id'] },
    { name: 'idx_student_guardians_school_user', fields: ['school_id', 'user_id'] },
    {
      name: 'idx_student_guardians_school_active',
      fields: ['school_id', 'is_active'],
    },
  ],
})
export class StudentGuardian extends BaseModel<
  StudentGuardianAttributes,
  StudentGuardianCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Student)
  @Column({ type: DataType.UUID, allowNull: false })
  declare student_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({ type: DataType.STRING(50), allowNull: false })
  declare relationship: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare can_pick_up: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare is_primary: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Student, { foreignKey: 'student_id', as: 'student' })
  declare student?: Student;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'parent' })
  declare parent?: User;
}
