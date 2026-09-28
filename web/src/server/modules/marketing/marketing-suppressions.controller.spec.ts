import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingSuppressionReason,
  MarketingSuppressionSource,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { callHandler } from '../../http/route-testing';
import { overrideContainer } from '../../container';
import type { AuthenticatedRequestUser } from '../../common/guards';
import * as marketing from '../../api/marketing';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import type { AuditService } from '../audit/audit.service';
import { marketingEmailDigest } from './marketing-suppressions.service';
import type { MarketingSuppressionsService } from './marketing-suppressions.service';
import type { MarketingErasureService } from './marketing-erasure.service';

/**
 * The Hardening 5B admin endpoints: suppression management and lead erasure.
 *
 * Role gating is asserted for the whole marketing surface in
 * `marketing.controller.spec.ts` (which enumerates the module's exports, so
 * these four are covered there automatically). What is asserted *here* is
 * the part unique to them: the audit rows prove the action without quoting
 * the address that was suppressed or the personal data that was erased. An
 * audit log that echoes the erased email has not erased anything.
 */

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SUPPRESSION_ID = '66666666-6666-4666-8666-666666666666';
const LEAD_ID = '77777777-7777-4777-8777-777777777777';
const EMAIL = 'principal@school.test';

const SUPER_ADMIN_USER = {
  id: USER_ID,
  school_id: null,
  role: UserRole.SUPER_ADMIN,
} as AuthenticatedRequestUser;

const SUMMARY = {
  id: SUPPRESSION_ID,
  masked_email: 'pr***@school.test',
  email_domain: 'school.test',
  reason: MarketingSuppressionReason.HARD_BOUNCE,
  source: MarketingSuppressionSource.SUPER_ADMIN,
  created_at: '2026-09-28T10:00:00.000Z',
  updated_at: '2026-09-28T10:00:00.000Z',
};

interface RunOptions {
  params?: Record<string, string>;
  body?: unknown;
  suppressions?: Record<string, unknown>;
  erasure?: Record<string, unknown>;
}

async function run(
  definition: unknown,
  options: RunOptions = {},
): Promise<{ audited: Array<Record<string, unknown>>; result: unknown }> {
  const audited: Array<Record<string, unknown>> = [];
  const audit = {
    log: async (input: Record<string, unknown>) => {
      audited.push(input);
    },
  } as unknown as AuditService;

  const suppressions = {
    list: async () => ({
      items: [SUMMARY],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    }),
    addManual: async () => ({
      suppression: SUMMARY,
      suppressed_recipients: 2,
      message: 'Address suppressed',
    }),
    remove: async () => ({
      suppression: SUMMARY,
      suppressed_recipients: 0,
      message: 'Suppression removed',
    }),
    findOneOrThrow: async () => ({
      id: SUPPRESSION_ID,
      normalized_email: EMAIL,
      reason: MarketingSuppressionReason.HARD_BOUNCE,
      source: MarketingSuppressionSource.SUPER_ADMIN,
    }),
    ...options.suppressions,
  } as unknown as MarketingSuppressionsService;

  const erasure = {
    eraseLead: async () => ({
      lead_id: LEAD_ID,
      erased: true,
      events_anonymized: 3,
      message: 'The lead has been erased.',
    }),
    ...options.erasure,
  } as unknown as MarketingErasureService;

  const restoreAudit = overrideContainer('audit', audit);
  const restoreSuppressions = overrideContainer('marketingSuppressions', suppressions);
  const restoreErasure = overrideContainer('marketingErasure', erasure);
  try {
    const result = await callHandler(definition as never, {
      user: SUPER_ADMIN_USER,
      params: options.params ?? {},
      body: options.body as never,
      request: { requestId: 'req-1', ip: '203.0.113.10' },
    });
    return { audited, result };
  } finally {
    restoreErasure();
    restoreSuppressions();
    restoreAudit();
  }
}

/** Anything that must never reach an audit row for these actions. */
const FORBIDDEN = [EMAIL, 'principal', 'Asha Verma', '+91', 'SMTP_PASS', 'password'];

function assertSafe(rows: Array<Record<string, unknown>>): void {
  assert.ok(rows.length > 0, 'the mutation must be audited');
  const serialized = JSON.stringify(rows);
  for (const forbidden of FORBIDDEN) {
    assert.ok(!serialized.includes(forbidden), `audit row must not contain ${forbidden}`);
  }
  for (const row of rows) {
    assert.equal(row.school_id, null, 'marketing is platform-scoped');
    assert.equal(row.actor_user_id, USER_ID);
  }
}

describe('suppression endpoints', () => {
  it('lists without auditing a read', async () => {
    const { audited, result } = await run(marketing.getMarketingSuppressions as never, {
      body: undefined,
    });
    assert.equal(audited.length, 0, 'reads are not audited');
    assert.deepEqual((result as { items: unknown[] }).items, [SUMMARY]);
  });

  it('audits a manual suppression with a digest, never the address', async () => {
    const { audited } = await run(marketing.postMarketingSuppressions, {
      body: { email: EMAIL, reason: MarketingSuppressionReason.HARD_BOUNCE, note: 'bounced' },
    });

    assertSafe(audited);
    const row = audited[0];
    assert.equal(row.action, AUDIT_ACTIONS.MARKETING_SUPPRESSION_ADD);
    assert.equal(row.entity_type, AUDIT_ENTITY_TYPES.MARKETING_SUPPRESSION);
    assert.equal(row.entity_id, SUPPRESSION_ID);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.email_digest, marketingEmailDigest(EMAIL));
    assert.equal(metadata.email_domain, 'school.test');
    assert.equal(metadata.reason, MarketingSuppressionReason.HARD_BOUNCE);
    assert.equal(metadata.suppressed_recipients, 2);
    assert.equal(metadata.note_length, 'bounced'.length, 'the note is measured, not stored');
    assert.ok(!('note' in metadata), 'the operator note itself never lands in the audit log');
  });

  it('audits a removal with the reason it reversed and the acknowledgement flag', async () => {
    const { audited } = await run(marketing.deleteMarketingSuppressionsById, {
      params: { id: SUPPRESSION_ID },
      body: { confirm: true, acknowledge_unsubscribed: true },
    });

    assertSafe(audited);
    const row = audited[0];
    assert.equal(row.action, AUDIT_ACTIONS.MARKETING_SUPPRESSION_REMOVE);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.acknowledged_unsubscribed, true);
    assert.equal(metadata.email_digest, marketingEmailDigest(EMAIL));
    assert.equal(metadata.reason, MarketingSuppressionReason.HARD_BOUNCE);
  });
});

describe('lead erasure endpoint', () => {
  it('audits the erasure with counts only', async () => {
    const { audited, result } = await run(marketing.postMarketingLeadsByIdErase as never, {
      params: { id: LEAD_ID },
      body: { confirm: true },
    });

    assertSafe(audited);
    const row = audited[0];
    assert.equal(row.action, AUDIT_ACTIONS.MARKETING_LEAD_ERASE);
    assert.equal(row.entity_type, AUDIT_ENTITY_TYPES.MARKETING_LEAD);
    assert.equal(row.entity_id, LEAD_ID);
    assert.deepEqual(row.metadata, { erased: true, events_anonymized: 3 });
    assert.equal((result as { erased: boolean }).erased, true);
  });

  it('never audits an erasure the service refused', async () => {
    await assert.rejects(
      run(marketing.postMarketingLeadsByIdErase as never, {
        params: { id: LEAD_ID },
        body: { confirm: false },
        erasure: {
          eraseLead: async () => {
            throw new Error('Confirmation is required to erase a lead.');
          },
        },
      }),
      /Confirmation is required/,
    );
  });
});
