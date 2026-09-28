import { QueryTypes, Transaction, type Sequelize } from 'sequelize';
import { BadRequestException, type ConfigService } from '../../framework';
import { marketingDeliverySettingsUpdateSchema } from '@school-bus-tracking/validation';
import { MarketingDeliverySettings } from '../../database/models';
import type {
  MarketingDeliverySettingsResponse,
  MarketingDeliverySettingsUpdateRequest,
} from '@school-bus-tracking/shared-types';
import type { MarketingSweepSummary } from './marketing-delivery.worker';

export const MARKETING_DAILY_CAP_MIN = 1;
export const MARKETING_DAILY_CAP_MAX = 10_000;
export const MARKETING_PER_MINUTE_CAP_MIN = 1;
export const MARKETING_PER_MINUTE_CAP_MAX = 300;
export const MARKETING_SETTINGS_ID = 1;

export interface MarketingClaimCapacity {
  allowed: number;
  reason: 'available' | 'paused' | 'disabled' | 'outside_window' | 'daily_cap' | 'minute_cap';
}

export interface MarketingDeliverySettingsSource {
  reserveClaimCapacity(
    requested: number,
    transaction: Transaction,
  ): Promise<MarketingClaimCapacity>;
  recordWorkerRun(summary: MarketingSweepSummary): Promise<void>;
}

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Returns whether a local HH:mm time lies in a possibly overnight window. */
export function isWithinMarketingSendWindow(
  current: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return true;
  const now = current.slice(0, 5);
  const from = start.slice(0, 5);
  const to = end.slice(0, 5);
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

interface CountRow {
  daily_sent: string | number;
  minute_sent: string | number;
  queued: string | number;
  retrying: string | number;
  failed: string | number;
  processing: string | number;
  local_time: string;
}

/** Durable settings, counters, and capacity reservation shared by every worker. */
export class MarketingDeliverySettingsService implements MarketingDeliverySettingsSource {
  constructor(
    private readonly settings: typeof MarketingDeliverySettings,
    private readonly sequelize: Sequelize | null,
    private readonly config: ConfigService,
  ) {}

  private async row(options: { transaction?: Transaction; lock?: boolean } = {}) {
    const [row] = await this.settings.findOrCreate({
      where: { id: MARKETING_SETTINGS_ID },
      defaults: {
        id: MARKETING_SETTINGS_ID,
        paused: false,
        daily_send_cap: Math.min(
          MARKETING_DAILY_CAP_MAX,
          Math.max(
            MARKETING_DAILY_CAP_MIN,
            this.config.get<number>('marketing.delivery.dailyCap') ?? 500,
          ),
        ),
        per_minute_send_cap: Math.min(
          MARKETING_PER_MINUTE_CAP_MAX,
          Math.max(
            MARKETING_PER_MINUTE_CAP_MIN,
            this.config.get<number>('marketing.delivery.ratePerMinute') ?? 60,
          ),
        ),
        delivery_timezone: isValidIanaTimezone(
          this.config.get<string>('marketing.delivery.timezone') ?? 'UTC',
        )
          ? (this.config.get<string>('marketing.delivery.timezone') ?? 'UTC')
          : 'UTC',
        allowed_window_start: null,
        allowed_window_end: null,
        last_worker_run_at: null,
        last_worker_claimed: 0,
        last_worker_sent: 0,
      },
      transaction: options.transaction,
    });
    if (options.lock && options.transaction) {
      await row.reload({ transaction: options.transaction, lock: Transaction.LOCK.UPDATE });
    }
    return row;
  }

  private async counts(timezone: string, transaction?: Transaction): Promise<CountRow> {
    if (!this.sequelize) {
      return {
        daily_sent: 0,
        minute_sent: 0,
        queued: 0,
        retrying: 0,
        failed: 0,
        processing: 0,
        local_time: '00:00',
      };
    }
    const rows = await this.sequelize.query<CountRow>(
      `SELECT
        (SELECT COUNT(*) FROM marketing_delivery_attempts
          WHERE (attempted_at AT TIME ZONE :timezone)::date =
                (NOW() AT TIME ZONE :timezone)::date) AS daily_sent,
        (SELECT COUNT(*) FROM marketing_delivery_attempts
          WHERE attempted_at >= NOW() - INTERVAL '1 minute') AS minute_sent,
        COUNT(*) FILTER (WHERE status = 'PENDING') AS queued,
        COUNT(*) FILTER (WHERE status = 'RETRYING') AS retrying,
        COUNT(*) FILTER (WHERE status IN ('FAILED','BOUNCED','EXPIRED')) AS failed,
        COUNT(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at > NOW()) AS processing,
        TO_CHAR(NOW() AT TIME ZONE :timezone, 'HH24:MI') AS local_time
       FROM email_campaign_recipients`,
      { type: QueryTypes.SELECT, replacements: { timezone }, transaction },
    );
    return (
      rows[0] ?? {
        daily_sent: 0,
        minute_sent: 0,
        queued: 0,
        retrying: 0,
        failed: 0,
        processing: 0,
        local_time: '00:00',
      }
    );
  }

  async get(): Promise<MarketingDeliverySettingsResponse> {
    const row = await this.row();
    const counts = await this.counts(row.delivery_timezone);
    const interval = this.config.get<number>('marketing.worker.intervalMs') ?? 60_000;
    const last = iso(row.last_worker_run_at);
    return {
      paused: row.paused,
      daily_send_cap: row.daily_send_cap,
      per_minute_send_cap: row.per_minute_send_cap,
      delivery_timezone: row.delivery_timezone,
      allowed_window_start: row.allowed_window_start?.slice(0, 5) ?? null,
      allowed_window_end: row.allowed_window_end?.slice(0, 5) ?? null,
      current_daily_sent_count: Number(counts.daily_sent),
      queued_count: Number(counts.queued),
      retrying_count: Number(counts.retrying),
      failed_count: Number(counts.failed),
      last_worker_run_at: last,
      next_expected_worker_run_at: last
        ? new Date(new Date(last).getTime() + interval).toISOString()
        : null,
      worker_enabled: this.config.get<boolean>('marketing.worker.enabled', true),
    };
  }

  async update(
    input: MarketingDeliverySettingsUpdateRequest,
  ): Promise<MarketingDeliverySettingsResponse> {
    const parsed = marketingDeliverySettingsUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid delivery settings');
    }
    const row = await this.row();
    await row.update({
      paused: parsed.data.paused,
      daily_send_cap: parsed.data.daily_send_cap,
      per_minute_send_cap: parsed.data.per_minute_send_cap,
      delivery_timezone: parsed.data.delivery_timezone,
      allowed_window_start: parsed.data.allowed_window_start,
      allowed_window_end: parsed.data.allowed_window_end,
    });
    return this.get();
  }

  async reserveClaimCapacity(
    requested: number,
    transaction: Transaction,
  ): Promise<MarketingClaimCapacity> {
    const row = await this.row({ transaction, lock: true });
    if (!this.config.get<boolean>('marketing.worker.enabled', true))
      return { allowed: 0, reason: 'disabled' };
    if (row.paused) return { allowed: 0, reason: 'paused' };
    const counts = await this.counts(row.delivery_timezone, transaction);
    if (
      !isWithinMarketingSendWindow(
        counts.local_time,
        row.allowed_window_start,
        row.allowed_window_end,
      )
    ) {
      return { allowed: 0, reason: 'outside_window' };
    }
    // Active leases are reservations. Counting them prevents two instances,
    // both inside the settings-row lock, from oversubscribing either cap.
    const reserved = Number(counts.processing);
    const dailyRemaining = row.daily_send_cap - Number(counts.daily_sent) - reserved;
    if (dailyRemaining <= 0) return { allowed: 0, reason: 'daily_cap' };
    const minuteRemaining = row.per_minute_send_cap - Number(counts.minute_sent) - reserved;
    if (minuteRemaining <= 0) return { allowed: 0, reason: 'minute_cap' };
    return {
      allowed: Math.max(0, Math.min(requested, dailyRemaining, minuteRemaining)),
      reason: 'available',
    };
  }

  async recordWorkerRun(summary: MarketingSweepSummary): Promise<void> {
    await this.settings.update(
      {
        last_worker_run_at: new Date(),
        last_worker_claimed: summary.claimed,
        last_worker_sent: summary.sent,
      },
      { where: { id: MARKETING_SETTINGS_ID } },
    );
  }
}
