'use client';

import React, { useState } from 'react';
import {
  MarketingSuppressionReason,
  type MarketingSuppressionSummary,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
} from '../../../../../components/ui';
import { usePagedResource } from '../../../../../hooks/usePagedResource';
import { formatDateTime } from '../../../../../lib/format';
import { unwrapEnvelope } from '../../../../../lib/errors';
import { apiClient } from '../../../../../services/api';
import {
  marketingSuppressionReasonLabel,
  marketingSuppressionReasonTone,
  marketingSuppressionSourceLabel,
} from '../../../../../features/marketing/helpers';

const REASON_FILTER_OPTIONS = [
  { value: '', label: 'All reasons' },
  ...Object.values(MarketingSuppressionReason).map((reason) => ({
    value: reason,
    label: marketingSuppressionReasonLabel(reason),
  })),
];

/**
 * Manual reasons only. `UNSUBSCRIBED` is never offered here: an opt-out is
 * something a person does through the unsubscribe link, not something an
 * operator asserts on their behalf.
 */
const MANUAL_REASON_OPTIONS = [
  {
    value: MarketingSuppressionReason.HARD_BOUNCE,
    label: marketingSuppressionReasonLabel(MarketingSuppressionReason.HARD_BOUNCE),
  },
  {
    value: MarketingSuppressionReason.COMPLAINED,
    label: marketingSuppressionReasonLabel(MarketingSuppressionReason.COMPLAINED),
  },
  {
    value: MarketingSuppressionReason.MANUAL,
    label: marketingSuppressionReasonLabel(MarketingSuppressionReason.MANUAL),
  },
];

/**
 * The marketing do-not-send list.
 *
 * Honest about the setup it serves: the platform sends through plain Gmail
 * SMTP, which gives the application **no webhook for delayed bounces or
 * complaints**. An address that hard-bounces an hour after the send produces
 * a bounce message in the sending mailbox — nothing calls this application.
 * So this page is the working feedback loop: an operator reads the bounce and
 * suppresses the address here, in two fields, with an audit record.
 *
 * Addresses are shown **masked** (`ze***@gmail.com`). The page must be able
 * to answer "is this address suppressed?" without becoming a harvestable
 * recipient list on a screen or in a screenshot.
 */
export default function AdminMarketingSuppressionsPage() {
  const [reason, setReason] = useState<'' | MarketingSuppressionReason>('');
  const [email, setEmail] = useState('');
  const [newReason, setNewReason] = useState<MarketingSuppressionReason>(
    MarketingSuppressionReason.HARD_BOUNCE,
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<MarketingSuppressionSummary | null>(null);
  const [acknowledgeUnsubscribed, setAcknowledgeUnsubscribed] = useState(false);

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<MarketingSuppressionSummary>(
      async (currentPage, currentSearch) => {
        const envelope = await apiClient.listMarketingSuppressions({
          page: currentPage,
          limit: 20,
          search: currentSearch || undefined,
          reason: reason || undefined,
        });
        return unwrapEnvelope(envelope);
      },
      [reason],
    );

  const addSuppression = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const result = unwrapEnvelope(
        await apiClient.createMarketingSuppression({
          email,
          reason: newReason,
          note: note.trim() ? note.trim() : null,
        }),
      );
      // The address itself is deliberately not echoed back into the page.
      setNotice(
        `${result.message} ${result.suppressed_recipients} queued recipient${
          result.suppressed_recipients === 1 ? '' : 's'
        } suppressed.`,
      );
      setEmail('');
      setNote('');
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to add the suppression');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const result = unwrapEnvelope(
        await apiClient.deleteMarketingSuppression(pendingRemoval.id, {
          confirm: true,
          acknowledge_unsubscribed: acknowledgeUnsubscribed || undefined,
        }),
      );
      setNotice(result.message);
      setPendingRemoval(null);
      setAcknowledgeUnsubscribed(false);
      await reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to remove the suppression');
    } finally {
      setSaving(false);
    }
  };

  const removingUnsubscribe =
    pendingRemoval?.reason === MarketingSuppressionReason.UNSUBSCRIBED;

  return (
    <div className="page">
      <PageHeader
        title="Suppressions"
        description="Addresses excluded from every marketing campaign. Addresses are masked; suppression is forward-looking and never rewrites past sends."
      />

      <Card title="Why this list is maintained by hand">
        <p className="muted">
          Marketing email is sent through Gmail SMTP, which reports only immediate rejections. A
          bounce or spam complaint that arrives later lands in the sending mailbox — no webhook
          reaches this application. When you see one, record it here. A signed provider-event
          endpoint already exists for the day a real event source is configured.
        </p>
      </Card>

      <Card
        title="Suppress an address"
        description="Takes effect immediately: every not-yet-sent recipient row for the address is suppressed across all campaigns."
      >
        <form onSubmit={(event) => void addSuppression(event)}>
          <Field id="suppression-email" label="Email address" hint="Stored normalized; shown masked">
            <Input
              id="suppression-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field id="suppression-reason" label="Reason">
            <Select
              id="suppression-reason"
              value={newReason}
              onChange={(event) =>
                setNewReason(event.target.value as MarketingSuppressionReason)
              }
              options={MANUAL_REASON_OPTIONS}
            />
          </Field>
          <Field
            id="suppression-note"
            label="Note (optional)"
            hint="Kept only as the note length in the audit record — never stored verbatim"
          >
            <Input
              id="suppression-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={saving || email.trim().length === 0}>
            {saving ? 'Saving…' : 'Suppress address'}
          </Button>
        </form>
        {formError ? (
          <p className="field-error" role="alert">
            {formError}
          </p>
        ) : null}
        {notice ? (
          <p className="muted" role="status">
            {notice}
          </p>
        ) : null}
      </Card>

      <div className="toolbar" style={{ margin: '1rem 0', flexWrap: 'wrap', gap: '0.5rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Full address or domain…"
        />
        <Select
          aria-label="Filter by suppression reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value as '' | MarketingSuppressionReason);
            setPage(1);
          }}
          options={REASON_FILTER_OPTIONS}
          style={{ maxWidth: 220 }}
        />
      </div>
      <p className="hint muted">
        Search matches a complete address or a bare domain — partial matching is refused server-side
        so this page cannot be used to discover addresses.
      </p>

      {loading && items.length === 0 ? (
        <Skeleton lines={8} />
      ) : error ? (
        <ErrorState
          title="Unable to load suppressions"
          message={error}
          onRetry={() => void reload()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No suppressions"
          description={
            search || reason
              ? 'No suppression matches the current search and filter.'
              : 'Unsubscribes and recorded bounces will appear here.'
          }
        />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: '0.5rem' }}>
            {meta.total} suppressed address{meta.total === 1 ? '' : 'es'}
          </p>
          <Card>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">Domain</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Source</th>
                    <th scope="col">Added</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.masked_email}</td>
                      <td>{item.email_domain}</td>
                      <td>
                        <Badge tone={marketingSuppressionReasonTone(item.reason)}>
                          {marketingSuppressionReasonLabel(item.reason)}
                        </Badge>
                      </td>
                      <td>{marketingSuppressionSourceLabel(item.source)}</td>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setPendingRemoval(item);
                            setAcknowledgeUnsubscribed(false);
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            hasNextPage={meta.hasNextPage}
            hasPreviousPage={meta.hasPreviousPage}
            onPage={(next) => setPage(next)}
          />
        </>
      )}

      <ConfirmDialog
        open={pendingRemoval !== null}
        danger
        busy={saving}
        title="Remove this suppression?"
        message={
          removingUnsubscribe
            ? `${pendingRemoval?.masked_email} asked to be unsubscribed. Removing this row puts the address back into future campaigns. Confirm the opt-out acknowledgement below first.`
            : `${pendingRemoval?.masked_email} will be eligible for future campaigns again. Past sends are unaffected.`
        }
        confirmLabel="Remove suppression"
        onCancel={() => {
          setPendingRemoval(null);
          setAcknowledgeUnsubscribed(false);
        }}
        onConfirm={() => {
          if (removingUnsubscribe && !acknowledgeUnsubscribed) {
            setFormError('Acknowledge the opt-out reversal before removing this suppression.');
            return;
          }
          void confirmRemoval();
        }}
      />
      {pendingRemoval && removingUnsubscribe ? (
        <p className="hint muted">
          <label htmlFor="acknowledge-unsubscribed">
            <input
              id="acknowledge-unsubscribed"
              type="checkbox"
              checked={acknowledgeUnsubscribed}
              onChange={(event) => setAcknowledgeUnsubscribed(event.target.checked)}
            />{' '}
            I am reversing an explicit opt-out and have a lawful basis to do so.
          </label>
        </p>
      ) : null}
    </div>
  );
}
