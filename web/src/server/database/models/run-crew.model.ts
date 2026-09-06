import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { RUN_CREW_ROLE_VALUES, RouteAssignmentRole } from './enums';
import { School } from './school.model';
import { Run } from './run.model';
import { User } from './user.model';

export interface RunCrewAttributes extends BaseModelAttributes {
  school_id: string;
  /** Run this person is rostered on. Pinned by `(school_id, run_id) → runs`. */
  run_id: string;
  /** Crew member (driver or conductor) being rostered. */
  user_id: string;
  /** Role the user plays on the run for the duration of the assignment. */
  role: RouteAssignmentRole;
  /** First day (inclusive, tenant local date) the roster entry applies. */
  effective_from: string;
  /** Last day (inclusive). Null means "open ended". */
  effective_to: string | null;
  is_active: boolean;
}

export type RunCrewCreationAttributes = Optional<
  RunCrewAttributes,
  BaseModelManagedFields | 'effective_to' | 'is_active'
>;

/**
 * Crew rostered onto a **run** for a period of time.
 *
 * Structurally the same shape as `RouteAssignment`; the difference is
 * *what it points at*. `route_assignments` rosters a person onto a **route**,
 * which is why a route could only ever carry one driver — two rows for the same
 * role on the same route is the `ROUTE_ROLE` conflict, rejected outright. This
 * table rosters a person onto a **run**, so a route with three runs has three
 * drivers and the old rule simply no longer applies. See
 * `docs/operating-model.md` §4.2.
 *
 * One row per person per role, which still covers:
 * - a driver *and* a conductor on the same run (two rows),
 * - crew rotation over time (`effective_from` / `effective_to`),
 * - the same person serving several runs sequentially — and, once the overlap
 *   test moves from dates to shift windows in Session 2, several runs on the
 *   *same* day in disjoint bell windows.
 *
 * `effective_from` / `effective_to` stay `DATEONLY` on purpose: they answer
 * "who is rostered on this run this term?", a week/term-scale fact. The
 * intra-day question that unlocks tiering is answered by
 * `runs.shift_id → shifts.start_time/end_time`, not by these columns.
 *
 * Trips snapshot the crew they actually ran with (`trips.driver_id` /
 * `trips.conductor_id`), so editing or closing a roster entry never rewrites
 * history.
 *
 * Every reference is tenant pinned through a composite foreign key on
 * `(school_id, <entity>_id)`, so a roster entry can never mix a run or a person
 * from another school.
 */
@Table({
  tableName: 'run_crew',
  modelName: 'RunCrew',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // The same person cannot be rostered twice for the same role on the same
    // run starting on the same day.
    {
      name: 'uq_run_crew_run_user_role',
      unique: true,
      fields: ['run_id', 'user_id', 'role', 'effective_from'],
      where: { deleted_at: null },
    },
    // "Who drives run X today?"
    { name: 'idx_run_crew_run_role', fields: ['run_id', 'role'] },
    // The two (school_id, <entity>_id) indexes back the tenant-pinned
    // composite foreign keys and the tenant-scoped lookups.
    { name: 'idx_run_crew_school_run', fields: ['school_id', 'run_id'] },
    // "Which runs is this driver rostered on?" — the crew day view.
    { name: 'idx_run_crew_school_user', fields: ['school_id', 'user_id'] },
    // Backs run_crew's own composite FK key (route_assignments → run_crew)
    // and matches the non-partial (school_id, id) convention used by every
    // other tenant-pinned table.
    { name: 'uq_run_crew_school_id', fields: ['school_id', 'id'], unique: true },
  ],
})
export class RunCrew extends BaseModel<RunCrewAttributes, RunCrewCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Run)
  @Column({ type: DataType.UUID, allowNull: false })
  declare run_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({ type: DataType.ENUM(...RUN_CREW_ROLE_VALUES), allowNull: false })
  declare role: RouteAssignmentRole;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  declare effective_from: string;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare effective_to: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => Run, { foreignKey: 'run_id', as: 'run' })
  declare run?: Run;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;
}
