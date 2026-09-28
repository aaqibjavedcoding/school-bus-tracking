import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { marketingDeliverySettingsUpdateSchema } from '@school-bus-tracking/validation';
import { getMarketingSettings, putMarketingSettings } from '../../api/marketing';
import {
  MarketingDeliverySettingsService,
  isWithinMarketingSendWindow,
  isValidIanaTimezone,
} from './marketing-delivery-settings.service';

function capacityHarness(overrides: Record<string, unknown> = {}, counts: Record<string, unknown> = {}) {
  const row = {
    id: 1,
    paused: false,
    daily_send_cap: 100,
    per_minute_send_cap: 20,
    delivery_timezone: 'UTC',
    allowed_window_start: null,
    allowed_window_end: null,
    reload: async () => row,
    update: async (values: Record<string, unknown>) => Object.assign(row, values),
    ...overrides,
  };
  const model = {
    findOrCreate: async () => [row, false],
    update: async () => [1],
  };
  const sequelize = {
    query: async () => [{
      daily_sent: 0,
      minute_sent: 0,
      queued: 10,
      retrying: 0,
      failed: 0,
      processing: 0,
      local_time: '12:00',
      ...counts,
    }],
  };
  const config = { get: (_key: string, fallback?: unknown) => fallback };
  return new MarketingDeliverySettingsService(model as never, sequelize as never, config as never);
}

const valid = {
  paused: false,
  daily_send_cap: 500,
  per_minute_send_cap: 60,
  delivery_timezone: 'Asia/Kolkata',
  allowed_window_start: '08:00',
  allowed_window_end: '18:00',
};

describe('marketing delivery settings authorization and validation', () => {
  it('keeps reads and writes SUPER_ADMIN-only', () => {
    assert.deepEqual(getMarketingSettings.roles, [UserRole.SUPER_ADMIN]);
    assert.deepEqual(putMarketingSettings.roles, [UserRole.SUPER_ADMIN]);
  });

  it('enforces server safety bounds and rejects arbitrary schedule syntax', () => {
    assert.equal(marketingDeliverySettingsUpdateSchema.safeParse(valid).success, true);
    assert.equal(marketingDeliverySettingsUpdateSchema.safeParse({ ...valid, daily_send_cap: 0 }).success, false);
    assert.equal(marketingDeliverySettingsUpdateSchema.safeParse({ ...valid, daily_send_cap: 10001 }).success, false);
    assert.equal(marketingDeliverySettingsUpdateSchema.safeParse({ ...valid, per_minute_send_cap: 301 }).success, false);
    assert.equal(marketingDeliverySettingsUpdateSchema.safeParse({ ...valid, delivery_timezone: '* * * * *' }).success, false);
    assert.equal(marketingDeliverySettingsUpdateSchema.safeParse({ ...valid, allowed_window_end: null }).success, false);
  });

  it('accepts real IANA zones and rejects fabricated zones', () => {
    assert.equal(isValidIanaTimezone('UTC'), true);
    assert.equal(isValidIanaTimezone('Asia/Kolkata'), true);
    assert.equal(isValidIanaTimezone('Mars/Olympus'), false);
  });
});

describe('allowed marketing delivery window', () => {
  it('handles daytime, unrestricted and overnight windows', () => {
    assert.equal(isWithinMarketingSendWindow('09:00', '08:00', '18:00'), true);
    assert.equal(isWithinMarketingSendWindow('19:00', '08:00', '18:00'), false);
    assert.equal(isWithinMarketingSendWindow('03:00', null, null), true);
    assert.equal(isWithinMarketingSendWindow('23:30', '22:00', '06:00'), true);
    assert.equal(isWithinMarketingSendWindow('05:59', '22:00', '06:00'), true);
    assert.equal(isWithinMarketingSendWindow('12:00', '22:00', '06:00'), false);
  });
});

describe('durable cross-worker capacity', () => {
  const transaction = {} as never;

  it('pause preserves work by granting no new claims', async () => {
    const result = await capacityHarness({ paused: true }).reserveClaimCapacity(25, transaction);
    assert.deepEqual(result, { allowed: 0, reason: 'paused' });
  });

  it('reserves only remaining daily capacity and survives service restart', async () => {
    const counts = { daily_sent: 98, processing: 1 };
    const first = await capacityHarness({}, counts).reserveClaimCapacity(25, transaction);
    const afterRestart = await capacityHarness({}, counts).reserveClaimCapacity(25, transaction);
    assert.deepEqual(first, { allowed: 1, reason: 'available' });
    assert.deepEqual(afterRestart, first, 'capacity comes from PostgreSQL counts, not process memory');
  });

  it('enforces the global per-minute cap including active lease reservations', async () => {
    const result = await capacityHarness({}, { minute_sent: 18, processing: 2 })
      .reserveClaimCapacity(25, transaction);
    assert.deepEqual(result, { allowed: 0, reason: 'minute_cap' });
  });

  it('keeps queued work untouched outside the configured timezone window', async () => {
    const result = await capacityHarness({ allowed_window_start: '22:00', allowed_window_end: '06:00' }, { local_time: '12:00' })
      .reserveClaimCapacity(25, transaction);
    assert.deepEqual(result, { allowed: 0, reason: 'outside_window' });
  });
});
