import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Table,
} from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { MarketingTemplateStatus } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { User } from './user.model';
import { EmailTemplateVersion } from './marketing-template-version.model';

export interface EmailTemplateAttributes extends BaseModelAttributes {
  /** Human-readable label shown in the Super Admin template list. */
  name: string;
  /**
   * Stable, URL-safe identifier (`welcome-email`). Unique among live
   * (non-deleted) templates; referenced by name in audits and lookups, never
   * by `id`, so a re-created template keeps its identity.
   */
  slug: string;
  status: MarketingTemplateStatus;
  /** SUPER_ADMIN who created the template (nullable: history survives account removal). */
  created_by: string | null;
  /** SUPER_ADMIN who last edited the template metadata. */
  updated_by: string | null;
}

export type EmailTemplateCreationAttributes = Optional<
  EmailTemplateAttributes,
  BaseModelManagedFields | 'status' | 'created_by' | 'updated_by'
>;

/**
 * A marketing email template — the *container*, never the content.
 *
 * The editable surface of a template is deliberately tiny (`name`, `slug`,
 * `status`): every subject/body pair lives in an immutable
 * {@link EmailTemplateVersion} row, and a campaign pins one specific version.
 * That is what makes a sent campaign reproducible forever — the exact HTML a
 * school received on a given date is still in the database even after ten
 * subsequent edits.
 *
 * Lifecycle: DRAFT → (publish a version) → PUBLISHED → (retire) → ARCHIVED.
 * `status` is metadata for the console; the send-time guarantee comes from the
 * version pin, not from here.
 *
 * Marketing templates are a **platform-level** concern (SUPER_ADMIN only), so
 * — like `audit_logs` — the table carries no `school_id`. Schools are the
 * *audience*, never the owners, of this data.
 */
@Table({
  tableName: 'email_templates',
  modelName: 'EmailTemplate',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Soft-deleted templates must not keep their slug hostage.
    {
      name: 'uq_email_templates_slug',
      unique: true,
      fields: ['slug'],
      where: { deleted_at: null },
    },
    { name: 'idx_email_templates_status_updated', fields: ['status', 'updated_at'] },
  ],
})
export class EmailTemplate extends BaseModel<
  EmailTemplateAttributes,
  EmailTemplateCreationAttributes
> {
  @Column({ type: DataType.STRING(150), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare slug: string;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: MarketingTemplateStatus.DRAFT,
  })
  declare status: MarketingTemplateStatus;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID })
  declare created_by: string | null;

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID })
  declare updated_by: string | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'creator', constraints: false })
  declare creator?: User;

  @BelongsTo(() => User, { foreignKey: 'updated_by', as: 'editor', constraints: false })
  declare editor?: User;

  @HasMany(() => EmailTemplateVersion, { foreignKey: 'template_id', as: 'versions' })
  declare versions?: EmailTemplateVersion[];
}
