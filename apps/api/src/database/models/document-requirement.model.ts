import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { DOCUMENT_OWNER_TYPE_VALUES, type DocumentOwnerType } from './enums';
import { School } from './school.model';

export interface DocumentRequirementAttributes extends BaseModelAttributes {
  school_id: string;
  /** Which resource kind this row configures: a bus or a driver. */
  owner_type: DocumentOwnerType;
  /**
   * Document type being configured, as the shared enum *value*
   * (`INSURANCE`, `DRIVING_LICENSE`, …).
   *
   * It is stored as text rather than a PostgreSQL enum because one table
   * serves both catalogues (`BusDocumentType` and `DriverDocumentType`),
   * which the database could not express with a single enum type. The API
   * validates the value against the catalogue selected by `owner_type`.
   */
  document_type: string;
  /** `true` → the school treats this document as mandatory. */
  is_required: boolean;
  /** Lead time in days used to flag the document as "expiring soon". */
  expiry_warning_days: number;
}

export type DocumentRequirementCreationAttributes = Optional<
  DocumentRequirementAttributes,
  BaseModelManagedFields | 'is_required' | 'expiry_warning_days'
>;

/**
 * Per-school required/optional configuration of the compliance catalogue.
 *
 * A school only stores rows for document types it has *overridden*; every
 * type without a row falls back to the built-in catalogue default
 * (`DEFAULT_BUS_/DRIVER_DOCUMENT_REQUIREMENTS` in the shared types), so
 * onboarding a new school needs no seeding and the product can still change
 * its defaults later.
 *
 * Requirements are what make "missing document" a real, derivable state: an
 * owner is non-compliant when a required type has no document on file.
 */
@Table({
  tableName: 'document_requirements',
  modelName: 'DocumentRequirement',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // One configuration row per document type per resource kind per school.
    {
      name: 'uq_document_requirements_school_owner_type',
      unique: true,
      fields: ['school_id', 'owner_type', 'document_type'],
      where: { deleted_at: null },
    },
    { name: 'idx_document_requirements_school_owner', fields: ['school_id', 'owner_type'] },
  ],
})
export class DocumentRequirement extends BaseModel<
  DocumentRequirementAttributes,
  DocumentRequirementCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @Column({ type: DataType.ENUM(...DOCUMENT_OWNER_TYPE_VALUES), allowNull: false })
  declare owner_type: DocumentOwnerType;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare document_type: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_required: boolean;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
  })
  declare expiry_warning_days: number;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;
}
