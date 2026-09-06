import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { Route } from './route.model';
import { Shift } from './shift.model';
import { Bus } from './bus.model';
import { RunCrew } from './run-crew.model';
import { Trip } from './trip.model';
import { Student } from './student.model';

export interface RunAttributes extends BaseModelAttributes {
  school_id: string;
  /** Path this run drives. Pinned by `(school_id, route_id) → routes`. */
  route_id: string;
  /**
   * Bell window this run occupies — the run's clock.
   *
   * Nullable because the default runs the backfill created for pre-existing
   * routes belong to schools that had no shifts yet; inventing a synthetic
   * shift inside a data migration would have written reference data no operator
   * chose. A `NULL` shift is treated by the conflict rules as occupying the
   * whole day, which reproduces the pre-refactor behaviour exactly. See
   * `docs/operating-model.md` §3.2 and §4.3.
   */
  shift_id: string | null;
  /** Vehicle driving this run; null while the fleet is undecided. */
  bus_id: string | null;
  /**
   * Parent-facing short code shown on the bus sign and in messages
   * (e.g. `R-01`, or `R-01-2` for a second run of the same route). Unique
   * inside a tenant among non-deleted runs.
   */
  code: string;
  /**
   * Marks the run the backfill auto-provisioned for a pre-existing route
   * (`1 route = 1 default run = the behaviour before the refactor`).
   *
   * Server-only: it is never accepted from a client, and
   * `uq_runs_route_default` makes "at most one default run per route" a
   * database guarantee rather than a convention.
   */
  is_default: boolean;
  is_active: boolean;
}

export type RunCreationAttributes = Optional<
  RunAttributes,
  BaseModelManagedFields | 'shift_id' | 'bus_id' | 'is_default' | 'is_active'
>;

/**
 * One vehicle's timed pass over one route.
 *
 * This is the model the operating-model refactor (`docs/operating-model.md`)
 * exists to add. Until now `routes` owned both the path *and* the resources
 * driving it, so a route could only ever hold one bus and one crew pair: the
 * conflict engine compared `route_assignments.effective_from/to`, which are
 * `DATEONLY`, and therefore read "the same bus at 07:00 and at 13:00" as a
 * clash. Splitting the *path* ({@link Route}) from the *pass* (this table) is
 * what makes several runs — and so tiering — expressible at all.
 *
 * A run carries no times of its own: its clock is its {@link Shift}. Storing a
 * window on both would create two sources of truth that eventually disagree.
 *
 * Crew lives in {@link RunCrew} (one row per person per role), riders are
 * `students.run_id`, and each calendar day the run happens is a {@link Trip}.
 *
 * Every entity reference is tenant pinned through a composite foreign key on
 * `(school_id, <entity>_id)`, so a run can never combine a route, shift or
 * vehicle from another school.
 */
@Table({
  tableName: 'runs',
  modelName: 'Run',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Referenced as (school_id, id) by run_crew, trips and students. Must be
    // non-partial: PostgreSQL cannot use a soft-delete index as a
    // foreign-key target.
    { name: 'uq_runs_school_id', unique: true, fields: ['school_id', 'id'] },
    // A parent must never be told "bus R-01" when two live runs share a code.
    {
      name: 'uq_runs_school_code',
      unique: true,
      fields: ['school_id', 'code'],
      where: { deleted_at: null },
    },
    // The back-compat invariant, enforced by the database: one default run per
    // route. No future write path can break it.
    {
      name: 'uq_runs_route_default',
      unique: true,
      fields: ['route_id'],
      where: { deleted_at: null, is_default: true },
    },
    // "All runs of this route."
    { name: 'idx_runs_school_route', fields: ['school_id', 'route_id'] },
    // "Everything in the morning shift."
    { name: 'idx_runs_school_shift', fields: ['school_id', 'shift_id'] },
    // "What is this bus doing today?" — the tiering / bus day view.
    { name: 'idx_runs_school_bus', fields: ['school_id', 'bus_id'] },
    // Plan-limit usage counts active rows only.
    { name: 'idx_runs_school_active', fields: ['school_id', 'is_active'] },
  ],
})
export class Run extends BaseModel<RunAttributes, RunCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Route)
  @Column({ type: DataType.UUID, allowNull: false })
  declare route_id: string;

  @ForeignKey(() => Shift)
  @Column({ type: DataType.UUID, allowNull: true })
  declare shift_id: string | null;

  @ForeignKey(() => Bus)
  @Column({ type: DataType.UUID, allowNull: true })
  declare bus_id: string | null;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare code: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare is_default: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Route, { foreignKey: 'route_id', as: 'route' })
  declare route?: Route;

  @BelongsTo(() => Shift, { foreignKey: 'shift_id', as: 'shift' })
  declare shift?: Shift;

  @BelongsTo(() => Bus, { foreignKey: 'bus_id', as: 'bus' })
  declare bus?: Bus;

  @HasMany(() => RunCrew, { foreignKey: 'run_id', as: 'crew' })
  declare crew?: RunCrew[];

  @HasMany(() => Trip, { foreignKey: 'run_id', as: 'trips' })
  declare trips?: Trip[];

  @HasMany(() => Student, { foreignKey: 'run_id', as: 'students' })
  declare students?: Student[];
}
