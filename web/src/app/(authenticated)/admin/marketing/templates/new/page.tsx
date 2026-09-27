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
import { getApiErrorMessage } from '../../../../../../lib/errors';
import { apiClient } from '../../../../../../services/api';

/**
 * Create an email template (its first draft version).
 *
 * The allowed-variable contract is derived from the content rather than
 * typed twice: every `{{placeholder}}` found in the subject or the bodies is
 * declared automatically. The server re-validates the same contract, and the
 * delivery worker refuses at send time to fill anything outside the closed
 * set it can derive from a recipient snapshot — so a typo surfaces here or at
 * publish time, never as a broken email in a school's inbox.
 */
const DELIVERABLE_VARIABLES = [
  { name: 'recipient_name', description: 'Contact name from the audience snapshot' },
  { name: 'school_name', description: 'School name frozen when the campaign was scheduled' },
  { name: 'campaign_url', description: 'Tracked link back to the platform' },
  { name: 'unsubscribe_url', description: 'Per-recipient opt-out link (always added to the footer)' },
  { name: 'current_year', description: 'Current year, for the copyright line' },
];

const STARTER_HTML = `<p>Hello {{recipient_name}},</p>
<p>A short update for {{school_name}}.</p>
<p><a href="{{campaign_url}}">Open Zero Mile Systems</a></p>
<p>&copy; {{current_year}} Zero Mile Systems</p>`;

const STARTER_TEXT = `Hello {{recipient_name}},

A short update for {{school_name}}.

Open Zero Mile Systems: {{campaign_url}}

(c) {{current_year}} Zero Mile Systems`;

export default function AdminMarketingTemplateCreatePage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState(STARTER_HTML);
  const [text, setText] = useState(STARTER_TEXT);
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

  const deliverable = new Set(DELIVERABLE_VARIABLES.map((variable) => variable.name));
  const unsupported = placeholders.filter((placeholder) => !deliverable.has(placeholder));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.createMarketingTemplate({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        content: {
          subject: subject.trim(),
          html_body: html,
          text_body: text,
          allowed_variables: placeholders.map((placeholder) => ({
            name: placeholder,
            required: false,
            description:
              DELIVERABLE_VARIABLES.find((variable) => variable.name === placeholder)
                ?.description ?? null,
          })),
        },
      });
      const created = response.data?.template;
      toast.push('Template created as a draft.', 'success');
      router.push(created ? `/admin/marketing/templates/${created.id}` : '/admin/marketing/templates');
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
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Autumn product update"
              maxLength={150}
              required
            />
          </Field>
          <Field
            id="template-slug"
            label="Slug"
            hint="Stable identifier used in the API and in logs. Lowercase letters, numbers and dashes."
          >
            <Input
              id="template-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="autumn-product-update"
              maxLength={80}
              required
            />
          </Field>
        </Card>

        <Card
          title="Content"
          description="Both parts are required: the HTML body is what most readers see, and the plain-text part is what the rest (and every spam filter) reads."
        >
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
          <Field id="template-html" label="HTML body">
            <Textarea
              id="template-html"
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              rows={12}
              required
            />
          </Field>
          <Field id="template-text" label="Plain-text body">
            <Textarea
              id="template-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              required
            />
          </Field>
        </Card>

        <Card
          title="Allowed variables"
          description="Detected from the content. A campaign can only fill the variables below; anything else is rejected before a single message goes out."
        >
          <ul className="muted" style={{ fontSize: '0.85rem', paddingLeft: '1.1rem' }}>
            {DELIVERABLE_VARIABLES.map((variable) => (
              <li key={variable.name}>
                <code>{`{{${variable.name}}}`}</code> — {variable.description}
                {placeholders.includes(variable.name) ? ' · in use' : ''}
              </li>
            ))}
          </ul>
          {unsupported.length > 0 ? (
            <p className="field-error" role="alert">
              These placeholders cannot be filled at send time and will be rejected:{' '}
              {unsupported.map((placeholder) => `{{${placeholder}}}`).join(', ')}
            </p>
          ) : null}
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
          <Button type="submit" disabled={saving || unsupported.length > 0}>
            {saving ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </form>
    </div>
  );
}
