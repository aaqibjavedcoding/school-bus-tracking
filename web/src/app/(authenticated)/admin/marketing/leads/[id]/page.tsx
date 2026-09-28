'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MarketingLeadStatus,
  type MarketingLeadDetailResponse,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from '../../../../../../components/ui';
import { formatDateTime } from '../../../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../../../lib/errors';
import { apiClient } from '../../../../../../services/api';
import {
  describeLeadEvent,
  marketingLeadActionLabel,
  marketingLeadNextStatuses,
  marketingLeadSourceLabel,
  marketingLeadStatusLabel,
  marketingLeadStatusTone,
} from '../../../../../../features/marketing/helpers';

/**
 * One demo lead: contact details, consent record, campaign attribution,
 * status pipeline and the append-only timeline.
 *
 * The transition buttons mirror `MARKETING_LEAD_STATUS_TRANSITIONS` — the
 * server enforces the graph regardless. "Mark demo scheduled" is an explicit
 * operator claim that a real appointment was confirmed; nothing here sets it
 * automatically because no calendar integration exists.
 */
export default function AdminMarketingLeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params?.id ?? '';
  const toast = useToast();

  const [detail, setDetail] = useState<MarketingLeadDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!leadId) {
      return;
    }
    setLoading(true);
    try {
      const data = unwrapEnvelope(await apiClient.getMarketingLead(leadId));
      if (mounted.current) {
        setDetail(data);
        setError(null);
      }
    } catch (caught) {
      if (mounted.current) {
        setError(getApiErrorMessage(caught, 'Unable to load this lead.'));
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = useCallback(
    async (status: MarketingLeadStatus) => {
      if (!leadId) {
        return;
      }
      setBusy(status);
      try {
        unwrapEnvelope(await apiClient.updateMarketingLeadStatus(leadId, { status }));
        toast.push(`Lead marked ${marketingLeadStatusLabel(status).toLowerCase()}.`, 'success');
        await load();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught, 'The status could not be updated.'), 'danger');
      } finally {
        if (mounted.current) {
          setBusy(null);
        }
      }
    },
    [leadId, load, toast],
  );

  const addNote = useCallback(async () => {
    const text = note.trim();
    if (!leadId || text.length === 0) {
      return;
    }
    setBusy('note');
    try {
      unwrapEnvelope(await apiClient.addMarketingLeadNote(leadId, { note: text }));
      setNote('');
      toast.push('Note added.', 'success');
      await load();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught, 'The note could not be added.'), 'danger');
    } finally {
      if (mounted.current) {
        setBusy(null);
      }
    }
  }, [leadId, load, note, toast]);

  if (loading && !detail) {
    return (
      <div className="page">
        <Skeleton lines={10} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="page">
        <ErrorState
          title="Unable to load this lead"
          message={error ?? 'The lead could not be loaded.'}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const { lead, events } = detail;
  const nextStatuses = marketingLeadNextStatuses(lead.status);

  return (
    <div className="page">
      <PageHeader
        title={lead.full_name}
        description={`Demo request from ${lead.institution_name ?? 'an unnamed institution'} · received ${formatDateTime(lead.created_at)}`}
        actions={
          <Link href="/admin/marketing/leads">
            <Button variant="ghost">Back to leads</Button>
          </Link>
        }
      />

      <div className="detail-grid">
        <Card title="Status">
          <p style={{ marginBottom: '0.75rem' }}>
            <Badge tone={marketingLeadStatusTone(lead.status)}>
              {marketingLeadStatusLabel(lead.status)}
            </Badge>
          </p>
          {nextStatuses.length > 0 ? (
            <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {nextStatuses.map((status) => (
                <Button
                  key={status}
                  variant={status === MarketingLeadStatus.LOST ? 'ghost' : 'secondary'}
                  disabled={busy !== null}
                  onClick={() => void changeStatus(status)}
                >
                  {busy === status ? 'Saving…' : marketingLeadActionLabel(status)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="muted">This lead is converted — no further transitions.</p>
          )}
          <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
            “Demo scheduled” means a real appointment was confirmed with the contact. There is no
            calendar integration — only mark it after booking a time.
          </p>
        </Card>

        <Card title="Contact">
          <dl className="fact-list">
            <div className="fact">
              <dt>Work email</dt>
              <dd>{lead.email}</dd>
            </div>
            <div className="fact">
              <dt>Institution</dt>
              <dd>{lead.institution_name ?? '—'}</dd>
            </div>
            <div className="fact">
              <dt>Phone</dt>
              <dd>{lead.phone ?? '—'}</dd>
            </div>
            <div className="fact">
              <dt>Location</dt>
              <dd>{[lead.city, lead.country].filter(Boolean).join(', ') || '—'}</dd>
            </div>
            <div className="fact">
              <dt>Preferred contact time</dt>
              <dd>{lead.preferred_contact_time ?? '—'}</dd>
            </div>
            {lead.message ? (
              <div className="fact">
                <dt>Message</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{lead.message}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card title="Attribution & consent">
          <dl className="fact-list">
            <div className="fact">
              <dt>Source</dt>
              <dd>{marketingLeadSourceLabel(lead.source)}</dd>
            </div>
            <div className="fact">
              <dt>Campaign</dt>
              <dd>
                {lead.campaign_id ? (
                  <Link href={`/admin/marketing/campaigns/${lead.campaign_id}`}>
                    {lead.campaign_name ?? 'Open campaign'}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="fact">
              <dt>Attributed click</dt>
              <dd>{lead.attributed_click_at ? formatDateTime(lead.attributed_click_at) : '—'}</dd>
            </div>
            {lead.utm && Object.values(lead.utm).some(Boolean) ? (
              <div className="fact">
                <dt>UTM</dt>
                <dd>
                  {Object.entries(lead.utm)
                    .filter(([, value]) => Boolean(value))
                    .map(([key, value]) => `${key}=${value}`)
                    .join(' · ')}
                </dd>
              </div>
            ) : null}
            <div className="fact">
              <dt>Consent</dt>
              <dd>
                Given {formatDateTime(lead.consent_at)} via{' '}
                {lead.consent_source === 'public-form' ? 'the public demo form' : 'manual entry'}
              </dd>
            </div>
            <div className="fact">
              <dt>Admin notified</dt>
              <dd>{lead.admin_notified_at ? formatDateTime(lead.admin_notified_at) : 'Pending / see timeline'}</dd>
            </div>
          </dl>
          {lead.campaign_recipient_id ? (
            <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
              Attribution comes from a personalized campaign link. If the email was forwarded, it
              represents the original recipient — the form email above is the reliable identity of
              the person who actually submitted this request.
            </p>
          ) : null}
        </Card>

        <Card title="Internal notes">
          <Field id="lead-note" label="Add a note" hint="Visible to Super Admins only.">
            <Textarea
              id="lead-note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Call summary, follow-up plan…"
            />
          </Field>
          <Button
            disabled={busy !== null || note.trim().length === 0}
            onClick={() => void addNote()}
          >
            {busy === 'note' ? 'Saving…' : 'Add note'}
          </Button>
        </Card>

        <Card title="Timeline">
          {events.length === 0 ? (
            <p className="muted">No events recorded yet.</p>
          ) : (
            <ul className="timeline-list" style={{ margin: 0, paddingLeft: '1rem' }}>
              {events.map((event) => (
                <li key={event.id} style={{ marginBottom: '0.5rem' }}>
                  <span>{describeLeadEvent(event)}</span>
                  <br />
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    {formatDateTime(event.created_at)} · {event.actor}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
