import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { MarketingCampaignStatus } from '@school-bus-tracking/shared-types';
import {
  MarketingAttributionService,
  hashAttributionNonce,
  MARKETING_ATTRIBUTION_MAX_USES,
  MARKETING_ATTRIBUTION_TTL_MS,
  MARKETING_SIGNED_ATTRIBUTION_PATTERN,
} from './marketing-attribution.service';

/**
 * Campaign attribution after Hardening 5B: a signed cookie resolved by a
 * single indexed probe.
 *
 * The properties under test are the ones the old digest-scan resolver could
 * not offer — a forged cookie is rejected before any query runs, resolution
 * costs the same against 5 rows and 50 000, and a stolen cookie cannot be
 * replayed forever. The forwarded-email caveat is deliberately preserved:
 * attribution names the original *recipient*, not the human who clicked.
 */

const SECRET = 'attribution-secret-value-32-chars!!';
const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';
const OTHER_CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000002';
const RECIPIENT_ID = 'r0000000-0000-4000-8000-000000000001';
const OTHER_RECIPIENT_ID = 'r0000000-0000-4000-8000-000000000002';

interface GrantRow {
  id: string;
  nonce_digest: string;
  campaign_id: string;
  campaign_recipient_id: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  use_count: number;
}

interface HarnessOptions {
  secret?: string;
  now?: () => Date;
  campaignStatus?: MarketingCampaignStatus;
  /** Extra recipients/campaigns, to show lookup cost does not grow. */
  extraRows?: number;
  nonce?: string;
}

function harness(options: HarnessOptions = {}) {
  const grants: GrantRow[] = [];
  const queries: string[] = [];
  const now = options.now ?? (() => new Date('2026-09-28T10:00:00.000Z'));

  const campaigns = [
    {
      id: CAMPAIGN_ID,
      status: options.campaignStatus ?? MarketingCampaignStatus.SENDING,
      attribution_digest: createHash('sha256').update(CAMPAIGN_ID).digest('hex').slice(0, 32),
    },
    {
      id: OTHER_CAMPAIGN_ID,
      status: MarketingCampaignStatus.SENDING,
      attribution_digest: createHash('sha256')
        .update(OTHER_CAMPAIGN_ID)
        .digest('hex')
        .slice(0, 32),
    },
  ];
  const recipients = [
    {
      id: RECIPIENT_ID,
      campaign_id: CAMPAIGN_ID,
      attribution_digest: createHash('sha256').update(RECIPIENT_ID).digest('hex').slice(0, 32),
    },
    {
      id: OTHER_RECIPIENT_ID,
      campaign_id: OTHER_CAMPAIGN_ID,
      attribution_digest: createHash('sha256')
        .update(OTHER_RECIPIENT_ID)
        .digest('hex')
        .slice(0, 32),
    },
  ];
  for (let i = 0; i < (options.extraRows ?? 0); i += 1) {
    recipients.push({
      id: `filler-${i}`,
      campaign_id: CAMPAIGN_ID,
      attribution_digest: createHash('sha256').update(`filler-${i}`).digest('hex').slice(0, 32),
    });
  }

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) =>
      value === null ? row[key] === null || row[key] === undefined : row[key] === value,
    );

  let sequence = 0;
  const attributions = {
    async create(values: Record<string, unknown>) {
      queries.push('attributions.create');
      sequence += 1;
      const row = { id: `grant-${sequence}`, ...values } as unknown as GrantRow;
      grants.push(row);
      return row;
    },
    async findOne(opts: { where: Record<string, unknown> }) {
      queries.push('attributions.findOne');
      return grants.find((row) => matches(row as never, opts.where)) ?? null;
    },
    async increment(column: string, opts: { where: Record<string, unknown> }) {
      queries.push('attributions.increment');
      for (const row of grants) {
        if (matches(row as never, opts.where)) {
          (row as unknown as Record<string, number>)[column] += 1;
        }
      }
    },
    async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      queries.push('attributions.update');
      for (const row of grants) {
        if (matches(row as never, opts.where)) {
          Object.assign(row, values);
        }
      }
      return [1];
    },
  };

  const campaignsModel = {
    async findOne(opts: { where: Record<string, unknown> }) {
      queries.push('campaigns.findOne');
      return campaigns.find((row) => matches(row as never, opts.where)) ?? null;
    },
    async findAll() {
      queries.push('campaigns.findAll');
      return campaigns;
    },
  };
  const recipientsModel = {
    async findOne(opts: { where: Record<string, unknown> }) {
      queries.push('recipients.findOne');
      return recipients.find((row) => matches(row as never, opts.where)) ?? null;
    },
    async findAll() {
      queries.push('recipients.findAll');
      return recipients;
    },
  };

  const service = new MarketingAttributionService({
    attributions: attributions as never,
    campaigns: campaignsModel as never,
    recipients: recipientsModel as never,
    secret: () => options.secret ?? SECRET,
    now,
    randomNonce: options.nonce ? () => options.nonce as string : undefined,
  });

  return { service, grants, queries, campaigns, recipients };
}

describe('MarketingAttributionService — issuing', () => {
  it('mints a signed cookie and stores only the digest of the nonce', async () => {
    const { service, grants } = harness();

    const cookie = await service.issue(CAMPAIGN_ID, RECIPIENT_ID);

    assert.ok(cookie, 'a cookie is issued');
    assert.match(cookie, MARKETING_SIGNED_ATTRIBUTION_PATTERN);
    const [, nonce] = cookie.split('.');
    assert.equal(grants.length, 1);
    assert.equal(grants[0].nonce_digest, hashAttributionNonce(nonce));
    assert.ok(
      !JSON.stringify(grants[0]).includes(nonce),
      'the raw nonce is never persisted — a database leak yields no usable cookie',
    );
    assert.equal(grants[0].campaign_id, CAMPAIGN_ID);
    assert.equal(grants[0].campaign_recipient_id, RECIPIENT_ID);
    assert.equal(grants[0].use_count, 0);
  });

  it('carries no email address and no identifier in the cookie itself', async () => {
    const { service } = harness();
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    assert.ok(!cookie.includes('@'));
    assert.ok(!cookie.includes(CAMPAIGN_ID));
    assert.ok(!cookie.includes(RECIPIENT_ID));
  });

  it('issues nothing without a configured secret (the caller falls back)', async () => {
    const { service, grants } = harness({ secret: 'short' });
    assert.equal(service.isSigningEnabled(), false);
    assert.equal(await service.issue(CAMPAIGN_ID, RECIPIENT_ID), null);
    assert.equal(grants.length, 0);
  });

  it('never breaks the recipient s redirect when the grant cannot be written', async () => {
    const service = new MarketingAttributionService({
      attributions: {
        create: async () => {
          throw new Error('insert failed');
        },
      } as never,
      campaigns: {} as never,
      recipients: {} as never,
      secret: () => SECRET,
    });
    assert.equal(await service.issue(CAMPAIGN_ID, RECIPIENT_ID), null);
  });
});

describe('MarketingAttributionService — resolving', () => {
  it('resolves a valid cookie to its campaign and recipient', async () => {
    const { service } = harness();
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    const resolved = await service.resolve(cookie);

    assert.deepEqual(resolved, {
      campaign_id: CAMPAIGN_ID,
      campaign_recipient_id: RECIPIENT_ID,
    });
  });

  it('rejects a forged cookie before it ever touches the database', async () => {
    const { service, queries } = harness();
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;
    const [version, nonce, expiry] = cookie.split('.');
    const forged = `${version}.${nonce}.${expiry}.${'0'.repeat(32)}`;
    queries.length = 0;

    assert.equal(await service.resolve(forged), null);
    assert.equal(
      queries.length,
      0,
      'an unauthenticated visitor cannot turn a guess into a database probe',
    );
  });

  it('rejects a cookie signed with a different secret', async () => {
    const minted = harness({ secret: 'a-completely-different-secret-key!!' });
    const cookie = (await minted.service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    const verifier = harness();
    assert.equal(await verifier.service.resolve(cookie), null);
  });

  it('rejects an expired cookie, and one whose expiry was edited', async () => {
    let clock = new Date('2026-09-28T10:00:00.000Z');
    const { service } = harness({ now: () => clock });
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    clock = new Date(clock.getTime() + MARKETING_ATTRIBUTION_TTL_MS + 1000);
    assert.equal(await service.resolve(cookie), null, 'expired');

    // Editing the expiry invalidates the signature it is part of.
    const [version, nonce, , signature] = cookie.split('.');
    const extended = `${version}.${nonce}.${clock.getTime() + 1_000_000}.${signature}`;
    assert.equal(await service.resolve(extended), null, 'not extendable by editing');
  });

  it('stops resolving a cookie that is replayed past the reuse limit', async () => {
    const { service, grants } = harness();
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    for (let i = 0; i < MARKETING_ATTRIBUTION_MAX_USES; i += 1) {
      assert.notEqual(await service.resolve(cookie), null, `use ${i + 1} is allowed`);
    }
    assert.equal(grants[0].use_count, MARKETING_ATTRIBUTION_MAX_USES);
    assert.equal(await service.resolve(cookie), null, 'replay beyond the limit resolves to nothing');
  });

  it('resolves repeated clicks to independent grants', async () => {
    const { service, grants } = harness();
    const first = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;
    const second = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    assert.notEqual(first, second, 'each click mints a fresh nonce');
    assert.equal(grants.length, 2);
    assert.notEqual(await service.resolve(first), null);
    assert.notEqual(await service.resolve(second), null);
  });

  it('attributes to the campaign only when the recipient no longer belongs to it', async () => {
    const { service, grants } = harness();
    await service.issue(CAMPAIGN_ID, RECIPIENT_ID);
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;
    // Rebind the grant to a recipient of a different campaign.
    grants[1].campaign_recipient_id = OTHER_RECIPIENT_ID;

    const resolved = await service.resolve(cookie);

    assert.deepEqual(resolved, { campaign_id: CAMPAIGN_ID, campaign_recipient_id: null });
  });

  it('resolves to nothing for a cancelled campaign', async () => {
    const { service } = harness({ campaignStatus: MarketingCampaignStatus.CANCELLED });
    const cookie = (await service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;

    assert.equal(await service.resolve(cookie), null);
  });

  it('resolves to nothing for garbage, oversized and absent cookies', async () => {
    const { service, queries } = harness();
    queries.length = 0;
    for (const value of [undefined, '', '   ', 'not-a-cookie', 'v2.' + 'x'.repeat(600)]) {
      assert.equal(await service.resolve(value as never), null);
    }
    assert.equal(queries.length, 0, 'no shape-invalid value reaches the database');
  });

  it('costs one indexed probe regardless of how many rows exist', async () => {
    const small = harness();
    const smallCookie = (await small.service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;
    small.queries.length = 0;
    await small.service.resolve(smallCookie);
    const smallQueries = [...small.queries];

    const large = harness({ extraRows: 5000 });
    const largeCookie = (await large.service.issue(CAMPAIGN_ID, RECIPIENT_ID)) as string;
    large.queries.length = 0;
    await large.service.resolve(largeCookie);

    assert.deepEqual(large.queries, smallQueries, 'the same queries, whatever the dataset size');
    assert.ok(
      !large.queries.some((entry) => entry.endsWith('findAll')),
      'resolution never scans a table',
    );
  });
});

describe('MarketingAttributionService — legacy cookies', () => {
  it('still resolves a pre-5B digest cookie, by index', async () => {
    const { service, campaigns, recipients, queries } = harness();
    const legacy = `${campaigns[0].attribution_digest}.${recipients[0].attribution_digest}`;
    queries.length = 0;

    const resolved = await service.resolve(legacy);

    assert.deepEqual(resolved, {
      campaign_id: CAMPAIGN_ID,
      campaign_recipient_id: RECIPIENT_ID,
    });
    assert.ok(!queries.some((entry) => entry.endsWith('findAll')), 'no scan for old cookies either');
  });

  it('downgrades a legacy cookie whose recipient half belongs elsewhere', async () => {
    const { service, campaigns, recipients } = harness();
    const mismatched = `${campaigns[0].attribution_digest}.${recipients[1].attribution_digest}`;

    assert.deepEqual(await service.resolve(mismatched), {
      campaign_id: CAMPAIGN_ID,
      campaign_recipient_id: null,
    });
  });
});
