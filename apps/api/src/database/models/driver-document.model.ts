import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { DRIVER_DOCUMENT_TYPE_VALUES, DriverDocumentType } from './enums';
import { School } from './school.model';
import { User } from './user.model';

export interface DriverDocumentAttributes extends BaseModelAttributes {
  school_id: string;
  /** The crew member (a `DRIVER` account) this document belongs to. */
  driver_id: string;
  /** Which compliance document this row holds (licence, medical, …). */
  document_type: DriverDocumentType;
  /** Licence / certificate / reference number printed on the document. */
  document_number: string | null;
  /** `YYYY-MM-DD` the document was issued; `null` when unknown. */
  issue_date: string | null;
  /**
   * `YYYY-MM-DD` the document stops being valid; `null` means the document
   * has no expiry. Validity is derived from this column alone — it is never
   * stored, so no fake validity is possible.
   */
  expiry_date: string | null;
  notes: string | null;
  /** Display name of the attached file. The bytes live outside the platform. */
  file_name: string | null;
  /** http(s) reference to the attached file in the school's own store. */
  file_url: string | null;
}

export type DriverDocumentCreationAttributes = Optional<
  DriverDocumentAttributes,
  | BaseModelManagedFields
  | 'document_number'
  | 'issue_date'
  | 'expiry_date'
  | 'notes'
  | 'file_name'
  | 'file_url'
>;

/**
 * A compliance document of one crew member — the driving licence first and
 * foremost, plus whatever else a school requires (medical certificate, police
 * verification, training certificate, ID proof, …).
 *
 * Renewals are recorded as new rows so the school keeps an audit trail; every
 * read computes compliance from the *newest* document of each type.
 *
 * Both references are tenant-pinned through composite foreign keys
 * (`(school_id, driver_id)` → `users (school_id, id)`), so a document can
 * never be attached to another school's employee.
 */
@Table({
  tableName: 'driver_documents',
  modelName: 'DriverDocument',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // "The documents of this driver", and the tenant-pinned FK target.
    { name: 'idx_driver_documents_school_driver', fields: ['school_id', 'driver_id'] },
    // Compliance sweeps: "every driving licence of this school".
    {
      name: 'idx_driver_documents_school_type_expiry',
      fields: ['school_id', 'document_type', 'expiry_date'],
    },
    { name: 'idx_driver_documents_school_expiry', fields: ['school_id', 'expiry_date'] },
  ],
})
export class DriverDocument extends BaseModel<
  DriverDocumentAttributes,
  DriverDocumentCreationAttributes
> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare driver_id: string;

  @Column({ type: DataType.ENUM(...DRIVER_DOCUMENT_TYPE_VALUES), allowNull: false })
  declare document_type: DriverDocumentType;

  @Column({ type: DataType.STRING(64), allowNull: true })
  declare document_number: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare issue_date: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare expiry_date: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare file_name: string | null;

  @Column({ type: DataType.STRING(512), allowNull: true })
  declare file_url: string | null;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'driver_id', as: 'driver' })
  declare driver?: User;
}
