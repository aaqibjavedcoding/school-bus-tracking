import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { TRIP_ATTENDANCE_STATUS_VALUES, TripAttendanceStatus } from './enums';
import { School } from './school.model';
import { Stop } from './stop.model';
import { Student } from './student.model';
import { Trip } from './trip.model';
import { User } from './user.model';

export interface TripStudentAttendanceAttributes extends BaseModelAttributes {
  school_id: string;
  trip_id: string;
  student_id: string;
  /**
   * Stop the student was expected to board at, snapshotted when the first
   * attendance event is recorded. Keeping the snapshot means a later change to
   * `students.home_stop_id` never rewrites the history of a past run.
   */
  stop_id: string | null;
  status: TripAttendanceStatus;
  /** Server clock at boarding time — never supplied by a client. */
  boarded_at: Date | null;
  /** Crew member (or admin) that recorded the boarding. */
  boarded_by: string | null;
  /** Server clock at drop time — never supplied by a client. */
  dropped_at: Date | null;
  dropped_by: string | null;
}

export type TripStudentAttendanceCreationAttributes = Optional<
  TripStudentAttendanceAttributes,
  | BaseModelManagedFields
  | 'stop_id'
  | 'status'
  | 'boarded_at'
  | 'boarded_by'
  | 'dropped_at'
  | 'dropped_by'
>;

/**
 * Attendance of one student on one concrete trip.
 *
 * The *manifest* is not stored: it is derived from the trip's route, its
 * ordered stops and the students whose home stop sits on that route. Only the
 * events the crew actually recorded live here, which keeps the table small and
 * makes a student who never boarded implicitly `PENDING`.
 *
 * Every reference is tenant pinned through a composite foreign key on
 * `(school_id, <entity>_id)`, so an attendance row can never mix a trip,
 * student, stop or user from another school. Together with the partial unique
 * index on `(school_id, trip_id, student_id)` this makes a duplicate boarding
 * impossible even under concurrent requests from two crew devices.
 */
@Table({
  tableName: 'trip_student_attendance',
  modelName: 'TripStudentAttendance',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      name: 'uq_trip_student_attendance_trip_student',
      unique: true,
      fields: ['school_id', 'trip_id', 'student_id'],
      where: { deleted_at: null },
    },
    // Crew manifest lookup: "everything recorded for this trip".
    { name: 'idx_trip_student_attendance_school_trip', fields: ['school_id', 'trip_id'] },
    // Parent/report lookup: "every trip this student travelled on".
    { name: 'idx_trip_student_attendance_school_student', fields: ['school_id', 'student_id'] },
    // Backs the tenant-pinned composite foreign key to stops.
    { name: 'idx_trip_student_attendance_school_stop', fields: ['school_id', 'stop_id'] },
    // Operations view: "who is still on the bus?".
    { name: 'idx_trip_student_attendance_school_status', fields: ['school_id', 'status'] },
  ],
})
export class TripStudentAttendance extends BaseModel<
  TripStudentAttendanceAttributes,
  TripStudentAttendanceCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Trip)
  @Column({ type: DataType.UUID, allowNull: false })
  declare trip_id: string;

  @ForeignKey(() => Student)
  @Column({ type: DataType.UUID, allowNull: false })
  declare student_id: string;

  @ForeignKey(() => Stop)
  @Column({ type: DataType.UUID, allowNull: true })
  declare stop_id: string | null;

  @Column({
    type: DataType.ENUM(...TRIP_ATTENDANCE_STATUS_VALUES),
    allowNull: false,
    defaultValue: TripAttendanceStatus.PENDING,
  })
  declare status: TripAttendanceStatus;

  @Column({ type: DataType.DATE, allowNull: true })
  declare boarded_at: Date | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare boarded_by: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare dropped_at: Date | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare dropped_by: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;

  @BelongsTo(() => Student, { foreignKey: 'student_id', as: 'student' })
  declare student?: Student;

  @BelongsTo(() => Stop, { foreignKey: 'stop_id', as: 'stop' })
  declare stop?: Stop;

  @BelongsTo(() => User, { foreignKey: 'boarded_by', as: 'boardedBy' })
  declare boardedBy?: User;

  @BelongsTo(() => User, { foreignKey: 'dropped_by', as: 'droppedBy' })
  declare droppedBy?: User;
}
