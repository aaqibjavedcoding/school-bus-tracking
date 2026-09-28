import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingEventType,
  MarketingProviderEventType,
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
} from '@school-bus-tracking/shared-types';
import {
  MarketingEmailEventsService,
  normalizeProviderEventType,
  providerEventEmailDigest,
  signMarketingProviderEvent,
} from './marketing-email-events.service';
import {
  MARKETING_PROVIDER_EVENTS_DISABLED,
  MARKETING_PROVIDER_EVENT_MAX_BODY_BYTES,
  MARKETING_PROVIDER_EVENT_REJECTED,
} from './marketing.constants';

/**
 * The signed provider email-event ingest.
 *
 * This endpoint is the only unauthenticated write path that can silence an
 * address, so its tests are written from an attacker's side of the wire: a
 * forged signature, a replayed body, a stale timestamp and an oversized
 * payload must all bounce off, and every rejection must look identical from
 * outside. The honest caveat stands — plain Gmail SMTP sends no such events;
 * this is the door for a real event source, not a claim that one exists.
 */

const SECRET = 'provider-webhook-secret-32-chars!!';
const EMAIL = 'principal@school.test';
const RECIPIENT_ID = 'r0000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';

interface HarnessOptions {
  secret?: string;
  now?: () => Date;
  recipientStatus?: MarketingRecipientStatus;
}

function harness(options: HarnessOptions = {}) {
  const now = options.now ?? (() => new Date('2026-09-28T10:00:00.000Z'));
  const providerEvents: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const suppressCalls: Array<{
    email: string;
    reason: MarketingSuppressionReason;
    source: MarketingSuppressionSource;
  }> = [];
  const recipients = [
    {
      id: RECIPIENT_ID,
      campaign_id: CAMPAIGN_ID,
      normalized_email: EMAIL,
      provider_message_id: 'provider-message-1',
      status: options.recipientStatus ?? MarketingRecipientStatus.SENT,
      created_at: new Date('2026-09-27T10:00:00.000Z'),
    },
  ];

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const service = new MarketingEmailEventsService({
    providerEvents: {
      async findOrCreate(opts: {
        where: Record<string, unknown>;
        defaults: Record<string, unknown>;
      }) {
        const existing = providerEvents.find((row) => matches(row, opts.where));
        if (existing) {
          return [existing, false];
        }
        const row = { id: `pe-${providerEvents.length + 1}`, ...opts.defaults };
        providerEvents.push(row);
        return [row, true];
      },
    } as never,
    recipients: {
      async findOne(opts: { where: Record<string, unknown> }) {
        return recipients.find((row) => matches(row as never, opts.where)) ?? null;
      },
    } as never,
    events: {
      async create(values: Record<string, unknown>) {
        events.push(values);
        return values;
      },
    } as never,
    suppressions: {
      async suppress(
        email: string,
        reason: MarketingSuppressionReason,
        source: MarketingSuppressionSource,
      ) {
        suppressCalls.push({ email, reason, source });
        return { suppression: {}, created: true, suppressedRecipients: 1 };
      },
    } as never,
    secret: () => options.secret ?? SECRET,
    now,
  });

  const send = (
    payload: Record<string, unknown>,
    overrides: { timestamp?: string; signature?: string; rawBody?: string } = {},
  ) => {
    const rawBody = overrides.rawBody ?? JSON.stringify(payload);
    const timestamp = overrides.timestamp ?? String(Math.floor(now().getTime() / 1000));
    const signature =
      'signature' in overrides
        ? overrides.signature
        : signMarketingProviderEvent(SECRET, timestamp, rawBody);
    return service.ingest({ rawBody, timestamp, signature });
  };

  return { service, send, providerEvents, events, suppressCalls, recipients };
}

const hardBounce = (id = 'evt-1') => ({
  event_id: id,
  provider: 'testprovider',
  type: 'hard_bounce',
  email: EMAIL,
  message_id: 'provider-message-1',
});

async function rejects(promise: Promise<unknown>, message: string): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal((error as Error).message, message);
    return error as Error;
  }
  throw new assert.AssertionError({ message: 'expected the ingest to be rejected' });
}

describe('MarketingEmailEventsService — envelope verification', () => {
  it('is closed until a webhook secret is configured', async () => {
    const { send } = harness({ secret: '' });
    await rejects(send(hardBounce()), MARKETING_PROVIDER_EVENTS_DISABLED);
  });

  it('rejects an invalid signature', async () => {
    const { send, providerEvents, suppressCalls } = harness();
    await rejects(
      send(hardBounce(), { signature: 'f'.repeat(64) }),
      MARKETING_PROVIDER_EVENT_REJECTED,
    );
    assert.equal(providerEvents.length, 0);
    assert.equal(suppressCalls.length, 0, 'nothing is suppressed by an unsigned caller');
  });

  it('rejects a signature computed over a different body (tamper)', async () => {
    const now = () => new Date('2026-09-28T10:00:00.000Z');
    const { service } = harness({ now });
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const signed = JSON.stringify(hardBounce());
    const signature = signMarketingProviderEvent(SECRET, timestamp, signed);
    const tampered = JSON.stringify({ ...hardBounce(), email: 'someone.else@school.test' });

    await rejects(
      service.ingest({ rawBody: tampered, timestamp, signature }),
      MARKETING_PROVIDER_EVENT_REJECTED,
    );
  });

  it('rejects a missing or malformed signature header', async () => {
    const { send } = harness();
    for (const signature of [undefined, '', 'not-hex', 'sha256=zz']) {
      await rejects(
        send(hardBounce(), { signature: signature as never }),
        MARKETING_PROVIDER_EVENT_REJECTED,
      );
    }
  });

  it('rejects an expired or missing timestamp even with a valid signature', async () => {
    const now = () => new Date('2026-09-28T10:00:00.000Z');
    const { service } = harness({ now });
    const stale = String(Math.floor(now().getTime() / 1000) - 3600);
    const rawBody = JSON.stringify(hardBounce());

    await rejects(
      service.ingest({
        rawBody,
        timestamp: stale,
        signature: signMarketingProviderEvent(SECRET, stale, rawBody),
      }),
      MARKETING_PROVIDER_EVENT_REJECTED,
    );

    await rejects(
      service.ingest({
        rawBody,
        timestamp: undefined,
        signature: signMarketingProviderEvent(SECRET, '', rawBody),
      }),
      MARKETING_PROVIDER_EVENT_REJECTED,
    );
  });

  it('accepts a sha256= prefixed signature and a millisecond timestamp', async () => {
    const now = () => new Date('2026-09-28T10:00:00.000Z');
    const { service } = harness({ now });
    const timestamp = String(now().getTime());
    const rawBody = JSON.stringify(hardBounce('evt-ms'));

    const result = await service.ingest({
      rawBody,
      timestamp,
      signature: `sha256=${signMarketingProviderEvent(SECRET, timestamp, rawBody)}`,
    });
    assert.equal(result.accepted, true);
  });

  it('rejects an oversized body before parsing it', async () => {
    const { send } = harness();
    const huge = 'x'.repeat(MARKETING_PROVIDER_EVENT_MAX_BODY_BYTES + 10);
    await rejects(
      send({}, { rawBody: JSON.stringify({ pad: huge }) }),
      MARKETING_PROVIDER_EVENT_REJECTED,
    );
  });

  it('returns the same message for every rejection — no oracle', async () => {
    const { send } = harness();
    const messages = new Set<string>();
    messages.add(
      (await rejects(send(hardBounce(), { signature: 'a'.repeat(64) }), MARKETING_PROVIDER_EVENT_REJECTED))
        .message,
    );
    messages.add(
      (await rejects(send(hardBounce(), { timestamp: '1' }), MARKETING_PROVIDER_EVENT_REJECTED))
        .message,
    );
    messages.add(
      (await rejects(send({}, { rawBody: 'not json' }), MARKETING_PROVIDER_EVENT_REJECTED)).message,
    );
    assert.equal(messages.size, 1, 'one constant message for signature, timestamp and payload');
  });
});

describe('MarketingEmailEventsService — event handling', () => {
  it('suppresses on a hard bounce and records a safe campaign event', async () => {
    const { send, suppressCalls, providerEvents, events } = harness();

    const result = await send(hardBounce());

    assert.deepEqual(result, {
      accepted: true,
      duplicate: false,
      event_type: MarketingProviderEventType.HARD_BOUNCE,
      suppressed: true,
    });
    assert.equal(suppressCalls.length, 1);
    assert.equal(suppressCalls[0].reason, MarketingSuppressionReason.HARD_BOUNCE);
    assert.equal(suppressCalls[0].source, MarketingSuppressionSource.SYSTEM);
    assert.equal(events[0].event_type, MarketingEventType.BOUNCED);
    assert.equal(events[0].campaign_id, CAMPAIGN_ID);

    // The stored provider event keeps a digest, never the address.
    const stored = providerEvents[0];
    assert.equal(stored.email_digest, providerEventEmailDigest(EMAIL));
    assert.ok(!JSON.stringify(stored).includes(EMAIL), 'no address is stored in the clear');
  });

  it('suppresses on a complaint with the COMPLAINED reason', async () => {
    const { send, suppressCalls, events } = harness();

    const result = await send({
      event_id: 'evt-complaint',
      provider: 'testprovider',
      type: 'complaint',
      email: EMAIL,
    });

    assert.equal(result.suppressed, true);
    assert.equal(suppressCalls[0].reason, MarketingSuppressionReason.COMPLAINED);
    assert.equal(events[0].event_type, MarketingEventType.COMPLAINED);
  });

  it('never suppresses on a soft bounce or a delivery', async () => {
    const { send, suppressCalls } = harness();

    const soft = await send({
      event_id: 'evt-soft',
      provider: 'testprovider',
      type: 'soft_bounce',
      email: EMAIL,
    });
    const delivered = await send({
      event_id: 'evt-delivered',
      provider: 'testprovider',
      type: 'delivered',
      email: EMAIL,
    });

    assert.equal(soft.event_type, MarketingProviderEventType.SOFT_BOUNCE);
    assert.equal(soft.suppressed, false);
    assert.equal(delivered.event_type, MarketingProviderEventType.DELIVERED);
    assert.equal(delivered.suppressed, false);
    assert.equal(
      suppressCalls.length,
      0,
      'a full mailbox today is not a dead address forever',
    );
  });

  it('is idempotent: a replayed provider event id applies nothing twice', async () => {
    const { send, suppressCalls, providerEvents } = harness();

    const first = await send(hardBounce('evt-replay'));
    const second = await send(hardBounce('evt-replay'));

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.suppressed, false);
    assert.equal(providerEvents.length, 1);
    assert.equal(suppressCalls.length, 1, 'the suppression is applied exactly once');
  });

  it('accepts an unknown event type without acting on it', async () => {
    const { send, providerEvents, suppressCalls } = harness();

    const result = await send({
      event_id: 'evt-open',
      provider: 'testprovider',
      type: 'opened',
      email: EMAIL,
    });

    assert.deepEqual(result, {
      accepted: true,
      duplicate: false,
      event_type: null,
      suppressed: false,
    });
    assert.equal(providerEvents.length, 0);
    assert.equal(suppressCalls.length, 0);
  });

  it('rejects a signed payload with no usable event id', async () => {
    const { send } = harness();
    await rejects(
      send({ provider: 'testprovider', type: 'hard_bounce', email: EMAIL }),
      MARKETING_PROVIDER_EVENT_REJECTED,
    );
  });

  it('suppresses an address the platform has never sent to (future campaigns are protected)', async () => {
    const { send, suppressCalls, events } = harness();

    const result = await send({
      event_id: 'evt-unknown-address',
      provider: 'testprovider',
      type: 'hard_bounce',
      email: 'never.mailed@school.test',
    });

    assert.equal(result.suppressed, true, 'the address is on the do-not-send list from now on');
    assert.equal(suppressCalls[0].email, 'never.mailed@school.test');
    assert.equal(events.length, 0, 'no campaign event without a correlated recipient');
  });
});

describe('normalizeProviderEventType', () => {
  it('maps provider vocabularies onto the four supported events', () => {
    assert.equal(normalizeProviderEventType({ type: 'Delivery' }), MarketingProviderEventType.DELIVERED);
    assert.equal(
      normalizeProviderEventType({ event: 'permanent-bounce' }),
      MarketingProviderEventType.HARD_BOUNCE,
    );
    assert.equal(
      normalizeProviderEventType({ type: 'spam complaint' }),
      MarketingProviderEventType.COMPLAINT,
    );
    assert.equal(normalizeProviderEventType({ type: 'unknown-thing' }), null);
  });

  it('treats an unclassified bounce as soft, and only "hard" as hard', () => {
    assert.equal(
      normalizeProviderEventType({ type: 'bounce' }),
      MarketingProviderEventType.SOFT_BOUNCE,
      'suppressing on an unclassified bounce would silently shrink the audience',
    );
    assert.equal(
      normalizeProviderEventType({ type: 'bounce', bounce_type: 'hard' }),
      MarketingProviderEventType.HARD_BOUNCE,
    );
  });
});
