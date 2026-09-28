import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import {
  MarketingLeadEventType,
  MarketingLeadStatus,
  MarketingNotificationJobStatus,
} from '@school-bus-tracking/shared-types';
import {
  MarketingErasureService,
  MARKETING_ERASED_NAME,
  erasedLeadEmail,
} from './marketing-erasure.service';
import {
  MARKETING_LEAD_ERASED_MESSAGE,
  MARKETING_LEAD_ERASE_CONFIRM_REQUIRED,
  MARKETING_LEAD_NOT_FOUND,
} from './marketing.constants';

/**
 * Right-to-erasure for a demo lead.
 *
 * The behaviour worth testing is the tension the feature lives in: the
 * personal data must really be gone, while the *evidence* that consent was
 * given and that the erasure happened must survive. A test that only checked
 * "the row disappeared" would be asserting a compliance bug.
 */

const LEAD_ID = 'lead-0000-0000-4000-8000-000000000001';

function harness(options: { erasedAt?: Date | null } = {}) {
  const now = () => new Date('2026-09-28T12:00:00.000Z');
  const lead: Record<string, unknown> & { update(values: Record<string, unknown>): Promise<void> } =
    {
      id: LEAD_ID,
      full_name: 'Asha Verma',
      normalized_email: 'asha@greenfield.example',
      institution_name: 'Greenfield Public School',
      phone: '+91 90000 00000',
      city: 'Pune',
      country: 'IN',
      message: 'SECRET-FREE-TEXT please call me',
      preferred_contact_time: 'mornings',
      utm: { utm_source: 'newsletter' },
      submission_fingerprint: 'fingerprint-1',
      status: MarketingLeadStatus.CONTACTED,
      consent_at: new Date('2026-09-20T10:00:00.000Z'),
      consent_source: 'public-form',
      created_at: new Date('2026-09-20T10:00:00.000Z'),
      erased_at: options.erasedAt ?? null,
      async update(values: Record<string, unknown>) {
        Object.assign(lead, values);
      },
    };

  const events: Array<Record<string, unknown>> = [
    { id: 'e1', lead_id: LEAD_ID, event_type: MarketingLeadEventType.CREATED, metadata: { a: 1 } },
    {
      id: 'e2',
      lead_id: LEAD_ID,
      event_type: MarketingLeadEventType.NOTE_ADDED,
      metadata: { note: 'called, wants a quote for 14 buses' },
    },
    { id: 'e3', lead_id: 'other-lead', event_type: MarketingLeadEventType.CREATED, metadata: { a: 1 } },
  ];

  const jobs: Array<Record<string, unknown>> = [
    { id: 'j1', lead_id: LEAD_ID, status: MarketingNotificationJobStatus.PENDING },
    { id: 'j2', lead_id: LEAD_ID, status: MarketingNotificationJobStatus.SENT },
    { id: 'j3', lead_id: 'other-lead', status: MarketingNotificationJobStatus.PENDING },
  ];

  const service = new MarketingErasureService({
    leads: {
      async findOne(opts: { where: Record<string, unknown> }) {
        return opts.where.id === LEAD_ID ? lead : null;
      },
    } as never,
    events: {
      async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
        let affected = 0;
        for (const row of events) {
          if (row.lead_id === opts.where.lead_id && row.metadata !== null) {
            Object.assign(row, values);
            affected += 1;
          }
        }
        return [affected];
      },
      async create(values: Record<string, unknown>) {
        events.push({ id: `e${events.length + 1}`, ...values });
        return values;
      },
    } as never,
    notificationJobs: {
      async update(values: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
        const statuses = (opts.where.status as Record<symbol, string[]>)[Op.in];
        let affected = 0;
        for (const row of jobs) {
          if (row.lead_id === opts.where.lead_id && statuses.includes(row.status as string)) {
            Object.assign(row, values);
            affected += 1;
          }
        }
        return [affected];
      },
    } as never,
    now,
  });

  return { service, lead, events, jobs };
}

describe('MarketingErasureService', () => {
  it('requires an explicit confirmation, server-side', async () => {
    const { service, lead } = harness();

    await assert.rejects(service.eraseLead(LEAD_ID, false), {
      message: MARKETING_LEAD_ERASE_CONFIRM_REQUIRED,
    });
    assert.equal(lead.full_name, 'Asha Verma', 'nothing is erased without confirmation');
  });

  it('404s on an unknown lead', async () => {
    const { service } = harness();
    await assert.rejects(service.eraseLead('missing', true), { message: MARKETING_LEAD_NOT_FOUND });
  });

  it('anonymizes every identifying field while keeping the consent record', async () => {
    const { service, lead } = harness();

    const result = await service.eraseLead(LEAD_ID, true);

    assert.equal(result.erased, true);
    assert.equal(result.message, MARKETING_LEAD_ERASED_MESSAGE);
    assert.equal(lead.full_name, MARKETING_ERASED_NAME);
    assert.equal(lead.normalized_email, erasedLeadEmail(LEAD_ID));
    assert.ok(!String(lead.normalized_email).includes('greenfield'));
    for (const field of [
      'institution_name',
      'phone',
      'city',
      'country',
      'message',
      'preferred_contact_time',
      'utm',
      'submission_fingerprint',
    ]) {
      assert.equal(lead[field], null, `${field} is cleared`);
    }
    assert.ok(lead.erased_at instanceof Date);

    // The evidence survives.
    assert.equal(lead.status, MarketingLeadStatus.CONTACTED, 'pipeline history is preserved');
    assert.ok(lead.consent_at instanceof Date, 'the consent record is preserved');
    assert.equal(lead.consent_source, 'public-form');
  });

  it('strips timeline metadata for this lead only, and logs a content-free erasure event', async () => {
    const { service, events } = harness();

    const result = await service.eraseLead(LEAD_ID, true);

    assert.equal(result.events_anonymized, 2);
    assert.equal(events[0].metadata, null);
    assert.equal(events[1].metadata, null);
    assert.deepEqual(events[2].metadata, { a: 1 }, 'another lead s timeline is untouched');

    const erasureEvent = events.at(-1) as Record<string, unknown>;
    assert.deepEqual(erasureEvent.metadata, { action: 'erased' });
    assert.equal(erasureEvent.actor, 'super-admin');
    assert.ok(
      !JSON.stringify(events).includes('SECRET-FREE-TEXT'),
      'nothing that was erased is quoted back anywhere',
    );
  });

  it('closes outstanding notification jobs so nobody is mailed an erased lead', async () => {
    const { service, jobs } = harness();

    await service.eraseLead(LEAD_ID, true);

    assert.equal(jobs[0].status, MarketingNotificationJobStatus.EXPIRED);
    assert.equal(jobs[1].status, MarketingNotificationJobStatus.SENT, 'history is not rewritten');
    assert.equal(jobs[2].status, MarketingNotificationJobStatus.PENDING, 'other leads keep theirs');
  });

  it('is idempotent — a double click neither throws nor double-counts', async () => {
    const { service } = harness();

    const first = await service.eraseLead(LEAD_ID, true);
    const second = await service.eraseLead(LEAD_ID, true);

    assert.equal(first.events_anonymized, 2);
    assert.equal(second.erased, true);
    assert.equal(second.events_anonymized, 0);
  });

  it('short-circuits a lead erased in an earlier pass', async () => {
    const { service, events } = harness({ erasedAt: new Date('2026-09-27T10:00:00.000Z') });

    const result = await service.eraseLead(LEAD_ID, true);

    assert.equal(result.erased, true);
    assert.equal(result.events_anonymized, 0);
    assert.equal(events.length, 3, 'no duplicate erasure event');
  });
});
