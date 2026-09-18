import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Op, Optional } from 'sequelize';
import { NotificationType, type ExternalDeliveryStatus } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Stop } from './stop.model';
import { Student } from './student.model';
import { Trip } from './trip.model';
import { User } from './user.model';

export type { ExternalDeliveryStatus } from '@school-bus-tracking/shared-types';

export interface NotificationAttributes extends BaseModelAttributes {
  school_id: string;
  /** The recipient parent account's User.id. */
  user_id: string;
  type: NotificationType;
  /** Trip the event happened on, when the event is trip-scoped. */
  trip_id: string | null;
  /** Child the event is about, when the event is student-scoped. */
  student_id: string | null;
  /** Stop the event is about, when the event is stop-scoped (Task 22 arrivals). */
  stop_id: string | null;
  title: string;
  message: string;
  /** Event-specific extra data (student name, trip status, …). */
  payload: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  /** Push (FCM) delivery state; see migration 20260901140000. */
  push_status: ExternalDeliveryStatus;
  email_status: ExternalDeliveryStatus;
  sms_status: ExternalDeliveryStatus;
  /** How many push delivery attempts this row has made (0 = never attempted). */
  delivery_retry_count: number;
  last_delivery_attempt_at: Date | null;
  delivery_failure_reason: string | null;
  /** Next time the outbox may attempt this row again (Phase 2). */
  next_attempt_at: Date | null;
  /** Last delivery failure, classified retryable vs permanent (Phase 2). */
  delivery_failure_kind: 'transient' | 'permanent' | null;
  /** Server deadline after which the outbox stops trying (event expiry). */
  push_expires_at: Date | null;
  /**
   * Device tokens the provider *accepted* the push for, accumulated across
   * every attempt of the row (accepted ≠ displayed on the phone).
   */
  delivered_tokens: string[] | null;
  /**
   * Device tokens still owed a provider-accepted delivery (the per-device
   * retry state). `null` before the first attempt — the worker then targets
   * every currently active device of the recipient.
   */
  delivery_pending_tokens: string[] | null;
  /** Human-readable reason when delivery was abandoned (expired/permanent). */
  delivery_abandoned_reason: string | null;
  /** Stable natural key of the event (null for legacy rows). */
  dedup_key: string | null;
}

export type NotificationCreationAttributes = Optional<
  NotificationAttributes,
  | BaseModelManagedFields
  | 'trip_id'
  | 'student_id'
  | 'stop_id'
  | 'payload'
  | 'is_read'
  | 'read_at'
  | 'push_status'
  | 'email_status'
  | 'sms_status'
  | 'delivery_retry_count'
  | 'last_delivery_attempt_at'
  | 'delivery_failure_reason'
  | 'delivery_failure_kind'
  | 'push_expires_at'
  | 'delivered_tokens'
  | 'delivery_pending_tokens'
  | 'delivery_abandoned_reason'
  | 'next_attempt_at'
  | 'dedup_key'
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
    // Stop-scoped notifications (Task 22 arrivals) and their composite FK.
    { name: 'idx_notifications_school_stop', fields: ['school_id', 'stop_id'] },
    // Outbox hot path: the next due push-safe rows of a school (advisory
    // lock pinned to the school so worker instances cannot trample).
    // `email_status='not_configured'` is the sentinel for @school-keyed locks.
    {
      name: 'idx_notifications_outbox_school',
      fields: ['school_id', 'email_status', 'push_status', 'next_attempt_at'],
    },
    {
      name: 'idx_notifications_outbox_due',
      fields: ['push_status', 'next_attempt_at'],
    },
    // Phase 2 idempotency backstop: one notification per (school, user,
    // type) event key — a retried creation can never produce two rows.
    {
      name: 'uq_notifications_dedup',
      unique: true,
      fields: ['school_id', 'user_id', 'dedup_key'],
      // `deleted_at IS NULL` keeps soft-deleted rows from blocking a
      // legitimate re-creation; `dedup_key` is null on legacy rows. This
      // must match the migration's partial-unique predicate exactly.
      where: { deleted_at: null, dedup_key: { [Op.ne]: null } },
    },
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

  @ForeignKey(() => Stop)
  @Column({ type: DataType.UUID, allowNull: true })
  declare stop_id: string | null;

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

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'pending' })
  declare push_status: ExternalDeliveryStatus;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'not_configured' })
  declare email_status: ExternalDeliveryStatus;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'not_configured' })
  declare sms_status: ExternalDeliveryStatus;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare delivery_retry_count: number;

  @Column({ type: DataType.DATE, allowNull: true })
  declare last_delivery_attempt_at: Date | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare delivery_failure_reason: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true })
  declare delivery_failure_kind: 'transient' | 'permanent' | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare next_attempt_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare push_expires_at: Date | null;

  @Column({ type: DataType.ARRAY(DataType.STRING(1024)), allowNull: true })
  declare delivered_tokens: string[] | null;

  @Column({ type: DataType.ARRAY(DataType.STRING(1024)), allowNull: true })
  declare delivery_pending_tokens: string[] | null;

  @Column({ type: DataType.STRING(200), allowNull: true })
  declare delivery_abandoned_reason: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  declare dedup_key: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;

  @BelongsTo(() => Student, { foreignKey: 'student_id', as: 'student' })
  declare student?: Student;

  @BelongsTo(() => Stop, { foreignKey: 'stop_id', as: 'stop' })
  declare stop?: Stop;
}
