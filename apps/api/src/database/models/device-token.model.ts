import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';
import { Optional } from 'sequelize';
import { BaseModel, BaseModelAttributes, BaseModelManagedFields } from './base.model';
import { School } from './school.model';
import { User } from './user.model';
import type { DevicePlatform } from '@school-bus-tracking/shared-types';

export interface DeviceTokenAttributes extends BaseModelAttributes {
  /** Tenant anchor — always the authenticated user's JWT `school_id`. */
  school_id: string;
  /** The user the device token is registered to (parent or crew account). */
  user_id: string;
  platform: DevicePlatform;
  /**
   * Native push token (FCM registration token on Android / APNs token on
   * iOS). Unique per tenant; tokens are globally unique from the push
   * provider, so the unique index also forbids cross-tenant duplicates.
   */
  token: string;
  /** False after a logout unregistered the device or FCM invalidated it. */
  is_active: boolean;
  /** Server time of the last registration/refresh from this device. */
  last_seen_at: Date;
}

export type DeviceTokenCreationAttributes = Optional<
  DeviceTokenAttributes,
  BaseModelManagedFields | 'is_active' | 'last_seen_at'
>;

/**
 * One push-capable device of one user, pinned to its tenant.
 *
 * Ownership is denormalised onto the row itself: `(school_id, user_id)` is
 * the only identity the registration endpoints accept, and both values come
 * from the verified JWT. The token itself is written as provided by the
 * mobile client (the client's own device token — there is nothing for a
 * malicious caller to forge that would deliver *to someone else*; it can only
 * point at a device of its own choosing).
 *
 * `is_active` is the delivery switch: a logout, a token refresh to another
 * user or an FCM `UNREGISTERED` / `INVALID_REGISTRATION` response flips it to
 * `false` so the row stays as an audit trail without ever being targeted
 * again. Rows are soft-deleted like every other tenant row.
 */
@Table({
  tableName: 'device_tokens',
  modelName: 'DeviceToken',
  underscored: true,
  timestamps: true,
  paranoid: true,
  indexes: [
    // Hot path of push delivery: "every active token of this user".
    {
      name: 'idx_device_tokens_school_user_active',
      fields: ['school_id', 'user_id', 'is_active'],
    },
    // Token lookup on register/refresh (the unique index below covers it as
    // a leftmost prefix, but scoping explicitly to the tenant keeps the
    // intent readable).
    { name: 'idx_device_tokens_school_token', fields: ['school_id', 'token'] },
    {
      name: 'uq_device_tokens_token',
      unique: true,
      fields: ['token'],
      where: { deleted_at: null },
    },
  ],
})
export class DeviceToken extends BaseModel<DeviceTokenAttributes, DeviceTokenCreationAttributes> {
  @ForeignKey(() => School)
  @Column({ type: DataType.UUID, allowNull: false })
  declare school_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string;

  @Column({
    type: DataType.ENUM('android', 'ios'),
    allowNull: false,
  })
  declare platform: DevicePlatform;

  @Column({ type: DataType.STRING(1024), allowNull: false })
  declare token: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare is_active: boolean;

  @Column({ type: DataType.DATE, allowNull: false })
  declare last_seen_at: Date;

  @BelongsTo(() => School, { foreignKey: 'school_id', as: 'school' })
  declare school?: School;

  @BelongsTo(() => User, { foreignKey: 'user_id', as: 'user' })
  declare user?: User;
}
