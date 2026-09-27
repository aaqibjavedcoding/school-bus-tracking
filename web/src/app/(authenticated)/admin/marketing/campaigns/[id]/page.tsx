'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MarketingCampaignStatus,
  type MarketingCampaignDetailResponse,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  useToast,
} from '../../../../../../components/ui';
import { formatDateTime } from '../../../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../../../lib/errors';
import { apiClient } from '../../../../../../services/api';
import {
  campaignClickRate,
  campaignCompletionPercent,
  campaignOutstandingCount,
  campaignProgressSegments,
  canCancelCampaign,
  canPauseCampaign,
  canResumeCampaign,
  canScheduleCampaign,
  describeAudienceFilter,
  describeGradualDelivery,
  isCampaignActive,
  isCampaignTerminal,
  marketingCampaignStatusLabel,
  marketingCampaignStatusTone,
  MARKETING_DISPLAY_RATE_PER_MINUTE,
} from '../../../../../../features/marketing/helpers';

/** Live counters are polled while a campaign is actually moving. */
const POLL_INTERVAL_MS = 10_000;

/**
 * One campaign: progress, counters, engagement and lifecycle control.
 *
 * The three lifecycle buttons mean exactly what the worker does with them,
 * and the copy says so:
 *
 * - **Pause** stops new claims. Messages already handed to the provider still
 *   finish — there is no way to recall an accepted email, and pretending
 *   otherwise would be a lie in the UI.
 * - **Resume** lets claiming start again from wherever it stopped.
 * - **Cancel** is terminal: every recipient that has not been sent yet is
 *   abandoned, and the campaign can never send again.
 */
export default function AdminMarketingCampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params?.id ?? '';
  const toast = useToast();

  const [campaign, setCampaign] = useState<MarketingCampaignDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [confirm, setConfirm] = useState<'cancel' | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!campaignId) {
        return;
      }
      if (!silent) {
        setLoading(true);
      }
      try {
        const data = unwrapEnvelope(await apiClient.getMarketingCampaign(campaignId));
        if (mounted.current) {
          setCampaign(data);
          setError(null);
        }
      } catch (caught) {
        if (mounted.current && !silent) {
          setError(getApiErrorMessage(caught, 'Unable to load this campaign.'));
        }
      } finally {
        if (mounted.current && !silent) {
          setLoading(false);
        }
      }
    },
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while the worker can still change something — a completed or
  // cancelled campaign is a static record and does not need traffic.
  const live = campaign ? isCampaignActive(campaign.status) : false;
  useEffect(() => {
    if (!live) {
      return undefined;
    }
    const handle = window.setInterval(() => void load(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [live, load]);

  const segments = useMemo(
    () => (campaign ? campaignProgressSegments(campaign) : []),
    [campaign],
  );

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    try {
      const message = await action();
      toast.push(message, 'success');
      setConfirm(null);
      await load(true);
    } catch (caught) {
      toast.push(getApiErrorMessage(caught, `Unable to ${label}.`), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const schedule = () =>
    run('schedule this campaign', async () => {
      const response = await apiClient.scheduleMarketingCampaign(campaignId, {
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      return response.data?.message ?? 'Campaign scheduled.';
    });

  const pause = () =>
    run('pause this campaign', async () => {
      await apiClient.pauseMarketingCampaign(campaignId);
      return 'Campaign paused. Messages already handed to the mail server still finish.';
    });

  const resume = () =>
    run('resume this campaign', async () => {
      const response = await apiClient.resumeMarketingCampaign(campaignId);
      return response.data?.message ?? 'Campaign resumed.';
    });

  const cancel = () =>
    run('cancel this campaign', async () => {
      const response = await apiClient.cancelMarketingCampaign(campaignId);
      return response.data?.message ?? 'Campaign cancelled.';
    });

  if (loading && !campaign) {
    return (
      <div className="page">
        <Skeleton lines={12} />
      </div>
    );
  }

  if (error && !campaign) {
    return (
      <div className="page">
        <ErrorState
          title="Unable to load this campaign"
          message={error}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (!campaign) {
    return null;
  }

  const outstanding = campaignOutstandingCount(campaign);
  const clickRate = campaignClickRate(campaign);

  return (
    <div className="page">
      <PageHeader
        title={campaign.name}
        description={
          campaign.template
            ? `${campaign.template.name} · v${campaign.template.version ?? '—'}`
            : 'Template no longer available'
        }
        actions={
          <>
            <Badge tone={marketingCampaignStatusTone(campaign.status)}>
              {marketingCampaignStatusLabel(campaign.status)}
            </Badge>
            <Link href="/admin/marketing/campaigns">
              <Button variant="secondary">Back to campaigns</Button>
            </Link>
          </>
        }
      />

      <Card
        title="Delivery progress"
        description={
          campaign.status === MarketingCampaignStatus.DRAFT
            ? 'This campaign has not been scheduled, so no recipients exist yet.'
            : `${campaignCompletionPercent(campaign)}% of ${campaign.recipient_count} recipients processed · ${outstanding} still outstanding.`
        }
      >
        <div
          className="marketing-progress"
          role="img"
          aria-label={`${campaignCompletionPercent(campaign)}% processed of ${
            campaign.recipient_count
          } recipients`}
        >
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={`marketing-progress__segment marketing-progress__segment--${segment.tone}`}
              style={{ width: `${segment.percent}%` }}
              title={`${segment.label}: ${segment.count}`}
            />
          ))}
        </div>
        <ul className="marketing-legend">
          {segments.map((segment) => (
            <li key={segment.key}>
              <span className={`dot marketing-progress__segment--${segment.tone}`} />
              {segment.label}: <strong>{segment.count}</strong> ({segment.percent}%)
            </li>
          ))}
        </ul>
        {segments.length === 0 ? <p className="muted">No recipient activity yet.</p> : null}

        {campaign.recipient_count > 0 && !isCampaignTerminal(campaign.status) ? (
          <p className="muted" style={{ marginTop: '0.85rem', fontSize: '0.85rem' }}>
            {describeGradualDelivery(campaign.recipient_count, MARKETING_DISPLAY_RATE_PER_MINUTE)}
          </p>
        ) : null}
      </Card>

      <Card title="Counters">
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-value">{campaign.recipient_count}</span>
            <span className="stat-label">Recipients</span>
          </div>
          <div className="stat success">
            <span className="stat-value">{campaign.sent_count}</span>
            <span className="stat-label">Sent</span>
          </div>
          <div className="stat warning">
            <span className="stat-value">{campaign.retrying_count}</span>
            <span className="stat-label">Retrying</span>
          </div>
          <div className="stat danger">
            <span className="stat-value">{campaign.failed_count}</span>
            <span className="stat-label">Failed</span>
          </div>
          <div className="stat">
            <span className="stat-value">{campaign.suppressed_count}</span>
            <span className="stat-label">Suppressed</span>
          </div>
          <div className="stat">
            <span className="stat-value">{campaign.skipped_count}</span>
            <span className="stat-label">Skipped</span>
          </div>
          <div className="stat">
            <span className="stat-value">{campaign.clicked_count}</span>
            <span className="stat-label">Clicked</span>
            <span className="stat-hint muted">
              {campaign.total_click_count} total click
              {campaign.total_click_count === 1 ? '' : 's'}
              {clickRate === null ? '' : ` · ${clickRate}% of sent`}
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{campaign.unsubscribed_count}</span>
            <span className="stat-label">Unsubscribed</span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Unsubscribes add the address to the platform suppression list. Transactional mail —
          password resets, alerts — is never affected.
        </p>
      </Card>

      <Card title="Audience">
        <p>{describeAudienceFilter(campaign.audience_filter)}</p>
        <dl className="fact-list">
          <div className="fact">
            <dt>Snapshot</dt>
            <dd>
              {campaign.audience_snapshot_hash
                ? `${campaign.audience_snapshot_hash.slice(0, 12)}…`
                : 'Not frozen yet'}
            </dd>
          </div>
          <div className="fact">
            <dt>Scheduled</dt>
            <dd>{campaign.scheduled_at ? formatDateTime(campaign.scheduled_at) : '—'}</dd>
          </div>
          <div className="fact">
            <dt>Started</dt>
            <dd>{campaign.started_at ? formatDateTime(campaign.started_at) : '—'}</dd>
          </div>
          <div className="fact">
            <dt>Completed</dt>
            <dd>{campaign.completed_at ? formatDateTime(campaign.completed_at) : '—'}</dd>
          </div>
        </dl>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          The recipient list is frozen at scheduling time from a server-side query. Later changes
          to a school never rewrite an in-flight campaign.
        </p>
      </Card>

      {canScheduleCampaign(campaign.status) ? (
        <Card
          title="Schedule"
          description="Freezes the audience into a recipient list and hands it to the background worker. This request never sends mail itself."
        >
          <Field
            id="campaign-scheduled-at"
            label="Start at (optional)"
            hint="Leave empty to start as soon as the worker picks it up."
          >
            <Input
              id="campaign-scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              style={{ maxWidth: 260 }}
            />
          </Field>
          <Button onClick={() => void schedule()} disabled={busy !== null}>
            {busy === 'schedule this campaign' ? 'Scheduling…' : 'Schedule campaign'}
          </Button>
        </Card>
      ) : null}

      {canPauseCampaign(campaign.status) ||
      canResumeCampaign(campaign.status) ||
      canCancelCampaign(campaign.status) ? (
        <Card title="Lifecycle">
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {canPauseCampaign(campaign.status) ? (
              <Button variant="secondary" onClick={() => void pause()} disabled={busy !== null}>
                {busy === 'pause this campaign' ? 'Pausing…' : 'Pause'}
              </Button>
            ) : null}
            {canResumeCampaign(campaign.status) ? (
              <Button onClick={() => void resume()} disabled={busy !== null}>
                {busy === 'resume this campaign' ? 'Resuming…' : 'Resume'}
              </Button>
            ) : null}
            {canCancelCampaign(campaign.status) ? (
              <Button variant="danger" onClick={() => setConfirm('cancel')} disabled={busy !== null}>
                Cancel campaign
              </Button>
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: '0.6rem', fontSize: '0.82rem' }}>
            Pausing stops new sends; messages already accepted by the mail server cannot be
            recalled. Cancelling is permanent — remaining recipients are abandoned.
          </p>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel this campaign?"
        message={`${outstanding} recipient(s) have not been sent yet and will be abandoned. Already-delivered emails cannot be recalled, and the campaign cannot be restarted.`}
        confirmLabel="Cancel campaign"
        danger
        busy={busy === 'cancel this campaign'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void cancel()}
      />
    </div>
  );
}
