import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { BUS_DOCUMENT_TYPE_VALUES, BusDocumentType } from './enums';
import { School } from './school.model';
import { Bus } from './bus.model';

export interface BusDocumentAttributes extends BaseModelAttributes {
  school_id: string;
  bus_id: string;
  /** Which compliance document this row holds (RC, insurance, fitness, …). */
  document_type: BusDocumentType;
  /** Official number of the document (registration no, policy no, …). */
  document_number: string | null;
  /** `YYYY-MM-DD` the document was issued; `null` when unknown. */
  issue_date: string | null;
  /**
   * `YYYY-MM-DD` the document stops being valid; `null` means the document
   * has no expiry (e.g. a lifetime registration certificate).
   *
   * This is the *only* input to the validity calculation — the derived
   * `VALID` / `EXPIRING_SOON` / `EXPIRED` status is never stored, so a client
   * cannot present an expired certificate as valid.
   */
  expiry_date: string | null;
  notes: string | null;
  /** Display name of the attached file. The bytes live outside the platform. */
  file_name: string | null;
  /** http(s) reference to the attached file in the school's own store. */
  file_url: string | null;
}

export type BusDocumentCreationAttributes = Optional<
  BusDocumentAttributes,
  | BaseModelManagedFields
  | 'document_number'
  | 'issue_date'
  | 'expiry_date'
  | 'notes'
  | 'file_name'
  | 'file_url'
>;

/**
 * A compliance document of one school bus (RC, insurance, fitness, permit,
 * PUC, …).
 *
 * Renewals are recorded as new rows rather than by overwriting the old one,
 * so the fleet keeps an audit trail; every read computes compliance from the
 * *newest* document of each type (see the documents service).
 *
 * Both references are tenant-pinned through composite foreign keys
 * (`(school_id, bus_id)` → `buses (school_id, id)`), so a document can never
 * be attached to another school's vehicle.
 */
@Table({
  tableName: 'bus_documents',
  modelName: 'BusDocument',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // "The documents of this bus", and the tenant-pinned FK target.
    { name: 'idx_bus_documents_school_bus', fields: ['school_id', 'bus_id'] },
    // Compliance sweeps: "every insurance policy of this school".
    {
      name: 'idx_bus_documents_school_type_expiry',
      fields: ['school_id', 'document_type', 'expiry_date'],
    },
    { name: 'idx_bus_documents_school_expiry', fields: ['school_id', 'expiry_date'] },
  ],
})
export class BusDocument extends BaseModel<BusDocumentAttributes, BusDocumentCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => Bus)
  @Column({ type: DataType.UUID, allowNull: false })
  declare bus_id: string;

  @Column({ type: DataType.ENUM(...BUS_DOCUMENT_TYPE_VALUES), allowNull: false })
  declare document_type: BusDocumentType;

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

  @BelongsTo(() => Bus, { foreignKey: 'bus_id', as: 'bus' })
  declare bus?: Bus;
}
