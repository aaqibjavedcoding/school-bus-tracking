import { passwordResetTtlMinutes } from './password-reset-tokens';

/**
 * The reset email itself — subject, plain text and a deliberately plain HTML
 * part.
 *
 * Kept out of the service so the wording is a pure function of
 * `(link, ttl, name)` and can be asserted directly, and so the one rule that
 * matters is visible in one place: **the raw token appears exactly once, in
 * the link**. Nothing else in this file interpolates it, and the service never
 * puts it into a log line, an audit row or a response body.
 *
 * ### Why the HTML is this simple
 *
 * School admins read this on whatever their school hands them — Outlook 2016,
 * a phone, a webmail with images off. Every client renders a paragraph and an
 * anchor; almost none render a modern layout the same way twice. So the HTML
 * part is a handful of block elements with inline styles and no images, no
 * web fonts and no tracking pixel, and the URL is also printed as text so a
 * client that strips links still leaves the recipient something to copy.
 *
 * ### The three things the body must say
 *
 * 1. that a reset was requested for *this* console (so it is not phishing);
 * 2. how long the link lives — the real, configured number, derived from the
 *    TTL by {@link passwordResetTtlMinutes} rather than typed in, so the
 *    sentence cannot drift from the expiry the server enforces;
 * 3. that ignoring the email is a safe and complete response — which is the
 *    honest instruction for the recipient of an unrequested reset, because
 *    issuing the token changed nothing about their current password.
 */

/** Subject line. Names the product, states the action, promises nothing. */
export const PASSWORD_RESET_EMAIL_SUBJECT = 'Reset your password';

/** Rendered parts of one reset email. */
export interface PasswordResetEmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface PasswordResetEmailInput {
  /** Absolute `{APP_URL}/reset-password?token=…` link. */
  resetUrl: string;
  /** Honoured token lifetime in ms (already clamped by the policy module). */
  ttlMs: number;
  /** Recipient's first name, when known. Used only for the greeting. */
  firstName?: string | null;
  /** Product name, so the copy matches the console the admin signs in to. */
  appName: string;
}

/** Minimal HTML escaping for the few values interpolated into the HTML part. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPasswordResetEmail(input: PasswordResetEmailInput): PasswordResetEmailContent {
  const minutes = passwordResetTtlMinutes(input.ttlMs);
  const name = input.firstName?.trim();
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const text = [
    greeting,
    '',
    `Someone asked to reset the password for your ${input.appName} administrator account.`,
    '',
    'Open this link to choose a new password:',
    input.resetUrl,
    '',
    `The link expires in ${minutes} minutes and can only be used once.`,
    '',
    'If you did not request this, you can ignore this email — your password has not changed and nobody can use this link without it.',
    '',
    `— ${input.appName}`,
  ].join('\n');

  const safeUrl = escapeHtml(input.resetUrl);
  const safeGreeting = escapeHtml(greeting);
  const safeApp = escapeHtml(input.appName);

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;">',
    `<p>${safeGreeting}</p>`,
    `<p>Someone asked to reset the password for your ${safeApp} administrator account.</p>`,
    `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 18px;background:#f5a524;color:#1f2933;text-decoration:none;border-radius:6px;font-weight:bold;">Choose a new password</a></p>`,
    // Printed as text as well: plenty of corporate clients strip or rewrite
    // anchors, and a recipient staring at a dead button has no way forward.
    `<p style="font-size:13px;color:#52606d;">Or copy this link into your browser:<br /><span style="word-break:break-all;">${safeUrl}</span></p>`,
    `<p>The link expires in <strong>${minutes} minutes</strong> and can only be used once.</p>`,
    '<p>If you did not request this, you can ignore this email — your password has not changed and nobody can use this link without it.</p>',
    `<p style="color:#52606d;">— ${safeApp}</p>`,
    '</div>',
  ].join('');

  return { subject: PASSWORD_RESET_EMAIL_SUBJECT, text, html };
}

/**
 * Builds the absolute link the email carries.
 *
 * The token is URL-encoded and the base is normalised (no doubled slash), so
 * a deployment that sets `APP_URL=https://buses.school.edu/` and one that sets
 * it without the trailing slash produce the identical link.
 */
export function buildPasswordResetUrl(appUrl: string, rawToken: string): string {
  const base = appUrl.trim().replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}
