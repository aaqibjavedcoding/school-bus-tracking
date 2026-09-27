/**
 * Per-recipient message construction: the one place a campaign's immutable
 * template version becomes an actual email addressed to one school.
 *
 * Everything here is deliberately pure except the token mint, which is
 * injectable — so `marketing-message.builder.spec.ts` can pin the token and
 * assert what does (and does not) end up in the message, the headers and the
 * database.
 *
 * ### What the recipient's copy is rendered *from*
 *
 * The **snapshot row**, never the live school record. A campaign's identity
 * has to be reproducible: if a school renames itself after the send, "what
 * did they receive" must still answer with the name that was on the message.
 * The snapshot is also the only place the address exists for this campaign,
 * which is what makes a mid-flight suppression check meaningful.
 *
 * ### Tokens
 *
 * Each recipient gets two independent 256-bit opaque tokens (click and
 * unsubscribe), minted here and **never persisted in plaintext**: only their
 * SHA-256 digests go to the database, exactly like `password_reset_tokens`
 * and refresh tokens. Consequences, all intentional:
 *
 * - a database read (or a leaked backup, or a support engineer with SELECT)
 *   cannot forge a click attribution or unsubscribe somebody;
 * - the raw token exists only inside the outgoing message, so it must never
 *   be logged — {@link describeMarketingMessage} is the only summary the
 *   worker is allowed to log, and it carries lengths, not content;
 * - the two tokens are separate, so a click link cannot be replayed as an
 *   unsubscribe (they end up in different places: one in the body, one also
 *   in a header that mailbox providers surface as a one-click button).
 *
 * ### What never goes in a URL
 *
 * The recipient's email address. A link that carries `?email=` leaks the
 * address into browser history, referrer headers, the landing page's
 * analytics and every proxy log on the way — and lets anyone edit the
 * parameter to unsubscribe a third party. The opaque token *is* the
 * identifier; the server resolves it to a row.
 */

import { createHash, randomBytes } from 'node:crypto';
import type {
  MarketingTemplateVariable,
  MarketingUtmParameters,
} from '@school-bus-tracking/shared-types';
import { BadRequestException } from '../../framework';
import {
  escapeMarketingHtml,
  extractMarketingTemplatePlaceholders,
  renderMarketingTemplate,
} from './marketing-template-render.util';
import { MARKETING_RENDER_UNKNOWN_VARIABLE } from './marketing.constants';

/**
 * The closed set of placeholders a *campaign* send may substitute.
 *
 * A template may declare any variables it likes for preview purposes, but a
 * real send can only fill the ones the server can derive from the snapshot
 * and the deployment configuration. Anything else would either have to come
 * from the client (it does not exist at send time) or be guessed — so it is
 * rejected before a single message leaves.
 */
export const MARKETING_RENDER_VARIABLES = [
  'recipient_name',
  'school_name',
  'campaign_url',
  'unsubscribe_url',
  'current_year',
] as const;

export type MarketingRenderVariable = (typeof MARKETING_RENDER_VARIABLES)[number];

/** `true` when `name` is a variable the delivery worker can fill. */
export function isMarketingRenderVariable(name: string): name is MarketingRenderVariable {
  return (MARKETING_RENDER_VARIABLES as readonly string[]).includes(name);
}

/** The immutable content the campaign pinned. */
export interface MarketingRenderableVersion {
  subject: string;
  html_body: string;
  text_body: string;
  allowed_variables?: MarketingTemplateVariable[] | null;
}

/** The snapshot row the message is addressed to. */
export interface MarketingRenderableRecipient {
  id: string;
  normalized_email: string;
  recipient_name: string | null;
  /** Denormalized school display name from the snapshot, when available. */
  school_name?: string | null;
}

/** One minted token: the raw value (transient) and the stored digest. */
export interface MarketingToken {
  /** Only ever inside the outgoing message. Never logged, never persisted. */
  raw: string;
  /** SHA-256 hex digest — the only form that reaches the database. */
  hash: string;
}

/** 256 bits of entropy, hex-encoded: unguessable and URL-safe. */
export function generateMarketingToken(): MarketingToken {
  const raw = randomBytes(32).toString('hex');
  return { raw, hash: hashMarketingToken(raw) };
}

/** The digest function the database column stores and lookups compare against. */
export function hashMarketingToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Absolute public URL of the click redirect for one raw token. */
export function marketingClickUrl(appUrl: string, rawToken: string): string {
  return `${trimTrailingSlash(appUrl)}/api/v1/public/marketing/click/${encodeURIComponent(rawToken)}`;
}

/** Absolute public URL of the unsubscribe endpoint for one raw token. */
export function marketingUnsubscribeUrl(appUrl: string, rawToken: string): string {
  return `${trimTrailingSlash(appUrl)}/api/v1/public/marketing/unsubscribe/${encodeURIComponent(
    rawToken,
  )}`;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Inputs of one per-recipient render. */
export interface BuildMarketingMessageInput {
  recipient: MarketingRenderableRecipient;
  version: MarketingRenderableVersion;
  /** Public origin of this deployment (`APP_URL`). */
  appUrl: string;
  /** `Reply-To` for campaign mail (a monitored operator mailbox). */
  replyTo?: string | null;
  /** Injected for tests; production uses {@link generateMarketingToken}. */
  mintToken?: () => MarketingToken;
  /** Injected for tests; production uses the real clock. */
  now?: Date;
}

/** One ready-to-send message plus the digests the worker must persist. */
export interface BuiltMarketingMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string | null;
  headers: Record<string, string>;
  /** Persist these; the raw tokens intentionally do not leave this object. */
  clickTokenHash: string;
  unsubscribeTokenHash: string;
}

/**
 * Renders one recipient's copy and mints their tokens.
 *
 * Throws {@link BadRequestException} when the pinned content uses a
 * placeholder the worker cannot fill. Failing loudly here (before any
 * message leaves) is the point: the alternative — leaving `{{cta_url}}`
 * in the body, or substituting an empty string — sends thousands of broken
 * emails that cannot be recalled.
 */
export function buildMarketingMessage(input: BuildMarketingMessageInput): BuiltMarketingMessage {
  const mint = input.mintToken ?? generateMarketingToken;
  const now = input.now ?? new Date();

  assertRenderableVariables(input.version);

  const clickToken = mint();
  const unsubscribeToken = mint();
  const campaignUrl = marketingClickUrl(input.appUrl, clickToken.raw);
  const unsubscribeUrl = marketingUnsubscribeUrl(input.appUrl, unsubscribeToken.raw);

  const variables: Record<MarketingRenderVariable, string> = {
    // The greeting falls back to the local part of the address rather than a
    // bare "Hello ,": the snapshot may legitimately have no display name.
    recipient_name: input.recipient.recipient_name?.trim() || 'there',
    school_name: input.recipient.school_name?.trim() || 'your school',
    campaign_url: campaignUrl,
    unsubscribe_url: unsubscribeUrl,
    current_year: String(now.getUTCFullYear()),
  };

  // `renderMarketingTemplate` HTML-escapes values in the HTML body and
  // substitutes verbatim in the subject and text part — a school named
  // `Foo & Bar <Trust>` renders as visible text in both, never as markup.
  const rendered = renderMarketingTemplate(input.version, variables);

  return {
    to: input.recipient.normalized_email,
    subject: rendered.subject,
    html: appendHtmlUnsubscribeFooter(rendered.html_body, unsubscribeUrl),
    text: appendTextUnsubscribeFooter(rendered.text_body, unsubscribeUrl),
    replyTo: input.replyTo?.trim() || null,
    headers: marketingUnsubscribeHeaders(unsubscribeUrl),
    clickTokenHash: clickToken.hash,
    unsubscribeTokenHash: unsubscribeToken.hash,
  };
}

/**
 * The RFC 2369 / RFC 8058 unsubscribe headers.
 *
 * `List-Unsubscribe` gives mailbox providers a machine-readable way out, and
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` promises that the POST
 * needs no confirmation page — which is what turns Gmail's and Outlook's
 * native "Unsubscribe" button on. Offering it is also self-interested: a
 * reader who cannot find the way out presses "report spam" instead, and that
 * damages delivery for every future campaign.
 *
 * Only the URL form is advertised, never `mailto:`: a mailto unsubscribe
 * would require parsing inbound mail, and the address in it would be a
 * fresh way to leak the recipient list.
 */
export function marketingUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Guarantees the message carries a visible way out even if the template
 * author forgot one. A marketing email without an unsubscribe link is not a
 * styling problem, it is a compliance problem.
 */
function appendHtmlUnsubscribeFooter(html: string, unsubscribeUrl: string): string {
  if (html.includes(unsubscribeUrl)) {
    return html;
  }
  const safeUrl = escapeMarketingHtml(unsubscribeUrl);
  return `${html}\n<p style="font-size:12px;color:#6b7280;margin-top:24px">You received this because your school is registered with Zero Mile Systems. <a href="${safeUrl}">Unsubscribe</a>.</p>`;
}

function appendTextUnsubscribeFooter(text: string, unsubscribeUrl: string): string {
  if (text.includes(unsubscribeUrl)) {
    return text;
  }
  return `${text}\n\n---\nYou received this because your school is registered with Zero Mile Systems.\nUnsubscribe: ${unsubscribeUrl}`;
}

/**
 * Rejects content that uses a placeholder the send-time renderer cannot fill.
 *
 * Both halves are checked: the placeholder must be declared by the version
 * (`allowed_variables`, the template author's contract) *and* be one of the
 * server-derivable {@link MARKETING_RENDER_VARIABLES}.
 */
export function assertRenderableVariables(version: MarketingRenderableVersion): void {
  const declared = new Set((version.allowed_variables ?? []).map((variable) => variable.name));
  const used = new Set<string>([
    ...extractMarketingTemplatePlaceholders(version.subject),
    ...extractMarketingTemplatePlaceholders(version.html_body),
    ...extractMarketingTemplatePlaceholders(version.text_body),
  ]);
  const unknown = [...used]
    .filter((name) => !isMarketingRenderVariable(name) || !declared.has(name))
    .sort();
  if (unknown.length > 0) {
    throw new BadRequestException({
      message: MARKETING_RENDER_UNKNOWN_VARIABLE,
      details: { variables: unknown.join(', ') },
    });
  }
}

/**
 * The **only** description of a built message that may be logged.
 *
 * Bodies contain live tokens and the reader's name; subjects are content.
 * Sizes and a boolean are enough to debug "did we build something sane" and
 * cannot leak anything.
 */
export function describeMarketingMessage(message: BuiltMarketingMessage): string {
  return `html=${message.html.length}b text=${message.text.length}b headers=${Object.keys(
    message.headers,
  )
    .sort()
    .join('|')}`;
}

/**
 * Drops C0/C7F control characters.
 *
 * Written as a codepoint filter rather than a regular expression: a literal
 * control range inside a regex is both unreadable and something linters
 * rightly flag, and the value here is about to be interpolated into a
 * redirect URL where a stray CR or LF is a header-injection primitive.
 */
function stripControlCharacters(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x1f && code !== 0x7f) {
      out += character;
    }
  }
  return out;
}

/** Only these query parameters survive a tracked click into the redirect. */
export function pickSafeUtmParameters(
  source: URLSearchParams,
  allowed: readonly string[],
): MarketingUtmParameters {
  const utm: Record<string, string> = {};
  for (const key of allowed) {
    const value = source.get(key);
    if (typeof value === 'string' && value.trim() !== '' && value.length <= 120) {
      // Attribution values are echoed into a redirect URL, so they are
      // length-bounded and stripped of control characters; they are never
      // rendered as HTML anywhere.
      utm[key] = stripControlCharacters(value).slice(0, 120);
    }
  }
  return utm as MarketingUtmParameters;
}
