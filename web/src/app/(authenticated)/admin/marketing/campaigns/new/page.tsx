'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MarketingRecipientSource,
  MarketingTemplateStatus,
  type MarketingAudiencePreviewResponse,
  type MarketingCampaignAudienceFilter,
  type MarketingTemplateSummary,
  type MarketingTemplateVersionResponse,
} from '@school-bus-tracking/shared-types';
import {
  Button,
  Card,
  CheckboxRow,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../../../../../../components/ui';
import { formatDateTime } from '../../../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../../../lib/errors';
import { apiClient } from '../../../../../../services/api';
import {
  describeAudienceFilter,
  MARKETING_RECIPIENT_SOURCE_LABELS,
  parseFilterList,
} from '../../../../../../features/marketing/helpers';

/**
 * Create a campaign: pick a **published** template version, describe the
 * audience, check the count, save as a draft.
 *
 * Nothing here sends mail. Creating stores a draft; the audience is only
 * frozen when the campaign is scheduled from its detail page, and the
 * messages themselves are produced later by the background delivery worker.
 * The preview exists so that "who exactly is this going to?" is answered
 * before the audience becomes immutable — it returns counts and a masked
 * sample, never the address list.
 */
export default function AdminMarketingCampaignCreatePage() {
  const router = useRouter();
  const toast = useToast();

  const [templates, setTemplates] = useState<MarketingTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [versions, setVersions] = useState<MarketingTemplateVersionResponse[]>([]);
  const [versionId, setVersionId] = useState('');

  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [countries, setCountries] = useState('');
  const [states, setStates] = useState('');
  const [cities, setCities] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [includeAdmins, setIncludeAdmins] = useState(false);

  const [preview, setPreview] = useState<MarketingAudiencePreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = unwrapEnvelope(
          await apiClient.listMarketingTemplates({
            page: 1,
            limit: 100,
            status: MarketingTemplateStatus.PUBLISHED,
          }),
        );
        if (!cancelled) {
          setTemplates(data.items.filter((item) => item.latest_published_version !== null));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(getApiErrorMessage(caught, 'Unable to load templates.'));
        }
      } finally {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!templateId) {
      setVersions([]);
      setVersionId('');
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = unwrapEnvelope(await apiClient.getMarketingTemplate(templateId));
        if (cancelled) {
          return;
        }
        // Only immutable, published versions may back a campaign: a draft
        // could still change under a scheduled send.
        const published = detail.versions.filter((version) => version.published_at !== null);
        setVersions(published);
        setVersionId(published[0]?.id ?? '');
      } catch (caught) {
        if (!cancelled) {
          setError(getApiErrorMessage(caught, 'Unable to load template versions.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const filter: MarketingCampaignAudienceFilter = useMemo(
    () => ({
      search: search.trim() || null,
      countries: parseFilterList(countries).map((value) => value.toUpperCase()),
      states: parseFilterList(states),
      cities: parseFilterList(cities),
      active_only: activeOnly,
      recipient_sources: includeAdmins
        ? [MarketingRecipientSource.SCHOOL_EMAIL, MarketingRecipientSource.SCHOOL_ADMIN]
        : [MarketingRecipientSource.SCHOOL_EMAIL],
    }),
    [search, countries, states, cities, activeOnly, includeAdmins],
  );

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    try {
      const data = unwrapEnvelope(
        await apiClient.previewMarketingAudience({ audience_filter: filter }),
      );
      setPreview(data);
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to preview this audience.'));
    } finally {
      setPreviewing(false);
    }
  }, [filter]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.createMarketingCampaign({
        name: name.trim(),
        template_version_id: versionId,
        audience_filter: filter,
      });
      const created = response.data;
      toast.push('Campaign saved as a draft. Review it, then schedule.', 'success');
      router.push(
        created ? `/admin/marketing/campaigns/${created.id}` : '/admin/marketing/campaigns',
      );
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to create the campaign. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Create campaign"
        description="Saved as a draft. No email is sent until you schedule it, and even then the worker paces delivery."
        actions={
          <Link href="/admin/marketing/campaigns">
            <Button variant="secondary">Back to campaigns</Button>
          </Link>
        }
      />

      <form onSubmit={submit}>
        <Card title="Campaign">
          <Field id="campaign-name" label="Campaign name">
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Autumn update — India"
              maxLength={150}
              required
            />
          </Field>

          {templatesLoading ? (
            <Skeleton lines={3} />
          ) : templates.length === 0 ? (
            <p className="muted">
              No published template is available yet.{' '}
              <Link href="/admin/marketing/templates" className="linkish">
                Publish a template version
              </Link>{' '}
              first — campaigns can only send immutable, approved content.
            </p>
          ) : (
            <>
              <Field id="campaign-template" label="Template">
                <Select
                  id="campaign-template"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                  options={[
                    { value: '', label: 'Select a published template…' },
                    ...templates.map((template) => ({
                      value: template.id,
                      label: `${template.name} (v${template.latest_published_version})`,
                    })),
                  ]}
                  required
                />
              </Field>
              <Field
                id="campaign-version"
                label="Published version"
                hint="A campaign pins one immutable version. Later edits to the template never change what this campaign sends."
              >
                <Select
                  id="campaign-version"
                  value={versionId}
                  onChange={(event) => setVersionId(event.target.value)}
                  disabled={versions.length === 0}
                  options={
                    versions.length === 0
                      ? [{ value: '', label: 'Select a template first…' }]
                      : versions.map((version) => ({
                          value: version.id,
                          label: `v${version.version} — ${version.subject} (published ${formatDateTime(
                            version.published_at,
                          )})`,
                        }))
                  }
                  required
                />
              </Field>
            </>
          )}
        </Card>

        <Card
          title="Audience"
          description="Schools only. Parents, drivers and conductors are never part of a marketing audience. Leave a field empty to skip that dimension."
        >
          <div className="form-grid">
            <Field id="audience-search" label="Name / code / email contains">
              <Input
                id="audience-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="e.g. academy"
              />
            </Field>
            <Field id="audience-countries" label="Countries" hint="ISO codes, comma separated">
              <Input
                id="audience-countries"
                value={countries}
                onChange={(event) => setCountries(event.target.value)}
                placeholder="IN, AE"
              />
            </Field>
            <Field id="audience-states" label="States / regions" hint="Comma separated">
              <Input
                id="audience-states"
                value={states}
                onChange={(event) => setStates(event.target.value)}
                placeholder="Kerala, Karnataka"
              />
            </Field>
            <Field id="audience-cities" label="Cities" hint="Comma separated">
              <Input
                id="audience-cities"
                value={cities}
                onChange={(event) => setCities(event.target.value)}
                placeholder="Kochi, Bengaluru"
              />
            </Field>
          </div>

          <div className="stack" style={{ marginTop: '0.75rem' }}>
            <CheckboxRow
              id="audience-active-only"
              label="Active schools only"
              hint="Deactivated schools are excluded. Turn this off only for a deliberate win-back campaign."
              checked={activeOnly}
              onChange={setActiveOnly}
            />
            <CheckboxRow
              id="audience-admins"
              label={MARKETING_RECIPIENT_SOURCE_LABELS[MarketingRecipientSource.SCHOOL_ADMIN]}
              hint="Also email active SCHOOL_ADMIN accounts, in addition to the school's main contact address."
              checked={includeAdmins}
              onChange={setIncludeAdmins}
            />
          </div>

          <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            {describeAudienceFilter(filter)}
          </p>

          <div className="row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
            <Button variant="secondary" type="button" onClick={() => void runPreview()} disabled={previewing}>
              {previewing ? 'Counting…' : 'Preview audience'}
            </Button>
          </div>

          {preview ? (
            <div className="stat-grid" style={{ marginTop: '1rem' }}>
              <div className="stat success">
                <span className="stat-value">{preview.final_recipient_count}</span>
                <span className="stat-label">Recipients</span>
              </div>
              <div className="stat">
                <span className="stat-value">{preview.total_eligible_schools}</span>
                <span className="stat-label">Eligible schools</span>
              </div>
              <div className="stat warning">
                <span className="stat-value">{preview.suppressed_recipient_count}</span>
                <span className="stat-label">Suppressed</span>
              </div>
              <div className="stat warning">
                <span className="stat-value">{preview.invalid_email_count}</span>
                <span className="stat-label">No usable address</span>
              </div>
              <div className="stat">
                <span className="stat-value">{preview.duplicate_recipient_count}</span>
                <span className="stat-label">Duplicates removed</span>
              </div>
            </div>
          ) : null}

          {preview && preview.sample.length > 0 ? (
            <>
              <p className="muted" style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.82rem' }}>
                Sample (addresses are masked — the console never receives the recipient list):
              </p>
              <ul className="marketing-list">
                {preview.sample.map((entry, index) => (
                  <li key={`${entry.school_id ?? 'school'}-${index}`}>
                    <code>{entry.masked_email}</code>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      {MARKETING_RECIPIENT_SOURCE_LABELS[entry.recipient_source] ??
                        entry.recipient_source}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Link href="/admin/marketing/campaigns">
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={saving || !versionId || name.trim().length === 0}>
            {saving ? 'Saving…' : 'Save draft campaign'}
          </Button>
        </div>
      </form>
    </div>
  );
}
