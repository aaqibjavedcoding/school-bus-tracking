import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingLeadEventType,
  MarketingLeadSource,
  MarketingLeadStatus,
  type MarketingDemoLeadInput,
} from '@school-bus-tracking/shared-types';
import { MarketingLeadsService, submissionFingerprint } from './marketing-leads.service';
import type { MarketingResolvedAttribution } from './marketing-tracking.service';
import { MARKETING_DEMO_REQUEST_RECEIVED_MESSAGE } from './marketing.constants';

/**
 * The lead pipeline behind the public "Request a Demo" form and the Super
 * Admin console. The tests drive the invariants the feature is built on:
 *
 * - the lead row is stored BEFORE any notification is attempted, and a
 *   notifier explosion never loses the lead or fails the request;
 * - honeypot hits and deduplicated replays return the same generic answer
 *   as a stored lead (no enumeration oracle), storing nothing new;
 * - attribution comes only from the server-resolved cookie — client JSON
 *   can never name a campaign or recipient;
 * - status transitions are enforced server-side;
 * - list summaries mask phone/message/preferred contact time.
 */

let idCounter = 0;
const nextId = () => `lead-${(idCounter += 1).toString().padStart(4, '0')}`;

interface StoredLead extends Record<string, unknown> {
  id: string;
  status: MarketingLeadStatus;
  created_at: Date;
  updated_at: Date;
  update(values: Record<string, unknown>): Promise<StoredLead>;
}

function harness(options: {
  attribution?: MarketingResolvedAttribution | null;
  attributionThrows?: boolean;
  notifierThrows?: boolean;
  now?: () => Date;
} = {}) {
  const leadsStore: StoredLead[] = [];
  const eventsStore: Array<Record<string, unknown>> = [];
  const notified: string[] = [];
  const now = options.now ?? (() => new Date('2026-09-28T09:00:00.000Z'));

  const makeLead = (values: Record<string, unknown>): StoredLead => {
    const lead: StoredLead = {
      id: nextId(),
      created_at: now(),
      updated_at: now(),
      ...values,
      async update(next: Record<string, unknown>) {
        Object.assign(lead, next, { updated_at: now() });
        return lead;
      },
    } as StoredLead;
    return lead;
  };

  const leads = {
    async create(values: Record<string, unknown>) {
      const lead = makeLead(values);
      leadsStore.push(lead);
      return lead;
    },
    async findOne(opts: { where: Record<string, unknown> }) {
      const where = opts.where as { id?: string; submission_fingerprint?: string };
      if (where.id) {
        return leadsStore.find((lead) => lead.id === where.id) ?? null;
      }
      if (where.submission_fingerprint) {
        return (
          leadsStore.find(
            (lead) => lead.submission_fingerprint === where.submission_fingerprint,
          ) ?? null
        );
      }
      return null;
    },
    async findAll(opts: { limit?: number; offset?: number } = {}) {
      const offset = opts.offset ?? 0;
      return leadsStore.slice(offset, offset + (opts.limit ?? leadsStore.length));
    },
    async count() {
      return leadsStore.length;
    },
  };
  const events = {
    async create(values: Record<string, unknown>) {
      const event = { id: `evt-${eventsStore.length + 1}`, created_at: now(), ...values };
      eventsStore.push(event);
      return event;
    },
    async findAll() {
      return eventsStore;
    },
  };
  const campaigns = {
    async findOne() {
      return null;
    },
    async findAll() {
      return [];
    },
  };
  const recipients = {
    async findOne() {
      return null;
    },
  };
  const suppressions = {
    async count() {
      return 0;
    },
  };

  const service = new MarketingLeadsService({
    leads: leads as never,
    events: events as never,
    campaigns: campaigns as never,
    recipients: recipients as never,
    suppressions: suppressions as never,
    resolveAttribution: async () => {
      if (options.attributionThrows) {
        throw new Error('digest lookup exploded');
      }
      return options.attribution ?? null;
    },
    notifier: {
      notifyNewLead(lead) {
        notified.push(lead.id);
        if (options.notifierThrows) {
          throw new Error('notifier exploded synchronously');
        }
      },
    },
    now,
  });

  return { service, leadsStore, eventsStore, notified };
}

function validInput(overrides: Partial<MarketingDemoLeadInput> = {}): MarketingDemoLeadInput {
  return {
    full_name: 'Asha Verma',
    email: 'Asha@Greenfield.example',
    institution_name: 'Greenfield Public School',
    consent: true,
    ...overrides,
  };
}

describe('MarketingLeadsService — public capture', () => {
  it('stores the lead, normalizes the email and answers generically', async () => {
    const { service, leadsStore, eventsStore } = harness();

    const response = await service.captureDemoRequest(validInput());

    assert.equal(response.received, true);
    assert.equal(response.message, MARKETING_DEMO_REQUEST_RECEIVED_MESSAGE);
    assert.equal(leadsStore.length, 1);
    const lead = leadsStore[0];
    assert.equal(lead.normalized_email, 'asha@greenfield.example');
    assert.equal(lead.status, MarketingLeadStatus.NEW);
    assert.equal(lead.source, MarketingLeadSource.LANDING_PAGE);
    assert.equal(lead.consent_source, 'public-form');
    assert.ok(lead.consent_at instanceof Date, 'consent timestamp is server-set');
    assert.equal(eventsStore[0].event_type, MarketingLeadEventType.CREATED);
    assert.equal(eventsStore[0].actor, 'public-form');
  });

  it('stores the lead BEFORE notifying, and a throwing notifier never loses it', async () => {
    const { service, leadsStore, notified } = harness({ notifierThrows: true });

    const response = await service.captureDemoRequest(validInput());

    assert.equal(response.received, true, 'the public request still succeeds');
    assert.equal(leadsStore.length, 1, 'the lead is committed');
    assert.equal(notified[0], leadsStore[0].id, 'notification was scheduled for the stored row');
  });

  it('honeypot: same generic answer, nothing stored, nobody notified', async () => {
    const { service, leadsStore, notified } = harness();

    const response = await service.captureDemoRequest(
      validInput({ website: 'https://spam.example' }),
    );

    assert.equal(response.received, true, 'indistinguishable from success');
    assert.equal(response.message, MARKETING_DEMO_REQUEST_RECEIVED_MESSAGE);
    assert.equal(leadsStore.length, 0);
    assert.equal(notified.length, 0);
  });

  it('replays inside the dedupe window: one row, one notification, same answer', async () => {
    const { service, leadsStore, notified } = harness();

    const first = await service.captureDemoRequest(validInput());
    const second = await service.captureDemoRequest(validInput());

    assert.deepEqual(first, second, 'no oracle for "this address already asked"');
    assert.equal(leadsStore.length, 1);
    assert.equal(notified.length, 1);
  });

  it('rejects missing consent and stores nothing', async () => {
    const { service, leadsStore } = harness();

    await assert.rejects(
      service.captureDemoRequest(validInput({ consent: false })),
    );
    assert.equal(leadsStore.length, 0);
  });

  it('attribution comes from the resolved cookie only — client JSON ids are ignored', async () => {
    const { service, leadsStore } = harness({
      attribution: {
        campaign_id: 'campaign-real',
        campaign_recipient_id: 'recipient-real',
      } as MarketingResolvedAttribution,
    });

    // A hostile client trying to forge attribution / routing is rejected
    // outright — the shared schema is strict about unknown keys.
    await assert.rejects(
      service.captureDemoRequest({
        ...validInput(),
        campaign_id: 'campaign-forged',
        school_id: 'school-forged',
        admin_email: 'attacker@evil.example',
      } as never),
    );
    assert.equal(leadsStore.length, 0, 'the forged submission stores nothing');

    // A clean submission attaches only what the server-resolved cookie proves.
    await service.captureDemoRequest(validInput());
    const lead = leadsStore[0];
    assert.equal(lead.campaign_id, 'campaign-real');
    assert.equal(lead.campaign_recipient_id, 'recipient-real');
    assert.equal('school_id' in lead, false, 'no forged school routing is stored');
  });

  it('a broken attribution resolver still stores the lead, unattributed', async () => {
    const { service, leadsStore } = harness({ attributionThrows: true });

    const response = await service.captureDemoRequest(validInput());

    assert.equal(response.received, true);
    assert.equal(leadsStore[0].campaign_id, null);
    assert.equal(leadsStore[0].campaign_recipient_id, null);
  });
});

describe('MarketingLeadsService — admin console', () => {
  it('list summaries mask phone, message and preferred contact time', async () => {
    const { service } = harness();
    await service.captureDemoRequest(
      validInput({ phone: '+91 12345', message: 'call me', preferred_contact_time: 'mornings' }),
    );

    const result = await service.list({});

    assert.equal(result.items.length, 1);
    const summary = result.items[0] as Record<string, unknown>;
    assert.equal('phone' in summary, false);
    assert.equal('message' in summary, false);
    assert.equal('preferred_contact_time' in summary, false);
    assert.equal(summary.email, 'asha@greenfield.example');
    assert.equal(result.meta.total, 1);
    assert.equal(result.meta.totalPages, 1);
  });

  it('detail responses do include the follow-up fields', async () => {
    const { service, leadsStore } = harness();
    await service.captureDemoRequest(
      validInput({ phone: '+91 12345', message: 'call me', preferred_contact_time: 'mornings' }),
    );

    const detail = await service.findOneOrThrow(leadsStore[0].id);

    assert.equal(detail.lead.phone, '+91 12345');
    assert.equal(detail.lead.message, 'call me');
    assert.equal(detail.lead.preferred_contact_time, 'mornings');
    assert.equal(detail.lead.consent_source, 'public-form');
    assert.ok(detail.events.length >= 1);
  });

  it('enforces the transition graph: NEW cannot jump to CONVERTED', async () => {
    const { service, leadsStore } = harness();
    await service.captureDemoRequest(validInput());

    await assert.rejects(
      service.updateStatus(leadsStore[0].id, MarketingLeadStatus.CONVERTED),
    );
    assert.equal(leadsStore[0].status, MarketingLeadStatus.NEW, 'status unchanged');
  });

  it('allows NEW → CONTACTED and records the timeline events', async () => {
    const { service, leadsStore, eventsStore } = harness();
    await service.captureDemoRequest(validInput());

    const updated = await service.updateStatus(
      leadsStore[0].id,
      MarketingLeadStatus.CONTACTED,
      'Rang the school office',
    );

    assert.equal(updated.status, MarketingLeadStatus.CONTACTED);
    const types = eventsStore.map((event) => event.event_type);
    assert.ok(types.includes(MarketingLeadEventType.STATUS_CHANGED));
    assert.ok(types.includes(MarketingLeadEventType.CONTACTED));
  });

  it('DEMO_SCHEDULED is only reachable through the explicit pipeline, never at capture', async () => {
    const { service, leadsStore } = harness();
    await service.captureDemoRequest(validInput());
    const lead = leadsStore[0];

    assert.equal(lead.status, MarketingLeadStatus.NEW, 'a submission is a request, not a booking');
    await assert.rejects(
      service.updateStatus(lead.id, MarketingLeadStatus.DEMO_SCHEDULED),
      'NEW cannot claim a confirmed appointment',
    );

    await service.updateStatus(lead.id, MarketingLeadStatus.CONTACTED);
    const scheduled = await service.updateStatus(lead.id, MarketingLeadStatus.DEMO_SCHEDULED);
    assert.equal(scheduled.status, MarketingLeadStatus.DEMO_SCHEDULED);
  });

  it('addNote validates bounds and appends a NOTE_ADDED event', async () => {
    const { service, leadsStore } = harness();
    await service.captureDemoRequest(validInput());

    await assert.rejects(service.addNote(leadsStore[0].id, '   '));
    await assert.rejects(service.addNote(leadsStore[0].id, 'x'.repeat(2001)));

    const event = await service.addNote(leadsStore[0].id, '  Wants a Tuesday demo  ');
    assert.equal(event.event_type, MarketingLeadEventType.NOTE_ADDED);
    assert.deepEqual(event.metadata, { note: 'Wants a Tuesday demo' });
  });

  it('unknown lead ids raise not-found for reads and mutations alike', async () => {
    const { service } = harness();
    await assert.rejects(service.findOneOrThrow('missing-id'));
    await assert.rejects(service.updateStatus('missing-id', MarketingLeadStatus.CONTACTED));
    await assert.rejects(service.addNote('missing-id', 'note'));
  });

  it('metrics aggregate counts without loading recipient addresses', async () => {
    const { service } = harness();
    await service.captureDemoRequest(validInput());

    const metrics = await service.metrics();

    assert.equal(metrics.total_leads, 1);
    assert.equal(metrics.new_leads_last_7_days, 1);
    assert.equal(metrics.leads_by_status[MarketingLeadStatus.NEW], 1);
    assert.equal(metrics.total_clicks, 0);
    assert.equal(metrics.click_to_lead_rate, null, 'no clicks → no rate, not a division by zero');
    assert.equal(metrics.unsubscribed_total, 0);
    assert.equal(metrics.recent_leads.length, 1);
    const recent = metrics.recent_leads[0] as Record<string, unknown>;
    assert.equal('phone' in recent, false, 'recent leads reuse the masked summary');
  });
});

describe('submissionFingerprint', () => {
  it('is stable for identical content and never contains the raw fields', () => {
    const a = submissionFingerprint('asha@greenfield.example', {
      full_name: 'Asha Verma',
      institution_name: 'Greenfield Public School',
      message: 'hello',
    });
    const b = submissionFingerprint('asha@greenfield.example', {
      full_name: '  ASHA VERMA ',
      institution_name: 'greenfield public school',
      message: 'hello',
    });
    assert.equal(a, b, 'case/whitespace variants of the same submission collide on purpose');
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.equal(a.includes('asha'), false);
  });

  it('differs when the content differs', () => {
    const a = submissionFingerprint('asha@greenfield.example', {
      full_name: 'Asha Verma',
      institution_name: 'Greenfield Public School',
      message: 'hello',
    });
    const b = submissionFingerprint('asha@greenfield.example', {
      full_name: 'Asha Verma',
      institution_name: 'Greenfield Public School',
      message: 'different message',
    });
    assert.notEqual(a, b);
  });
});
