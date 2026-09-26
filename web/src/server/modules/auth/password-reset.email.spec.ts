import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PASSWORD_RESET_EMAIL_SUBJECT,
  buildPasswordResetEmail,
  buildPasswordResetUrl,
} from './password-reset.email';
import {
  PASSWORD_RESET_DEFAULT_TTL_MS,
  PASSWORD_RESET_TTL_BOUNDS_MS,
} from './password-reset-tokens';

/**
 * The reset email's copy and link.
 *
 * Two things are worth a test here rather than a proofread:
 *
 * - **the stated expiry is derived, not typed** — "expires in N minutes" must
 *   track whatever TTL the server actually enforces, or the email lies to the
 *   one person who cannot check;
 * - **the token appears exactly once, in the link** — anywhere else (a
 *   subject, a footer, a "reference" line) is another copy of a live
 *   credential in an inbox.
 */

const TOKEN = 'a'.repeat(64);
const RESET_URL = `https://buses.school.edu/reset-password?token=${TOKEN}`;

function build(overrides: Partial<Parameters<typeof buildPasswordResetEmail>[0]> = {}) {
  return buildPasswordResetEmail({
    resetUrl: RESET_URL,
    ttlMs: PASSWORD_RESET_DEFAULT_TTL_MS,
    firstName: 'Ada',
    appName: 'KidBus',
    ...overrides,
  });
}

describe('password reset email copy', () => {
  it('uses one fixed subject that promises nothing about the account', () => {
    assert.equal(build().subject, PASSWORD_RESET_EMAIL_SUBJECT);
    assert.equal(PASSWORD_RESET_EMAIL_SUBJECT, 'Reset your password');
  });

  it('states the real expiry, derived from the TTL', () => {
    assert.match(build().text, /expires in 45 minutes/);
    assert.match(build().html, /45 minutes/);

    // Change the TTL and the sentence follows — in both parts.
    const short = build({ ttlMs: PASSWORD_RESET_TTL_BOUNDS_MS.min });
    assert.match(short.text, /expires in 30 minutes/);
    assert.match(short.html, /30 minutes/);

    const long = build({ ttlMs: PASSWORD_RESET_TTL_BOUNDS_MS.max });
    assert.match(long.text, /expires in 60 minutes/);
  });

  it('says the link is single use', () => {
    assert.match(build().text, /only be used once/);
    assert.match(build().html, /only be used once/);
  });

  it('tells an unexpecting recipient that ignoring it is enough', () => {
    for (const part of [build().text, build().html]) {
      assert.match(part, /did not request this/);
      assert.match(part, /password has not changed/);
    }
  });

  it('greets by first name, and stays grammatical without one', () => {
    assert.match(build().text, /^Hi Ada,/);
    for (const firstName of [null, undefined, '', '   ']) {
      assert.match(build({ firstName }).text, /^Hi,/, `expected a bare greeting for ${JSON.stringify(firstName)}`);
    }
    assert.match(build({ firstName: '  Ada  ' }).text, /^Hi Ada,/);
  });

  it('names the product from the caller, never a hardcoded string', () => {
    const renamed = build({ appName: 'SchoolRide' });
    assert.match(renamed.text, /your SchoolRide administrator account/);
    assert.match(renamed.text, /— SchoolRide/);
    assert.equal(renamed.text.includes('KidBus'), false);
  });

  it('carries the link exactly once in each part', () => {
    const { text, html } = build();
    const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

    assert.equal(occurrences(text, TOKEN), 1, 'the raw token appears once, in the link');
    // The HTML prints the URL twice on purpose (button + copyable text) and
    // that is the only duplication allowed.
    assert.equal(occurrences(html, TOKEN), 2);
    assert.match(html, /<a href="https:\/\/buses\.school\.edu\/reset-password\?token=/);
    assert.match(html, /word-break:break-all/);
  });

  it('keeps the token out of the subject', () => {
    assert.equal(build().subject.includes(TOKEN), false);
  });

  it('sends HTML with no images, web fonts or tracking pixel', () => {
    const { html } = build();
    assert.equal(/<img/i.test(html), false);
    assert.equal(/@import|fonts\.googleapis/i.test(html), false);
    assert.equal(/<script/i.test(html), false);
  });

  it('escapes interpolated values in the HTML part', () => {
    const nasty = build({
      firstName: 'Ada <script>alert(1)</script>',
      appName: 'Kid&Bus',
    });
    assert.equal(nasty.html.includes('<script>'), false);
    assert.match(nasty.html, /&lt;script&gt;/);
    assert.match(nasty.html, /Kid&amp;Bus/);
    // The plain-text part is not HTML and must stay literal.
    assert.match(nasty.text, /Kid&Bus/);
  });
});

describe('buildPasswordResetUrl', () => {
  it('builds an absolute link to the reset page', () => {
    assert.equal(
      buildPasswordResetUrl('https://buses.school.edu', TOKEN),
      `https://buses.school.edu/reset-password?token=${TOKEN}`,
    );
  });

  it('normalises the base so a trailing slash cannot double up', () => {
    for (const base of [
      'https://buses.school.edu/',
      'https://buses.school.edu//',
      '  https://buses.school.edu  ',
    ]) {
      assert.equal(
        buildPasswordResetUrl(base, TOKEN),
        `https://buses.school.edu/reset-password?token=${TOKEN}`,
      );
    }
  });

  it('URL-encodes the token', () => {
    assert.equal(
      buildPasswordResetUrl('https://app.test', 'a+b/c=d'),
      'https://app.test/reset-password?token=a%2Bb%2Fc%3Dd',
    );
  });

  it('produces a link whose token survives a round trip through the query string', () => {
    const url = new URL(buildPasswordResetUrl('https://app.test', TOKEN));
    assert.equal(url.pathname, '/reset-password');
    assert.equal(url.searchParams.get('token'), TOKEN);
  });
});
