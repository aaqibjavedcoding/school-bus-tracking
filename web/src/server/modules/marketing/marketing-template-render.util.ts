/**
 * Placeholder rendering for marketing templates.
 *
 * Used by the preview endpoint and the (allowlisted) test-send endpoint — the
 * campaign delivery worker (Session 3) will reuse exactly this substitution so
 * a preview and a real send can never diverge.
 *
 * Rules inherited from the shared contract
 * (`packages/validation` → `marketingTemplateContentSchema`):
 *
 * - only declared placeholders are ever substituted — `{{unknown}}` is left
 *   untouched (and can no longer exist in stored content, because content
 *   validation rejects it at save time);
 * - **HTML bodies get HTML-escaped values**: a sample value like
 *   `<script>` renders as visible text, never as markup. Subject and plain
 *   text substitute verbatim — they are never parsed as HTML.
 */

import { extractMarketingTemplatePlaceholders } from '@school-bus-tracking/validation';

/** The placeholder syntax, mirrored from the validation package. */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Escapes a value for interpolation into an HTML body. */
export function escapeMarketingHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Substitutes placeholders, escaping values when `html` is set. */
function substitute(text: string, variables: Record<string, string>, html: boolean): string {
  return text.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      return match;
    }
    return html ? escapeMarketingHtml(value) : value;
  });
}

/** The rendered projection of one template version. */
export interface RenderedMarketingTemplate {
  subject: string;
  html_body: string;
  text_body: string;
}

/**
 * Renders a template version with the supplied variable values.
 *
 * Missing values leave their placeholder in place — a preview should show the
 * author exactly which placeholders still lack data. (`extractMarketingTemplate-
 * Placeholders` is re-exported for callers that want to check coverage first.)
 */
export function renderMarketingTemplate(
  content: { subject: string; html_body: string; text_body: string },
  variables: Record<string, string>,
): RenderedMarketingTemplate {
  return {
    subject: substitute(content.subject, variables, false),
    html_body: substitute(content.html_body, variables, true),
    text_body: substitute(content.text_body, variables, false),
  };
}

/**
 * Builds a full sample-variable map for a version: caller-supplied values
 * win, declared `example` values fill the rest. Keys the version does not
 * declare are dropped (the DTO layer already rejects them).
 */
export function buildSampleVariables(
  allowedVariables: Array<{ name: string; example?: string | null }>,
  provided: Record<string, string> = {},
): Record<string, string> {
  const samples: Record<string, string> = {};
  for (const variable of allowedVariables) {
    samples[variable.name] = provided[variable.name] ?? variable.example ?? `{{${variable.name}}}`;
  }
  return samples;
}

export { extractMarketingTemplatePlaceholders };
