'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractMarketingTemplatePlaceholders } from '@school-bus-tracking/validation';
import {
  MarketingTemplateStatus,
  type MarketingTemplateDetailResponse,
  type MarketingTemplatePreviewResponse,
  type MarketingTemplateVersionResponse,
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
  Textarea,
  useToast,
} from '../../../../../../components/ui';
import { formatDateTime } from '../../../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../../../lib/errors';
import { apiClient } from '../../../../../../services/api';
import {
  canArchiveTemplate,
  canPublishTemplateVersion,
  canTestSendVersion,
  isTemplateVersionEditable,
  marketingTemplateStatusLabel,
  marketingTemplateStatusTone,
  MARKETING_TEST_SEND_NOTE,
} from '../../../../../../features/marketing/helpers';

/**
 * One template: draft editing, version history, preview, publish, test send
 * and archive.
 *
 * Two rules shape this screen:
 *
 * 1. **A published version is read-only.** Editing opens the draft; if every
 *    version is published, saving content creates the next draft server-side.
 *    Campaigns pin a version id, so mutating one would silently rewrite what
 *    an already-scheduled campaign is about to send.
 * 2. **The test send takes no address.** There is no recipient field on this
 *    page at all — the server resolves `MARKETING_TEST_RECIPIENTS`. A console
 *    that accepted a typed address would be an open relay with a login.
 */
export default function AdminMarketingTemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const templateId = params?.id ?? '';
  const toast = useToast();

  const [detail, setDetail] = useState<MarketingTemplateDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<MarketingTemplatePreviewResponse | null>(null);
  const [previewTab, setPreviewTab] = useState<'html' | 'text'>('html');
  const [confirmArchive, setConfirmArchive] = useState(false);

  // The current selection is read through a ref so that `load` stays stable
  // across renders: a callback that depended on the selected version would
  // re-fire the fetch effect on every keystroke in the editor.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedVersionId;

  const load = useCallback(
    async (keepSelection = false) => {
      if (!templateId) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = unwrapEnvelope(await apiClient.getMarketingTemplate(templateId));
        setDetail(data);
        const next =
          (keepSelection
            ? data.versions.find((version) => version.id === selectedRef.current)
            : undefined) ??
          data.versions.find((version) => version.published_at === null) ??
          data.versions[0] ??
          null;
        setSelectedVersionId(next?.id ?? null);
        setSubject(next?.subject ?? '');
        setHtml(next?.html_body ?? '');
        setText(next?.text_body ?? '');
      } catch (caught) {
        setError(getApiErrorMessage(caught, 'Unable to load this template.'));
      } finally {
        setLoading(false);
      }
    },
    [templateId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected: MarketingTemplateVersionResponse | null = useMemo(
    () => detail?.versions.find((version) => version.id === selectedVersionId) ?? null,
    [detail, selectedVersionId],
  );

  const templateStatus = detail?.template.status ?? MarketingTemplateStatus.DRAFT;
  const editable = isTemplateVersionEditable(selected, templateStatus);

  const placeholders = useMemo(
    () =>
      [
        ...new Set([
          ...extractMarketingTemplatePlaceholders(subject),
          ...extractMarketingTemplatePlaceholders(html),
          ...extractMarketingTemplatePlaceholders(text),
        ]),
      ].sort(),
    [subject, html, text],
  );

  const selectVersion = (version: MarketingTemplateVersionResponse) => {
    setSelectedVersionId(version.id);
    setSubject(version.subject);
    setHtml(version.html_body);
    setText(version.text_body);
    setPreview(null);
  };

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    try {
      const message = await action();
      toast.push(message, 'success');
      await load(true);
    } catch (caught) {
      toast.push(getApiErrorMessage(caught, `Unable to ${label}. Please try again.`), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () =>
    run('save the draft', async () => {
      await apiClient.saveMarketingTemplateContent(templateId, {
        subject: subject.trim(),
        html_body: html,
        text_body: text,
        allowed_variables: placeholders.map((name) => ({ name, required: false })),
      });
      return 'Draft saved.';
    });

  const publish = () =>
    run('publish this version', async () => {
      if (!selected) {
        throw new Error('No version selected.');
      }
      const response = await apiClient.publishMarketingTemplateVersion(templateId, selected.id);
      return response.data?.message ?? 'Version published.';
    });

  const archive = () =>
    run('archive this template', async () => {
      const response = await apiClient.archiveMarketingTemplate(templateId);
      setConfirmArchive(false);
      return response.data?.message ?? 'Template archived.';
    });

  const renderPreview = async () => {
    setBusy('preview');
    try {
      const response = await apiClient.previewMarketingTemplate(templateId, {
        version_id: selected?.id ?? null,
      });
      setPreview(response.data ?? null);
    } catch (caught) {
      toast.push(getApiErrorMessage(caught, 'Unable to render the preview.'), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const testSend = () =>
    run('send the test email', async () => {
      if (!selected) {
        throw new Error('No version selected.');
      }
      // No address is sent: the server resolves MARKETING_TEST_RECIPIENTS.
      const response = await apiClient.testSendMarketingTemplateVersion(templateId, selected.id, {});
      return response.data?.message ?? 'Test email sent to the configured test recipients.';
    });

  if (loading && !detail) {
    return (
      <div className="page">
        <Skeleton lines={12} />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="page">
        <ErrorState
          title="Unable to load this template"
          message={error}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  return (
    <div className="page">
      <PageHeader
        title={detail.template.name}
        description={`${detail.template.slug} · ${detail.versions.length} version${
          detail.versions.length === 1 ? '' : 's'
        }`}
        actions={
          <>
            <Badge tone={marketingTemplateStatusTone(detail.template.status)}>
              {marketingTemplateStatusLabel(detail.template.status)}
            </Badge>
            <Link href="/admin/marketing/templates">
              <Button variant="secondary">Back to templates</Button>
            </Link>
          </>
        }
      />

      <Card
        title="Version history"
        description="Published versions are immutable — a campaign pins one, so what was approved is exactly what is sent."
      >
        <ul className="marketing-list">
          {detail.versions.map((version) => (
            <li key={version.id}>
              <button
                type="button"
                className="linkish"
                onClick={() => selectVersion(version)}
                aria-current={version.id === selectedVersionId}
              >
                <strong>v{version.version}</strong> — {version.subject}
              </button>
              <span className="row" style={{ gap: '0.5rem' }}>
                <Badge tone={version.published_at ? 'success' : 'warning'}>
                  {version.published_at ? 'Published' : 'Draft'}
                </Badge>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {formatDateTime(version.published_at ?? version.updated_at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title={selected ? `Version ${selected.version}` : 'Content'}
        description={
          editable
            ? 'This draft can still be edited. Saving keeps it a draft; publishing freezes it.'
            : 'This version is published and read-only. Save content to start the next draft.'
        }
      >
        <Field id="version-subject" label="Subject line">
          <Input
            id="version-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={!editable}
            maxLength={200}
          />
        </Field>
        <Field id="version-html" label="HTML body">
          <Textarea
            id="version-html"
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            rows={12}
            disabled={!editable}
          />
        </Field>
        <Field id="version-text" label="Plain-text body">
          <Textarea
            id="version-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            disabled={!editable}
          />
        </Field>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Variables in use: {placeholders.length > 0 ? placeholders.join(', ') : 'none'}
        </p>

        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button onClick={() => void saveDraft()} disabled={busy !== null || !editable}>
            {busy === 'save the draft' ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void renderPreview()}
            disabled={busy !== null || !selected}
          >
            {busy === 'preview' ? 'Rendering…' : 'Preview'}
          </Button>
          {canPublishTemplateVersion(selected, templateStatus) ? (
            <Button variant="secondary" onClick={() => void publish()} disabled={busy !== null}>
              {busy === 'publish this version' ? 'Publishing…' : 'Publish version'}
            </Button>
          ) : null}
          {canTestSendVersion(selected) ? (
            <Button variant="secondary" onClick={() => void testSend()} disabled={busy !== null}>
              {busy === 'send the test email' ? 'Sending…' : 'Send test email'}
            </Button>
          ) : null}
          {canArchiveTemplate(detail.template.status) ? (
            <Button
              variant="danger"
              onClick={() => setConfirmArchive(true)}
              disabled={busy !== null}
            >
              Archive template
            </Button>
          ) : null}
        </div>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
          {MARKETING_TEST_SEND_NOTE}
        </p>
      </Card>

      {preview ? (
        <Card
          title={`Preview of v${preview.version}`}
          description={`Subject: ${preview.subject}`}
        >
          <div className="row" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Button
              variant={previewTab === 'html' ? 'primary' : 'secondary'}
              onClick={() => setPreviewTab('html')}
            >
              HTML
            </Button>
            <Button
              variant={previewTab === 'text' ? 'primary' : 'secondary'}
              onClick={() => setPreviewTab('text')}
            >
              Plain text
            </Button>
          </div>
          {previewTab === 'html' ? (
            // Rendered inside a sandboxed frame rather than injected into
            // the document: the body is server-sanitized, but a preview must
            // never be able to run script in the console's own origin.
            <iframe
              title="HTML preview"
              sandbox=""
              srcDoc={preview.html_body}
              style={{ width: '100%', minHeight: 320, border: '1px solid var(--border, #e2e8f0)' }}
            />
          ) : (
            <pre className="marketing-pre">{preview.text_body}</pre>
          )}
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this template?"
        message="Archived templates cannot be edited or used by new campaigns. Campaigns already scheduled keep the version they pinned."
        confirmLabel="Archive"
        danger
        busy={busy === 'archive this template'}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      />
    </div>
  );
}
