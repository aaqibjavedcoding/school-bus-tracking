import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Run } from './run.model';

export interface ShiftAttributes extends BaseModelAttributes {
  school_id: string;
  /** Human readable bell-window label, e.g. "Morning" / "Afternoon". */
  name: string;
  /**
   * When the window opens, as a tenant-local wall clock time (`HH:MM:SS`).
   *
   * A `time`, not a `timestamptz`, on purpose: a bell window repeats every day
   * and must not carry an instant — and therefore a timezone or DST question —
   * into reference data. The instant a concrete trip departs stays
   * `timestamptz` on `trips.scheduled_start_at`.
   */
  start_time: string;
  /** When the window closes. `ck_shifts_window` guarantees `> start_time`. */
  end_time: string;
  is_active: boolean;
}

export type ShiftCreationAttributes = Optional<
  ShiftAttributes,
  BaseModelManagedFields | 'is_active'
>;

/**
 * A school's bell window — the *time* half of the operating model described in
 * `docs/operating-model.md`.
 *
 * A {@link Route} is a path; a {@link Run} is one vehicle's timed pass over
 * that path, and its clock is its shift. Because two shifts are disjoint by
 * construction, the same bus and the same crew member can legally hold runs in
 * both — that is tiering, and it is the reason this table exists. Before it,
 * the roster was compared on `DATEONLY` columns only, so "the same bus at
 * 07:00 and at 13:00" read as a clash and one route could only ever hold one
 * vehicle.
 *
 * `uq_shifts_school_name` keeps two live "Morning" shifts out of one school;
 * a soft-deleted name is reusable.
 */
@Table({
  tableName: 'shifts',
  modelName: 'Shift',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Referenced as (school_id, id) by runs.shift_id. Must be non-partial:
    // PostgreSQL cannot use a soft-delete index as a foreign-key target.
    { name: 'uq_shifts_school_id', unique: true, fields: ['school_id', 'id'] },
    {
      name: 'uq_shifts_school_name',
      unique: true,
      fields: ['school_id', 'name'],
      where: { deleted_at: null },
    },
    { name: 'idx_shifts_school_active', fields: ['school_id', 'is_active'] },
    // "Which shifts cover 09:00?" — the window query the tiering rules run.
    { name: 'idx_shifts_school_window', fields: ['school_id', 'start_time', 'end_time'] },
  ],
})
export class Shift extends BaseModel<ShiftAttributes, ShiftCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TIME, allowNull: false })
  declare start_time: string;

  @Column({ type: DataType.TIME, allowNull: false })
  declare end_time: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @HasMany(() => Run, { foreignKey: 'shift_id', as: 'runs' })
  declare runs?: Run[];
}
