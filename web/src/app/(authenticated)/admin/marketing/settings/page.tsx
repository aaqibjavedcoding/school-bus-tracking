'use client';

import React, { useEffect, useState } from 'react';
import type {
  MarketingDeliverySettingsResponse,
  MarketingDeliverySettingsUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Skeleton } from '../../../../../components/ui';
import { unwrapEnvelope } from '../../../../../lib/errors';
import { formatDateTime } from '../../../../../lib/format';
import { apiClient } from '../../../../../services/api';

function formFrom(value: MarketingDeliverySettingsResponse): MarketingDeliverySettingsUpdateRequest {
  return {
    paused: value.paused,
    daily_send_cap: value.daily_send_cap,
    per_minute_send_cap: value.per_minute_send_cap,
    delivery_timezone: value.delivery_timezone,
    allowed_window_start: value.allowed_window_start,
    allowed_window_end: value.allowed_window_end,
  };
}

export default function MarketingDeliverySettingsPage() {
  const [settings, setSettings] = useState<MarketingDeliverySettingsResponse | null>(null);
  const [form, setForm] = useState<MarketingDeliverySettingsUpdateRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const value = unwrapEnvelope(await apiClient.getMarketingDeliverySettings());
      setSettings(value);
      setForm(formFrom(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load delivery settings');
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async (next: MarketingDeliverySettingsUpdateRequest) => {
    setSaving(true);
    setError(null);
    try {
      const value = unwrapEnvelope(await apiClient.updateMarketingDeliverySettings(next));
      setSettings(value);
      setForm(formFrom(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save delivery settings');
    } finally {
      setSaving(false);
    }
  };

  if (!settings || !form) {
    return <div className="page"><PageHeader title="Marketing delivery settings" />{error ? <ErrorState title="Unable to load settings" message={error} onRetry={() => void load()} /> : <Skeleton lines={8} />}</div>;
  }

  return (
    <div className="page">
      <PageHeader title="Marketing delivery settings" description="Global, durable controls for the PostgreSQL email queue. SMTP credentials are never exposed here." />
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="card-grid">
        <Card title="Delivery status">
          <p><Badge tone={settings.worker_enabled ? 'success' : 'warning'}>{settings.worker_enabled ? 'Worker enabled' : 'Worker disabled by environment'}</Badge></p>
          <p><strong>{settings.current_daily_sent_count}</strong> sent today ({settings.delivery_timezone})</p>
          <p className="muted">{settings.queued_count} queued · {settings.retrying_count} retrying · {settings.failed_count} failed</p>
          <p className="muted">Last run: {settings.last_worker_run_at ? formatDateTime(settings.last_worker_run_at) : 'Not yet run'}<br />Next expected: {settings.next_expected_worker_run_at ? formatDateTime(settings.next_expected_worker_run_at) : 'After the worker starts'}</p>
          <Button variant={form.paused ? 'success' : 'danger'} disabled={saving} onClick={() => void save({ ...form, paused: !form.paused })}>{form.paused ? 'Resume delivery' : 'Pause delivery'}</Button>
          <p className="hint muted">Pausing stops new claims and preserves every queued recipient. Resuming continues the existing queue.</p>
        </Card>
        <Card title="Safety limits" description="Limits are enforced by the server and database across all worker instances.">
          <form onSubmit={(event) => { event.preventDefault(); void save(form); }}>
            <Field id="daily-cap" label="Daily send cap" hint="1–10,000 attempts per local calendar day">
              <Input id="daily-cap" type="number" min={1} max={10000} value={form.daily_send_cap} onChange={(e) => setForm({ ...form, daily_send_cap: Number(e.target.value) })} />
            </Field>
            <Field id="minute-cap" label="Per-minute send cap" hint="1–300 attempts across all workers">
              <Input id="minute-cap" type="number" min={1} max={300} value={form.per_minute_send_cap} onChange={(e) => setForm({ ...form, per_minute_send_cap: Number(e.target.value) })} />
            </Field>
            <Field id="timezone" label="Delivery timezone" hint="IANA name, for example UTC or Asia/Kolkata">
              <Input id="timezone" value={form.delivery_timezone} onChange={(e) => setForm({ ...form, delivery_timezone: e.target.value })} />
            </Field>
            <div className="form-grid">
              <Field id="window-start" label="Allowed window start (optional)"><Input id="window-start" type="time" value={form.allowed_window_start ?? ''} onChange={(e) => setForm({ ...form, allowed_window_start: e.target.value || null })} /></Field>
              <Field id="window-end" label="Allowed window end (optional)"><Input id="window-end" type="time" value={form.allowed_window_end ?? ''} onChange={(e) => setForm({ ...form, allowed_window_end: e.target.value || null })} /></Field>
            </div>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
