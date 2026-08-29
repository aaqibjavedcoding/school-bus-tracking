import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { NotificationType } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Student } from './student.model';
import { Trip } from './trip.model';
import { User } from './user.model';

export interface NotificationAttributes extends BaseModelAttributes {
  school_id: string;
  /** The recipient parent account's User.id. */
  user_id: string;
  type: NotificationType;
  /** Trip the event happened on, when the event is trip-scoped. */
  trip_id: string | null;
  /** Child the event is about, when the event is student-scoped. */
  student_id: string | null;
  title: string;
  message: string;
  /** Event-specific extra data (student name, trip status, …). */
  payload: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
}

export type NotificationCreationAttributes = Optional<
  NotificationAttributes,
  BaseModelManagedFields | 'trip_id' | 'student_id' | 'payload' | 'is_read' | 'read_at'
>;

/**
 * One notification for exactly one recipient parent.
 *
 * Ownership is denormalised onto the row itself: `(school_id, user_id)` is
 * the only key the read APIs accept, and both values are derived from the
 * verified JWT — a client can never pass a user or tenant in. All entity
 * references are tenant-pinned composite foreign keys in the migration
 * (`(school_id, user_id) → users`, `(school_id, trip_id) → trips`,
 * `(school_id, student_id) → students`), so a row can never mix records of
 * different schools at the database boundary.
 *
 * Rows are immutable once created except for the read bookkeeping
 * (`is_read` / `read_at`); soft deletion preserves the audit trail.
 */
@Table({
  tableName: 'notifications',
  modelName: 'Notification',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Hot path of the parent list endpoint: one parent's notifications,
    // newest first, plus the unread-count aggregation.
    {
      name: 'idx_notifications_school_user_read_created',
      fields: ['school_id', 'user_id', 'is_read', 'created_at'],
    },
    // "All notifications of one parent, newest first" (no read filter).
    {
      name: 'idx_notifications_school_user_created',
      fields: ['school_id', 'user_id', 'created_at'],
    },
    // Debug/cleanup lookups by trip or by child.
    { name: 'idx_notifications_school_trip', fields: ['school_id', 'trip_id'] },
    { name: 'idx_notifications_school_student', fields: ['school_id', 'student_id'] },
  ],
})
export class Notification extends BaseModel<
  NotificationAttributes,
  NotificationCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({
    type: DataType.ENUM(...Object.values(NotificationType)),
    allowNull: false,
  })
  declare type: NotificationType;

  @ForeignKey(() => Trip)
  @Column({ type: DataType.UUID, allowNull: true })
  declare trip_id: string | null;

  @ForeignKey(() => Student)
  @Column({ type: DataType.UUID, allowNull: true })
  declare student_id: string | null;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare title: string;

  @Column({ type: DataType.STRING(500), allowNull: false })
  declare message: string;

  @Column({ type: DataType.JSON, allowNull: true })
  declare payload: Record<string, unknown> | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare is_read: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  declare read_at: Date | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;

  @BelongsTo(() => Student, { foreignKey: 'student_id', as: 'student' })
  declare student?: Student;
}
