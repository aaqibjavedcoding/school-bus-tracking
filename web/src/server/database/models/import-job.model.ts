import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import type {
  ImportJobStatus,
  ImportMode,
  ImportModule,
  ImportRowError,
  ImportSummary,
} from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { User } from './user.model';

export interface ImportJobAttributes extends BaseModelAttributes {
  school_id: string;
  /** The admin who uploaded the file. Kept nullable so history survives a
   *  deactivated account without losing the run itself. */
  imported_by: string | null;
  /** Which domain module the file targeted (`students`, `buses`, …). */
  module: ImportModule;
  mode: ImportMode;
  /** Original upload filename, sanitised — the file itself is never stored. */
  file_name: string;
  status: ImportJobStatus;
  /** True when this run was a validation-only dry run. */
  dry_run: boolean;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  /** Full counter set shown on the detail screen. */
  summary: ImportSummary;
  /**
   * Rows that failed validation, with their original cell values, so the
   * `<module>_import_errors.xlsx` workbook can be regenerated on demand.
   * Capped by the service before persistence to keep the JSONB bounded.
   */
  errors: ImportRowError[];
  /** Headers found in the file that the template does not define. */
  unknown_columns: string[];
  /** Required headers the file was missing. */
  missing_columns: string[];
  /** Set when the transaction was rolled back; nothing was written. */
  failure_reason: string | null;
  completed_at: Date | null;
}

export type ImportJobCreationAttributes = Optional<
  ImportJobAttributes,
  | BaseModelManagedFields
  | 'imported_by'
  | 'created_count'
  | 'updated_count'
  | 'skipped_count'
  | 'errors'
  | 'unknown_columns'
  | 'missing_columns'
  | 'failure_reason'
  | 'completed_at'
>;

/**
 * Audit record of one bulk-import run (validation dry run or real import).
 *
 * The uploaded workbook is deliberately **not** persisted: keeping thousands of
 * spreadsheets full of student data around would be a data-protection
 * liability and would need object storage the MVP does not have. What is kept
 * is exactly what an admin needs afterwards — the counters, the rejected rows
 * with their original cell values (so the error workbook can be regenerated)
 * and who ran it.
 *
 * `school_id` is denormalised onto the row and every read is pinned with it, so
 * one school can never see another school's import history.
 */
@Table({
  tableName: 'import_jobs',
  modelName: 'ImportJob',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // History screen: "this school's runs, newest first" (+ module filter).
    { name: 'idx_import_jobs_school_created', fields: ['school_id', 'created_at'] },
    { name: 'idx_import_jobs_school_module', fields: ['school_id', 'module'] },
    { name: 'idx_import_jobs_school_actor', fields: ['school_id', 'imported_by'] },
  ],
})
export class ImportJob extends BaseModel<ImportJobAttributes, ImportJobCreationAttributes> {
  @AllowNull(false)
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID })
  declare school_id: string;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID })
  declare imported_by: string | null;

  @AllowNull(false)
  @Column({ type: DataType.STRING(64) })
  declare module: ImportModule;

  @AllowNull(false)
  @Column({ type: DataType.STRING(16) })
  declare mode: ImportMode;

  @AllowNull(false)
  @Column({ type: DataType.STRING(255) })
  declare file_name: string;

  @AllowNull(false)
  @Column({ type: DataType.STRING(16) })
  declare status: ImportJobStatus;

  @AllowNull(false)
  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  declare dry_run: boolean;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare total_rows: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare valid_rows: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare invalid_rows: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare created_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare updated_count: number;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare skipped_count: number;

  @AllowNull(false)
  @Column({ type: DataType.JSONB })
  declare summary: ImportSummary;

  @AllowNull(false)
  @Column({ type: DataType.JSONB, defaultValue: [] })
  declare errors: ImportRowError[];

  @AllowNull(false)
  @Column({ type: DataType.JSONB, defaultValue: [] })
  declare unknown_columns: string[];

  @AllowNull(false)
  @Column({ type: DataType.JSONB, defaultValue: [] })
  declare missing_columns: string[];

  @AllowNull(true)
  @Column({ type: DataType.STRING(500) })
  declare failure_reason: string | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare completed_at: Date | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'imported_by', as: 'importedBy' })
  declare importedBy?: User;
}
