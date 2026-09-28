import { AllowNull, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

export interface MarketingDeliverySettingsAttributes {
  id: number;
  paused: boolean;
  daily_send_cap: number;
  per_minute_send_cap: number;
  delivery_timezone: string;
  allowed_window_start: string | null;
  allowed_window_end: string | null;
  last_worker_run_at: Date | null;
  last_worker_claimed: number;
  last_worker_sent: number;
  created_at: Date;
  updated_at: Date;
}

export type MarketingDeliverySettingsCreationAttributes =
  Partial<MarketingDeliverySettingsAttributes>;

/** Singleton row (id=1) controlling the durable PostgreSQL delivery queue. */
@Table({ tableName: 'marketing_delivery_settings', timestamps: true, underscored: true })
export class MarketingDeliverySettings extends Model<
  MarketingDeliverySettingsAttributes,
  MarketingDeliverySettingsCreationAttributes
> {
  @PrimaryKey
  @Column(DataType.SMALLINT)
  declare id: number;

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  declare paused: boolean;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare daily_send_cap: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare per_minute_send_cap: number;

  @AllowNull(false)
  @Column(DataType.STRING(100))
  declare delivery_timezone: string;

  @AllowNull(true)
  @Column(DataType.TIME)
  declare allowed_window_start: string | null;

  @AllowNull(true)
  @Column(DataType.TIME)
  declare allowed_window_end: string | null;

  @AllowNull(true)
  @Column(DataType.DATE)
  declare last_worker_run_at: Date | null;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare last_worker_claimed: number;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare last_worker_sent: number;

  declare created_at: Date;
  declare updated_at: Date;
}
