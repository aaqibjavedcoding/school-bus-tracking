'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { extractMarketingTemplatePlaceholders } from '@school-bus-tracking/validation';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Textarea,
  useToast,
} from '../../../../../../components/ui';
import {
  LiveMarketingTemplatePreview,
  MarketingTemplateAuthoringWarnings,
  MarketingTemplateStarterLayouts,
} from '../../../../../../features/marketing/TemplateAuthoring';
import {
  generateMarketingTemplateSlug,
  MARKETING_STARTER_LAYOUTS,
  MARKETING_TEMPLATE_VARIABLES,
  validateMarketingTemplateSlug,
} from '../../../../../../features/marketing/helpers';
import { getApiErrorMessage } from '../../../../../../lib/errors';
import { apiClient } from '../../../../../../services/api';

/**
 * Create an email template (its first draft version).
 *
 * The allowed-variable contract is derived from the content rather than
 * typed twice: every `{{placeholder}}` found in the subject or the bodies is
 * declared automatically. The server re-validates the same contract, and the
 * delivery worker refuses at send time to fill anything outside the closed
 * set it can derive from a recipient snapshot.
 */
export default function AdminMarketingTemplateCreatePage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState(MARKETING_STARTER_LAYOUTS[0].html);
  const [text, setText] = useState(MARKETING_STARTER_LAYOUTS[0].text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const deliverable = new Set<string>(
    MARKETING_TEMPLATE_VARIABLES.map((variable) => variable.name),
  );
  const unsupported = placeholders.filter((placeholder) => !deliverable.has(placeholder));
  const slugError = validateMarketingTemplateSlug(slug);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) {
      setSlug(generateMarketingTemplateSlug(value));
    }
  };

  const handleSlugChange = (value: string) => {
    // Keep manual edits friendly while validation still explains any bad edge
    // case (for example a trailing dash or a one-character slug).
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+/g, '')
      .slice(0, 80);
    setSlugEdited(true);
    setSlug(normalized);
  };

  const selectStarterLayout = (layout: (typeof MARKETING_STARTER_LAYOUTS)[number]) => {
    setSubject(layout.subject);
    setHtml(layout.html);
    setText(layout.text);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (unsupported.length > 0 || slugError) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.createMarketingTemplate({
        name: name.trim(),
        slug: slug.trim(),
        content: {
          subject: subject.trim(),
          html_body: html,
          text_body: text,
          allowed_variables: placeholders.map((placeholder) => ({
            name: placeholder,
            required: false,
            description:
              MARKETING_TEMPLATE_VARIABLES.find((variable) => variable.name === placeholder)
                ?.description ?? null,
          })),
        },
      });
      const created = response.data?.template;
      toast.push('Template created as a draft.', 'success');
      router.push(
        created ? `/admin/marketing/templates/${created.id}` : '/admin/marketing/templates',
      );
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to create the template. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Create email template"
        description="Write the first draft. Nothing is sent until a version is published and a campaign uses it."
        actions={
          <Link href="/admin/marketing/templates">
            <Button variant="secondary">Back to templates</Button>
          </Link>
        }
      />

      <form onSubmit={submit}>
        <Card title="Identity">
          <Field id="template-name" label="Template name">
            <Input
              id="template-name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="e.g. Autumn product update"
              maxLength={150}
              required
            />
          </Field>
          <Field
            id="template-slug"
            label="Slug"
            hint={
              slugError
                ? undefined
                : 'Auto-generated from the name until edited. Lowercase letters, numbers and dashes.'
            }
            error={slugError ?? undefined}
          >
            <Input
              id="template-slug"
              value={slug}
              onChange={(event) => handleSlugChange(event.target.value)}
              placeholder="autumn-product-update"
              maxLength={80}
              required
              error={Boolean(slugError)}
            />
          </Field>
        </Card>

        <Card
          title="Content"
          description="Both parts are required: the HTML body is what most readers see, and the plain-text part is what the rest (and every spam filter) reads."
        >
          <MarketingTemplateStarterLayouts onSelect={selectStarterLayout} />
          <Field id="template-subject" label="Subject line">
            <Input
              id="template-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="News for {{school_name}}"
              maxLength={200}
              required
            />
          </Field>
          <div className="marketing-editor-grid">
            <Field id="template-html" label="HTML body">
              <Textarea
                id="template-html"
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                rows={12}
                required
              />
            </Field>
            <LiveMarketingTemplatePreview html={html} subject={subject} />
          </div>
          <Field id="template-text" label="Plain-text body">
            <Textarea
              id="template-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              required
            />
          </Field>
          <MarketingTemplateAuthoringWarnings
            subject={subject}
            html={html}
            text={text}
            unsupported={unsupported}
          />
        </Card>

        <Card
          title="Allowed variables"
          description="Detected from the content. A campaign can only fill the variables below; anything else is rejected before a single message goes out."
        >
          <ul className="muted" style={{ fontSize: '0.85rem', paddingLeft: '1.1rem' }}>
            {MARKETING_TEMPLATE_VARIABLES.map((variable) => (
              <li key={variable.name}>
                <code>{`{{${variable.name}}}`}</code> — {variable.description}
                {placeholders.includes(variable.name) ? ' · in use' : ''}
              </li>
            ))}
          </ul>
        </Card>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Link href="/admin/marketing/templates">
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={saving || unsupported.length > 0 || Boolean(slugError)}>
            {saving ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </form>
    </div>
  );
}
