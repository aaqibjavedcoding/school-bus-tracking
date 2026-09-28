import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import {
  MarketingRecipientStatus,
  MarketingSuppressionReason,
  MarketingSuppressionSource,
} from '@school-bus-tracking/shared-types';
import {
  MarketingSuppressionsService,
  marketingEmailDigest,
  maskMarketingEmail,
  normalizeMarketingEmail,
  toSuppressionSummary,
} from './marketing-suppressions.service';
import {
  MARKETING_SUPPRESSION_CONFIRM_REQUIRED,
  MARKETING_SUPPRESSION_INVALID_EMAIL,
  MARKETING_SUPPRESSION_NOT_FOUND,
  MARKETING_SUPPRESSION_UNSUBSCRIBE_PROTECTED,
} from './marketing.constants';

/**
 * The do-not-send list.
 *
 * Three promises are pinned here, because breaking any of them is either a
 * privacy incident or a legal one: the console never hands out a full
 * address, suppression takes effect on queued mail without rewriting
 * history, and an unsubscribe cannot be removed by accident.
 */

const EMAIL = 'principal@school.test';

interface SuppressionRow extends Record<string, unknown> {
  id: string;
  normalized_email: string;
  reason: MarketingSuppressionReason;
  source: MarketingSuppressionSource;
  created_at: Date;
  updated_at: Date;
  update(values: Record<string, unknown>): Promise<void>;
}

interface RecipientRow extends Record<string, unknown> {
  id: string;
  normalized_email: string;
  status: MarketingRecipientStatus;
}

function harness(
  options: { suppressions?: Array<Partial<SuppressionRow>>; recipients?: RecipientRow[] } = {},
) {
  const now = () => new Date('2026-09-28T10:00:00.000Z');
  const rows: SuppressionRow[] = [];
  const recipients: RecipientRow[] = options.recipients ?? [];
  let sequence = 0;

  const make = (values: Partial<SuppressionRow>): SuppressionRow => {
    sequence += 1;
    const row = {
      id: values.id ?? `sup-${sequence}`,
      normalized_email: values.normalized_email ?? EMAIL,
      reason: values.reason ?? MarketingSuppressionReason.MANUAL,
      source: values.source ?? MarketingSuppressionSource.SUPER_ADMIN,
      created_at: values.created_at ?? now(),
      updated_at: values.updated_at ?? now(),
      async update(next: Record<string, unknown>) {
        Object.assign(row, next, { updated_at: now() });
      },
    } as SuppressionRow;
    return row;
  };

  for (const seed of options.suppressions ?? []) {
    rows.push(make(seed));
  }

  const suppressions = {
    async findOrCreate(opts: { where: Record<string, unknown>; defaults: Record<string, unknown> }) {
      const existing = rows.find(
        (row) => row.normalized_email === opts.where.normalized_email,
      );
      if (existing) {
        return [existing, false];
      }
      const created = make(opts.defaults as Partial<SuppressionRow>);
      rows.push(created);
      return [created, true];
    },
    async findOne(opts: { where: Record<string, unknown> }) {
      return rows.find((row) => row.id === opts.where.id) ?? null;
    },
    async findAndCountAll(opts: {
      where: Record<string, unknown>;
      offset: number;
      limit: number;
    }) {
      const where = opts.where ?? {};
      const filtered = rows.filter((row) => {
        if (where.reason && row.reason !== where.reason) return false;
        const email = where.normalized_email as
          | string
          | { [Op.like]: string }
          | undefined;
        if (typeof email === 'string') {
          return row.normalized_email === email;
        }
        if (email && typeof email === 'object') {
          const pattern = (email as Record<symbol, string>)[Op.like];
          return row.normalized_email.endsWith(pattern.replace('%', ''));
        }
        return true;
      });
      return {
        rows: filtered.slice(opts.offset, opts.offset + opts.limit),
        count: filtered.length,
      };
    },
    async destroy(opts: { where: Record<string, unknown> }) {
      const index = rows.findIndex((row) => row.id === opts.where.id);
      if (index >= 0) {
        rows.splice(index, 1);
        return 1;
      }
      return 0;
    },
  };

  const recipientsModel = {
    async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      const where = opts.where as {
        normalized_email: string;
        status: Record<symbol, MarketingRecipientStatus[]>;
      };
      const statuses = where.status[Op.in];
      let affected = 0;
      for (const row of recipients) {
        if (row.normalized_email === where.normalized_email && statuses.includes(row.status)) {
          Object.assign(row, values);
          affected += 1;
        }
      }
      return [affected];
    },
  };

  const service = new MarketingSuppressionsService({
    suppressions: suppressions as never,
    recipients: recipientsModel as never,
    now,
  });

  return { service, rows, recipients };
}

describe('address masking and digests', () => {
  it('shows only the first two characters and the domain', () => {
    assert.equal(maskMarketingEmail('zeromilesystems@gmail.com'), 'ze***@gmail.com');
    assert.equal(maskMarketingEmail('A@b.test'), 'a***@b.test');
    assert.equal(maskMarketingEmail('not-an-email'), '***');
  });

  it('digests are stable, address-free and the only audit-safe form', () => {
    const digest = marketingEmailDigest(' Principal@School.TEST ');
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digest, marketingEmailDigest(EMAIL), 'normalized before hashing');
    assert.ok(!digest.includes('school'));
  });

  it('rejects malformed addresses with a safe message', () => {
    for (const value of ['', 'nope', 'a@', '@b.test', `${'x'.repeat(250)}@b.test`]) {
      assert.throws(() => normalizeMarketingEmail(value), {
        message: MARKETING_SUPPRESSION_INVALID_EMAIL,
      });
    }
    assert.equal(normalizeMarketingEmail('  Principal@School.TEST '), EMAIL);
  });

  it('projects a row without ever exposing the mailbox', () => {
    const summary = toSuppressionSummary({
      id: 'sup-1',
      normalized_email: EMAIL,
      reason: MarketingSuppressionReason.HARD_BOUNCE,
      source: MarketingSuppressionSource.SYSTEM,
      created_at: new Date('2026-09-28T10:00:00.000Z'),
      updated_at: new Date('2026-09-28T10:00:00.000Z'),
    } as never);

    assert.equal(summary.masked_email, 'pr***@school.test');
    assert.equal(summary.email_domain, 'school.test');
    assert.ok(!JSON.stringify(summary).includes('principal@'));
  });
});

describe('MarketingSuppressionsService — suppressing', () => {
  it('creates the row and suppresses queued recipients only', async () => {
    const { service, recipients } = harness({
      recipients: [
        { id: 'r1', normalized_email: EMAIL, status: MarketingRecipientStatus.PENDING },
        { id: 'r2', normalized_email: EMAIL, status: MarketingRecipientStatus.RETRYING },
        { id: 'r3', normalized_email: EMAIL, status: MarketingRecipientStatus.SENT },
        { id: 'r4', normalized_email: 'other@school.test', status: MarketingRecipientStatus.PENDING },
      ],
    });

    const applied = await service.suppress(
      EMAIL,
      MarketingSuppressionReason.HARD_BOUNCE,
      MarketingSuppressionSource.SYSTEM,
    );

    assert.equal(applied.created, true);
    assert.equal(applied.suppressedRecipients, 2);
    assert.equal(recipients[0].status, MarketingRecipientStatus.SUPPRESSED);
    assert.equal(recipients[1].status, MarketingRecipientStatus.SUPPRESSED);
    assert.equal(
      recipients[2].status,
      MarketingRecipientStatus.SENT,
      'history and its counters are never rewritten',
    );
    assert.equal(recipients[3].status, MarketingRecipientStatus.PENDING, 'other addresses untouched');
  });

  it('is idempotent and upgrades a weaker reason', async () => {
    const { service, rows } = harness();

    await service.suppress(
      EMAIL,
      MarketingSuppressionReason.MANUAL,
      MarketingSuppressionSource.SUPER_ADMIN,
    );
    const second = await service.suppress(
      EMAIL,
      MarketingSuppressionReason.HARD_BOUNCE,
      MarketingSuppressionSource.SYSTEM,
    );

    assert.equal(second.created, false);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, MarketingSuppressionReason.HARD_BOUNCE);
  });

  it('never downgrades an explicit unsubscribe', async () => {
    const { service, rows } = harness({
      suppressions: [
        {
          normalized_email: EMAIL,
          reason: MarketingSuppressionReason.UNSUBSCRIBED,
          source: MarketingSuppressionSource.RECIPIENT_LINK,
        },
      ],
    });

    await service.suppress(
      EMAIL,
      MarketingSuppressionReason.HARD_BOUNCE,
      MarketingSuppressionSource.SYSTEM,
    );

    assert.equal(
      rows[0].reason,
      MarketingSuppressionReason.UNSUBSCRIBED,
      'a person s instruction outranks a provider s observation',
    );
    assert.equal(rows[0].source, MarketingSuppressionSource.RECIPIENT_LINK);
  });

  it('records the manual console action as a SUPER_ADMIN suppression', async () => {
    const { service, rows } = harness();

    const result = await service.addManual({
      email: '  Principal@School.TEST ',
      reason: MarketingSuppressionReason.COMPLAINED,
    });

    assert.equal(rows[0].normalized_email, EMAIL);
    assert.equal(rows[0].source, MarketingSuppressionSource.SUPER_ADMIN);
    assert.equal(result.suppression?.masked_email, 'pr***@school.test');
    assert.ok(!JSON.stringify(result).includes('principal@'));
  });
});

describe('MarketingSuppressionsService — listing', () => {
  it('matches a full address exactly and a bare domain by anchored suffix', async () => {
    const { service } = harness({
      suppressions: [
        { normalized_email: 'a@school.test' },
        { normalized_email: 'b@notschool.test.example' },
        { normalized_email: 'c@other.test' },
      ],
    });

    const exact = await service.list({ search: 'A@School.test' });
    assert.equal(exact.items.length, 1);

    const byDomain = await service.list({ search: 'school.test' });
    assert.equal(byDomain.items.length, 1, 'notschool.test.example is not a match');
    assert.equal(byDomain.items[0].email_domain, 'school.test');

    const none = await service.list({ search: 'chool' });
    assert.equal(none.items.length, 0, 'substring search is not an enumeration oracle');
  });

  it('paginates and returns only masked addresses', async () => {
    const { service } = harness({
      suppressions: Array.from({ length: 25 }, (_, i) => ({
        normalized_email: `person${i}@school.test`,
      })),
    });

    const page = await service.list({ page: 2, limit: 20 });

    assert.equal(page.items.length, 5);
    assert.equal(page.meta.total, 25);
    assert.equal(page.meta.totalPages, 2);
    assert.equal(page.meta.hasPreviousPage, true);
    assert.ok(page.items.every((item) => item.masked_email.includes('***')));
  });
});

describe('MarketingSuppressionsService — removal', () => {
  it('refuses without an explicit confirmation', async () => {
    const { service, rows } = harness({ suppressions: [{ id: 'sup-x' }] });

    await assert.rejects(service.remove('sup-x', { confirm: false }), {
      message: MARKETING_SUPPRESSION_CONFIRM_REQUIRED,
    });
    assert.equal(rows.length, 1);
  });

  it('refuses to remove an unsubscribe without the opt-out acknowledgement', async () => {
    const { service, rows } = harness({
      suppressions: [{ id: 'sup-u', reason: MarketingSuppressionReason.UNSUBSCRIBED }],
    });

    await assert.rejects(service.remove('sup-u', { confirm: true }), {
      message: MARKETING_SUPPRESSION_UNSUBSCRIBE_PROTECTED,
    });
    assert.equal(rows.length, 1, 'the opt-out survives a confirmed-but-unacknowledged removal');

    const removed = await service.remove('sup-u', {
      confirm: true,
      acknowledgeUnsubscribed: true,
    });
    assert.equal(removed.suppression?.reason, MarketingSuppressionReason.UNSUBSCRIBED);
    assert.equal(rows.length, 0);
  });

  it('removes a bounce suppression with a confirmation alone', async () => {
    const { service, rows } = harness({
      suppressions: [{ id: 'sup-b', reason: MarketingSuppressionReason.HARD_BOUNCE }],
    });

    const result = await service.remove('sup-b', { confirm: true });

    assert.equal(rows.length, 0);
    assert.equal(result.suppressed_recipients, 0);
  });

  it('404s on an unknown id', async () => {
    const { service } = harness();
    await assert.rejects(service.remove('missing', { confirm: true }), {
      message: MARKETING_SUPPRESSION_NOT_FOUND,
    });
    await assert.rejects(service.findOneOrThrow('missing'), {
      message: MARKETING_SUPPRESSION_NOT_FOUND,
    });
  });
});
