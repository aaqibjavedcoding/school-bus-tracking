import { AllowNull, BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import type { MarketingTemplateVariable } from '@school-bus-tracking/shared-types';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { User } from './user.model';
import { EmailTemplate } from './marketing-template.model';

export interface EmailTemplateVersionAttributes extends BaseModelAttributes {
  /** The template this version belongs to. */
  template_id: string;
  /** 1-based, monotonically increasing per template. */
  version: number;
  /** Email subject line (may contain `{{placeholders}}`). */
  subject: string;
  /** Rendered HTML body (may contain `{{placeholders}}`). */
  html_body: string;
  /** Plain-text alternative — required for deliverability and accessibility. */
  text_body: string;
  /** Which `{{placeholders}}` this version is allowed to substitute. */
  allowed_variables: MarketingTemplateVariable[];
  /** Who created this version (nullable: history survives account removal). */
  created_by: string | null;
  /**
   * Set when the version was published. `NULL` marks a draft version that can
   * still be edited; once set, the row is **immutable** — the service layer
   * refuses any further update, because campaigns already reference it.
   */
  published_at: Date | null;
}

export type EmailTemplateVersionCreationAttributes = Optional<
  EmailTemplateVersionAttributes,
  BaseModelManagedFields | 'allowed_variables' | 'created_by' | 'published_at'
>;

/**
 * One immutable snapshot of a template's content.
 *
 * A version row is created on every save of a draft and becomes frozen the
 * moment it is published (`published_at` set) or referenced by a campaign.
 * The unique `(template_id, version)` constraint is what makes "campaign #12
 * used version 3 of template `welcome-email`" a database fact rather than an
 * application promise.
 *
 * Immutable, but not append-only: the single legal post-insert write is the
 * one that publishes the row (setting `published_at`). `updated_at` tracks
 * exactly that. There is no soft delete — deleting a version a campaign
 * references would make sent history unreproducible; the FK from
 * `email_campaigns.template_version_id` uses `RESTRICT` to enforce it at the
 * database level too.
 */
@Table({
  tableName: 'email_template_versions',
  modelName: 'EmailTemplateVersion',
  underscored: true,
  timestamps: true,
  deletedAt: false,
  paranoid: false,
  indexes: [
    {
      name: 'uq_email_template_versions_template_version',
      unique: true,
      fields: ['template_id', 'version'],
    },
    // "Latest published version of this template" lookup.
    {
      name: 'idx_email_template_versions_template_published',
      fields: ['template_id', 'published_at'],
    },
  ],
})
export class EmailTemplateVersion extends BaseModel<
  EmailTemplateVersionAttributes,
  EmailTemplateVersionCreationAttributes
> {
  @AllowNull(false)
  @ForeignKey(() => EmailTemplate)
  @Column({ type: DataType.UUID })
  declare template_id: string;

  @AllowNull(false)
  @Column({ type: DataType.INTEGER })
  declare version: number;

  @AllowNull(false)
  @Column({ type: DataType.STRING(200) })
  declare subject: string;

  @AllowNull(false)
  @Column({ type: DataType.TEXT })
  declare html_body: string;

  @AllowNull(false)
  @Column({ type: DataType.TEXT })
  declare text_body: string;

  @AllowNull(false)
  @Column({ type: DataType.JSONB, defaultValue: [] })
  declare allowed_variables: MarketingTemplateVariable[];

  @AllowNull(true)
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID })
  declare created_by: string | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE })
  declare published_at: Date | null;

  @BelongsTo(() => EmailTemplate, { foreignKey: 'template_id', as: 'template' })
  declare template?: EmailTemplate;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'creator', constraints: false })
  declare creator?: User;
}
