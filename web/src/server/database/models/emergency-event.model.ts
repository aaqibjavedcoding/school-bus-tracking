import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { UserRole } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import {
  EMERGENCY_STATUS_VALUES,
  EMERGENCY_TYPE_VALUES,
  EmergencyStatus,
  EmergencyType,
} from './enums';
import { School } from './school.model';
import { Trip } from './trip.model';
import { Bus } from './bus.model';
import { Route } from './route.model';
import { User } from './user.model';

/** Crew roles allowed to raise an SOS. */
export type EmergencyRaisedByRole = typeof UserRole.DRIVER | typeof UserRole.CONDUCTOR;

export interface EmergencyEventAttributes extends BaseModelAttributes {
  school_id: string;
  /** Trip the alarm was raised on; `null` for an off-duty SOS. */
  trip_id: string | null;
  /** Snapshot of the trip's vehicle; `null` when there was no trip. */
  bus_id: string | null;
  /** Snapshot of the trip's route; `null` when there was no trip. */
  route_id: string | null;
  /** Crew member who pressed the button (JWT subject). */
  raised_by_user_id: string;
  raised_by_role: EmergencyRaisedByRole;
  type: EmergencyType;
  status: EmergencyStatus;
  /** Free-text detail supplied by the crew ("bus hit a divider, no injuries"). */
  message: string | null;
  /** Device-reported position at the time of the alarm; `null` without a fix. */
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /**
   * Server clock at which the SOS was received — the authoritative event
   * time. A client can never set or back-date it.
   */
  triggered_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by_user_id: string | null;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  /** Audit note recorded with the latest status transition. */
  resolution_note: string | null;
}

export type EmergencyEventCreationAttributes = Optional<
  EmergencyEventAttributes,
  | BaseModelManagedFields
  | 'trip_id'
  | 'bus_id'
  | 'route_id'
  | 'message'
  | 'latitude'
  | 'longitude'
  | 'accuracy'
  | 'status'
  | 'acknowledged_at'
  | 'acknowledged_by_user_id'
  | 'resolved_at'
  | 'resolved_by_user_id'
  | 'resolution_note'
>;

/**
 * One SOS / emergency event raised by a crew member.
 *
 * The row is the audit record of the whole incident: who raised it, when the
 * server received it, what the school did about it and who closed it. Events
 * are never hard deleted — cancelling or resolving them moves them through
 * their lifecycle so the history stays complete.
 *
 * `bus_id` / `route_id` are snapshotted from the trip so the record stays
 * readable after an assignment or a route changes.
 *
 * Every reference is tenant-pinned through composite foreign keys, and the
 * nullable ones use `ON DELETE SET NULL` so removing a vehicle never destroys
 * the incident history.
 */
@Table({
  tableName: 'emergency_events',
  modelName: 'EmergencyEvent',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // "What is open right now?" — the admin cockpit query.
    { name: 'idx_emergency_events_school_status', fields: ['school_id', 'status'] },
    // History: "this school's incidents, newest first".
    { name: 'idx_emergency_events_school_triggered', fields: ['school_id', 'triggered_at'] },
    { name: 'idx_emergency_events_school_trip', fields: ['school_id', 'trip_id'] },
    { name: 'idx_emergency_events_school_bus', fields: ['school_id', 'bus_id'] },
    // A crew member's own SOS history.
    { name: 'idx_emergency_events_school_raised_by', fields: ['school_id', 'raised_by_user_id'] },
  ],
})
export class EmergencyEvent extends BaseModel<
  EmergencyEventAttributes,
  EmergencyEventCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Trip)
  @Column({ type: DataType.UUID, allowNull: true })
  declare trip_id: string | null;

  @ForeignKey(() => Bus)
  @Column({ type: DataType.UUID, allowNull: true })
  declare bus_id: string | null;

  @ForeignKey(() => Route)
  @Column({ type: DataType.UUID, allowNull: true })
  declare route_id: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare raised_by_user_id: string;

  @Column({
    type: DataType.ENUM(UserRole.DRIVER, UserRole.CONDUCTOR),
    allowNull: false,
  })
  declare raised_by_role: EmergencyRaisedByRole;

  @Column({ type: DataType.ENUM(...EMERGENCY_TYPE_VALUES), allowNull: false })
  declare type: EmergencyType;

  @Column({
    type: DataType.ENUM(...EMERGENCY_STATUS_VALUES),
    allowNull: false,
    defaultValue: EmergencyStatus.OPEN,
  })
  declare status: EmergencyStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare message: string | null;

  // `DOUBLE PRECISION` (not `DECIMAL`): PostgreSQL returns a `numeric` to the
  // driver as a string, which would leak strings into the typed API.
  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare latitude: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare longitude: number | null;

  @Column({ type: DataType.DOUBLE, allowNull: true })
  declare accuracy: number | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare triggered_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare acknowledged_at: Date | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare acknowledged_by_user_id: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare resolved_at: Date | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare resolved_by_user_id: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare resolution_note: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Trip, { foreignKey: 'trip_id', as: 'trip' })
  declare trip?: Trip;

  @BelongsTo(() => Bus, { foreignKey: 'bus_id', as: 'bus' })
  declare bus?: Bus;

  @BelongsTo(() => Route, { foreignKey: 'route_id', as: 'route' })
  declare route?: Route;

  @BelongsTo(() => User, { foreignKey: 'raised_by_user_id', as: 'raisedBy' })
  declare raisedBy?: User;
}
