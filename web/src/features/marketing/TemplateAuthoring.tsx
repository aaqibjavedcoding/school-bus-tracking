'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import {
  MARKETING_PREVIEW_VALUES,
  MARKETING_STARTER_LAYOUTS,
  hasMarketingUnsubscribeLink,
  substituteMarketingTemplateVariables,
  type MarketingTemplateStarterLayout,
} from './helpers';

export interface MarketingTemplateAuthoringWarningsProps {
  subject: string;
  html: string;
  text: string;
  unsupported: string[];
}

/**
 * Client-side guidance for the common authoring mistakes. These are hints,
 * not the validation boundary: the API still sanitizes HTML, validates the
 * closed placeholder contract, and requires both body parts on save.
 */
export function MarketingTemplateAuthoringWarnings({
  subject,
  html,
  text,
  unsupported,
}: MarketingTemplateAuthoringWarningsProps) {
  const subjectLength = subject.trim().length;
  const warnings: string[] = [];

  if (!hasMarketingUnsubscribeLink(html)) {
    warnings.push('Add an unsubscribe link to the HTML body with {{unsubscribe_url}}.');
  }
  if (!text.trim()) {
    warnings.push('The plain-text body is empty. Add a text part before saving.');
  }
  if (subjectLength > 60) {
    warnings.push(
      `This subject is ${subjectLength} characters; consider keeping it to 60 characters or fewer.`,
    );
  }

  if (unsupported.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className="marketing-authoring-warnings" aria-live="polite">
      {unsupported.length > 0 ? (
        <p className="field-error" role="alert">
          Unsupported placeholders will be rejected before send:{' '}
          {unsupported.map((placeholder) => `{{${placeholder}}}`).join(', ')}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p className="marketing-warning" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

export interface MarketingTemplateStarterLayoutsProps {
  disabled?: boolean;
  onSelect: (layout: MarketingTemplateStarterLayout) => void;
}

/** Static, deliberately small starting points — not a WYSIWYG editor. */
export function MarketingTemplateStarterLayouts({
  disabled = false,
  onSelect,
}: MarketingTemplateStarterLayoutsProps) {
  return (
    <div className="marketing-starter-layouts" aria-label="Starter layouts">
      <div>
        <strong>Starter layout</strong>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.2rem 0 0.55rem' }}>
          Choose a plain static starting point. Selecting one replaces both body fields.
        </p>
      </div>
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        {MARKETING_STARTER_LAYOUTS.map((layout) => (
          <Button
            key={layout.id}
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => onSelect(layout)}
            aria-label={`Use ${layout.label} starter layout`}
          >
            {layout.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export interface LiveMarketingTemplatePreviewProps {
  html: string;
  subject?: string;
}

/**
 * Render the unsaved HTML in an isolated, debounced frame. `srcDoc` keeps
 * rendered email markup out of the console DOM, and the empty sandbox
 * intentionally grants the document no script, form, or same-origin privileges.
 */
export function LiveMarketingTemplatePreview({
  html,
  subject = '',
}: LiveMarketingTemplatePreviewProps) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [renderedHtml, setRenderedHtml] = useState(() =>
    substituteMarketingTemplateVariables(html, MARKETING_PREVIEW_VALUES),
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setRenderedHtml(substituteMarketingTemplateVariables(html, MARKETING_PREVIEW_VALUES));
    }, 300);
    return () => clearTimeout(timeout);
  }, [html]);

  return (
    <div className="marketing-live-preview" aria-label="Live email preview">
      <div className="marketing-live-preview__header">
        <div>
          <h3>Live preview</h3>
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>
            Sample values are shown below. Updates appear shortly after you stop typing.
          </p>
        </div>
        <div className="marketing-preview-toggle" role="group" aria-label="Preview width">
          <Button
            type="button"
            variant={viewport === 'desktop' ? 'primary' : 'secondary'}
            aria-pressed={viewport === 'desktop'}
            onClick={() => setViewport('desktop')}
          >
            Desktop
          </Button>
          <Button
            type="button"
            variant={viewport === 'mobile' ? 'primary' : 'secondary'}
            aria-pressed={viewport === 'mobile'}
            onClick={() => setViewport('mobile')}
          >
            Mobile
          </Button>
        </div>
      </div>
      {subject.trim() ? (
        <p className="marketing-live-preview__subject">
          <strong>Subject:</strong>{' '}
          {substituteMarketingTemplateVariables(subject, MARKETING_PREVIEW_VALUES)}
        </p>
      ) : null}
      <div className={`marketing-preview-frame marketing-preview-frame--${viewport}`}>
        <iframe title="Live HTML email preview" sandbox="" srcDoc={renderedHtml} />
      </div>
    </div>
  );
}
