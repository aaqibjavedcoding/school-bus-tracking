import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingCampaignStatus,
  MarketingEventType,
  MarketingRecipientStatus,
} from '@school-bus-tracking/shared-types';
import { hashMarketingToken } from './marketing-message.builder';
import {
  MarketingTrackingService,
  MARKETING_ATTRIBUTION_COOKIE,
} from './marketing-tracking.service';
import { MARKETING_TRACKING_TOKEN_INVALID } from './marketing.constants';

/**
 * The public tracking surface: the only marketing code an unauthenticated
 * stranger can reach.
 *
 * The tests below are mostly about what must *not* happen — an open redirect,
 * a token oracle, an inflated unique-click figure, a PII leak in the
 * response, or an unsubscribe that silently disables somebody's password
 * reset mail.
 */

const APP_URL = 'https://app.zeromilesystems.test';
const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';
const RECIPIENT_ID = 'r0000000-0000-4000-8000-000000000001';
const CLICK_TOKEN = 'a'.repeat(64);
const UNSUB_TOKEN = 'b'.repeat(64);

interface RecipientRow {
  id: string;
  campaign_id: string;
  normalized_email: string;
  status: string;
  click_token_hash: string | null;
  unsubscribe_token_hash: string | null;
  click_count: number;
  first_clicked_at: Date | null;
  unsubscribed_at: Date | null;
  next_attempt_at: Date | null;
  locked_by: string | null;
  lease_expires_at: Date | null;
}

function recipientRow(overrides: Partial<RecipientRow> = {}): RecipientRow {
  return {
    id: RECIPIENT_ID,
    campaign_id: CAMPAIGN_ID,
    normalized_email: 'principal@school.test',
    status: MarketingRecipientStatus.SENT,
    click_token_hash: hashMarketingToken(CLICK_TOKEN),
    unsubscribe_token_hash: hashMarketingToken(UNSUB_TOKEN),
    click_count: 0,
    first_clicked_at: null,
    unsubscribed_at: null,
    next_attempt_at: null,
    locked_by: null,
    lease_expires_at: null,
    ...overrides,
  };
}

function harness(options: {
  recipients?: RecipientRow[];
  campaignStatus?: MarketingCampaignStatus;
  campaignMissing?: boolean;
  suppressions?: string[];
} = {}) {
  const recipients = options.recipients ?? [recipientRow()];
  const suppressions = new Set(options.suppressions ?? []);
  const events: Array<Record<string, unknown>> = [];
  const campaignRow: Record<string, unknown> = {
    id: CAMPAIGN_ID,
    status: options.campaignStatus ?? MarketingCampaignStatus.COMPLETED,
    clicked_count: 0,
    total_click_count: 0,
    unsubscribed_count: 0,
  };

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // `{ [Op.in]: [...] }` — Sequelize operators are symbol keys.
        const operand = Object.getOwnPropertySymbols(value as object)
          .map((symbol) => (value as Record<symbol, unknown>)[symbol])
          .find(Array.isArray) as unknown[] | undefined;
        return Array.isArray(operand) ? operand.includes(row[key]) : false;
      }
      if (value === null) {
        return row[key] === null || row[key] === undefined;
      }
      return row[key] === value;
    });

  const service = new MarketingTrackingService({
    recipients: {
      findOne: async (opts: { where: Record<string, unknown> }) =>
        recipients.find((row) => matches(row as unknown as Record<string, unknown>, opts.where)) ??
        null,
      update: async (values: Record<string, unknown>, opts: { where: Record<string, unknown> }) => {
        let affected = 0;
        for (const row of recipients) {
          if (matches(row as unknown as Record<string, unknown>, opts.where)) {
            Object.assign(row, values);
            affected += 1;
          }
        }
        return [affected];
      },
      increment: async (column: string, opts: { where: Record<string, unknown> }) => {
        for (const row of recipients) {
          if (matches(row as unknown as Record<string, unknown>, opts.where)) {
            (row as unknown as Record<string, number>)[column] += 1;
          }
        }
      },
    } as never,
    campaigns: {
      findOne: async () => (options.campaignMissing ? null : campaignRow),
      increment: async (column: string) => {
        campaignRow[column] = ((campaignRow[column] as number) ?? 0) + 1;
      },
    } as never,
    events: {
      create: async (row: Record<string, unknown>) => {
        events.push(row);
        return row;
      },
    } as never,
    suppressions: {
      findOrCreate: async (opts: { where: { normalized_email: string } }) => {
        const exists = suppressions.has(opts.where.normalized_email);
        suppressions.add(opts.where.normalized_email);
        return [{ normalized_email: opts.where.normalized_email }, !exists];
      },
    } as never,
    appUrl: () => APP_URL,
  });

  return { service, recipients, campaignRow, events, suppressions };
}

describe('MarketingTrackingService — clicks', () => {
  it('records a click and redirects to the configured landing page', async () => {
    const context = harness();

    const result = await context.service.recordClick(CLICK_TOKEN);

    const url = new URL(result.redirectUrl);
    assert.equal(url.origin, APP_URL);
    assert.equal(url.pathname, '/');
    assert.equal(context.recipients[0].click_count, 1);
    assert.ok(context.recipients[0].first_clicked_at instanceof Date);
    assert.equal(context.campaignRow.total_click_count, 1);
    assert.equal(context.campaignRow.clicked_count, 1);
    assert.equal(context.events[0].event_type, MarketingEventType.CLICKED);
  });

  it('counts a repeated click in totals but not in unique clicks', async () => {
    const context = harness();

    await context.service.recordClick(CLICK_TOKEN);
    const second = await context.service.recordClick(CLICK_TOKEN);

    assert.equal(second.repeat, true);
    assert.equal(context.recipients[0].click_count, 2);
    assert.equal(context.campaignRow.total_click_count, 2);
    assert.equal(context.campaignRow.clicked_count, 1, 'a double-click is one reader');
  });

  it('rejects an unknown token with the same message as a malformed one', async () => {
    const context = harness();

    const unknown = await context.service
      .recordClick('c'.repeat(64))
      .catch((error: { message: string; getStatus?: () => number }) => error);
    const malformed = await context.service
      .recordClick('not-a-token')
      .catch((error: { message: string; getStatus?: () => number }) => error);

    assert.equal((unknown as { message: string }).message, MARKETING_TRACKING_TOKEN_INVALID);
    assert.equal((malformed as { message: string }).message, MARKETING_TRACKING_TOKEN_INVALID);
    assert.equal((unknown as { getStatus?: () => number }).getStatus?.(), 404);
    assert.equal(context.events.length, 0, 'a rejected click records nothing');
  });

  it('refuses to attribute clicks for a cancelled campaign', async () => {
    const context = harness({ campaignStatus: MarketingCampaignStatus.CANCELLED });

    await assert.rejects(context.service.recordClick(CLICK_TOKEN));
    assert.equal(context.recipients[0].click_count, 0);
  });

  it('cannot be turned into an open redirect', async () => {
    const context = harness();

    const result = await context.service.recordClick(
      CLICK_TOKEN,
      new URLSearchParams('next=https://evil.test/steal&redirect=//evil.test&url=https://evil.test'),
    );

    const url = new URL(result.redirectUrl);
    assert.equal(url.origin, APP_URL, 'the origin comes from APP_URL, never from the request');
    assert.equal(url.searchParams.has('next'), false);
    assert.equal(url.searchParams.has('redirect'), false);
    assert.equal(url.searchParams.has('url'), false);
    assert.equal(result.redirectUrl.includes('evil.test'), false);
  });

  it('preserves only allowlisted UTM parameters', async () => {
    const context = harness();

    const result = await context.service.recordClick(
      CLICK_TOKEN,
      new URLSearchParams('utm_source=newsletter&utm_campaign=autumn&evil=1'),
    );

    const url = new URL(result.redirectUrl);
    assert.equal(url.searchParams.get('utm_source'), 'newsletter');
    assert.equal(url.searchParams.get('utm_campaign'), 'autumn');
    assert.equal(url.searchParams.get('utm_medium'), 'email', 'a default is supplied');
    assert.equal(url.searchParams.has('evil'), false);
  });

  it('returns an opaque attribution value, never an internal id', async () => {
    const context = harness();

    const result = await context.service.recordClick(CLICK_TOKEN);

    // Session 4: the click cookie carries campaign AND recipient digests
    // (`campaignDigest.recipientDigest`) so demo-request attribution can point
    // at the exact clicked recipient — still opaque, never internal ids.
    assert.match(result.attributionValue, /^[a-f0-9]{32}\.[a-f0-9]{32}$/);
    assert.equal(result.attributionValue.includes(CAMPAIGN_ID), false);
    assert.equal(result.attributionValue.includes(RECIPIENT_ID), false);
    assert.ok(MARKETING_ATTRIBUTION_COOKIE.length > 0);
  });

  it('never echoes the raw token back into the redirect', async () => {
    const context = harness();
    const result = await context.service.recordClick(CLICK_TOKEN);
    assert.equal(result.redirectUrl.includes(CLICK_TOKEN), false);
  });
});

describe('MarketingTrackingService — unsubscribe', () => {
  it('suppresses the address and confirms without revealing it', async () => {
    const context = harness();

    const result = await context.service.unsubscribe(UNSUB_TOKEN);

    assert.equal(result.unsubscribed, true);
    assert.equal(result.already_unsubscribed, false);
    assert.equal(context.suppressions.has('principal@school.test'), true);
    assert.equal(
      result.message.includes('principal@school.test'),
      false,
      'the confirmation must not print the address back to whoever opened the link',
    );
    assert.equal(context.campaignRow.unsubscribed_count, 1);
    assert.equal(context.events[0].event_type, MarketingEventType.UNSUBSCRIBED);
  });

  it('is idempotent: a second click succeeds and double-counts nothing', async () => {
    const context = harness();

    await context.service.unsubscribe(UNSUB_TOKEN);
    const second = await context.service.unsubscribe(UNSUB_TOKEN);

    assert.equal(second.unsubscribed, true);
    assert.equal(second.already_unsubscribed, true);
    assert.equal(context.campaignRow.unsubscribed_count, 1);
    assert.equal(context.events.length, 1, 'one opt-out is one event');
  });

  it('skips every not-yet-sent recipient row for that address', async () => {
    const queued = recipientRow({
      id: 'r-queued',
      campaign_id: 'other-campaign',
      status: MarketingRecipientStatus.PENDING,
      click_token_hash: null,
      unsubscribe_token_hash: null,
    });
    const alreadySent = recipientRow({
      id: 'r-sent',
      campaign_id: 'third-campaign',
      status: MarketingRecipientStatus.SENT,
      click_token_hash: null,
      unsubscribe_token_hash: null,
    });
    const context = harness({ recipients: [recipientRow(), queued, alreadySent] });

    await context.service.unsubscribe(UNSUB_TOKEN);

    assert.equal(
      queued.status,
      MarketingRecipientStatus.SUPPRESSED,
      'an opt-out mid-campaign must stop the queued copies too',
    );
    assert.equal(queued.locked_by, null);
    assert.equal(
      alreadySent.status,
      MarketingRecipientStatus.SENT,
      'history is preserved — analytics are never rewritten',
    );
  });

  it('still honours the opt-out link of a cancelled campaign', async () => {
    // The message is already in the inbox; refusing the opt-out would be both
    // rude and non-compliant.
    const context = harness({ campaignStatus: MarketingCampaignStatus.CANCELLED });
    const result = await context.service.unsubscribe(UNSUB_TOKEN);
    assert.equal(result.unsubscribed, true);
  });

  it('rejects an invalid token with the shared safe message', async () => {
    const context = harness();
    await assert.rejects(
      context.service.unsubscribe('d'.repeat(64)),
      (error: { message: string }) => {
        assert.equal(error.message, MARKETING_TRACKING_TOKEN_INVALID);
        return true;
      },
    );
    assert.equal(context.suppressions.size, 0);
  });

  it('cannot be driven by a click token (the two rails are separate)', async () => {
    const context = harness();
    await assert.rejects(context.service.unsubscribe(CLICK_TOKEN));
  });

  it('records the click-token digest lookup, never a plaintext comparison', async () => {
    // The row only ever holds digests; if the service compared raw values the
    // lookup below would find nothing.
    const context = harness();
    assert.equal(context.recipients[0].click_token_hash, hashMarketingToken(CLICK_TOKEN));
    await context.service.recordClick(CLICK_TOKEN);
    assert.equal(context.recipients[0].click_count, 1);
  });
});
