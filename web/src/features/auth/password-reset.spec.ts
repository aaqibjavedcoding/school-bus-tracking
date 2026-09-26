import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_PASSWORD_LENGTH } from '@school-bus-tracking/validation';
import { fieldErrorsFromZod } from '../../lib/errors.ts';
import { pickFieldLabels } from '../../lib/field-errors.ts';
import {
  FORGOT_PASSWORD_FIELDS,
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  LOGIN_RESET_SUCCESS_FLAG,
  PASSWORD_CONFIRMATION_MISMATCH_MESSAGE,
  RESET_PASSWORD_FIELDS,
  RESET_PASSWORD_MISSING_TOKEN_MESSAGE,
  RESET_PASSWORD_SUCCESS_TOAST,
  isPostResetLogin,
  loginPathAfterReset,
  parseForgotPasswordForm,
  parseResetPasswordForm,
  resetTokenFromQuery,
  type FormParseResult,
} from './password-reset.ts';

/**
 * The two new unauthenticated screens, `/forgot-password` and
 * `/reset-password`.
 *
 * The repo has no DOM test runner, so this follows the established web
 * convention (`features/crew/crew-login.ts` + `lib/nav-routes.spec.ts`) and
 * tests the two screens the two ways that are available:
 *
 * 1. **their logic**, extracted into `password-reset.ts` as pure functions —
 *    validation, the token read out of the query string, the redirect;
 * 2. **their source**, read off disk and asserted against, for the handful of
 *    structural promises a pure function cannot hold: the token never becomes
 *    a hidden input, the pages use the shared `PasswordInput`, the login page
 *    actually links to `/forgot-password`.
 *
 * (2) is coarse, but it is what caught the class of regression
 * `nav-routes.spec.ts` exists for: a screen that silently stops doing the
 * thing its neighbours assume it does.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(here, '..', '..', 'app');
const source = (...segments: string[]) =>
  fs.readFileSync(path.join(APP_DIR, ...segments), 'utf8');

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a1b2c3d4'.repeat(8);

const FORGOT_LABELS = pickFieldLabels(FORGOT_PASSWORD_FIELDS);
const RESET_LABELS = pickFieldLabels(RESET_PASSWORD_FIELDS);

/**
 * What the page renders for a rejected form: the parse result put through
 * the same `fieldErrorsFromZod` every other form in the console uses. Going
 * through the real humaniser is the point — it is what proves the messages a
 * user sees name the field in human words.
 */
function fieldErrors<T>(result: FormParseResult<T>, labels: Record<string, string>) {
  assert.equal(result.ok, false, 'expected the form to be rejected');
  return result.ok ? {} : fieldErrorsFromZod(result.error, labels);
}

describe('forgot-password form validation', () => {
  it('accepts a school code and an email', () => {
    const result = parseForgotPasswordForm({ schoolId: 'triumph-academy', email: 'ada@school.edu' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.value, {
      school_id: 'triumph-academy',
      email: 'ada@school.edu',
    });
  });

  it('accepts a school UUID', () => {
    const result = parseForgotPasswordForm({ schoolId: SCHOOL_ID, email: 'ada@school.edu' });
    assert.equal(result.ok, true);
  });

  it('trims what the user pasted', () => {
    const result = parseForgotPasswordForm({
      schoolId: '  triumph-academy  ',
      email: '  ada@school.edu ',
    });
    assert.equal(result.ok && result.value.school_id, 'triumph-academy');
    assert.equal(result.ok && result.value.email, 'ada@school.edu');
  });

  it('requires the school code, unlike the login form', () => {
    const errors = fieldErrors(
      parseForgotPasswordForm({ schoolId: '   ', email: 'ada@school.edu' }),
      FORGOT_LABELS,
    );
    assert.ok(errors.school_id);
  });

  it('reports a malformed email under the email field', () => {
    const errors = fieldErrors(
      parseForgotPasswordForm({ schoolId: 'triumph-academy', email: 'nope' }),
      FORGOT_LABELS,
    );
    assert.deepEqual(Object.keys(errors), ['email']);
  });

  it('names the field in human words, never a DTO property', () => {
    const errors = fieldErrors(parseForgotPasswordForm({ schoolId: '', email: '' }), FORGOT_LABELS);
    assert.ok(Object.keys(errors).length > 0);
    for (const message of Object.values(errors)) {
      assert.equal(/school_id|_id\b/.test(message), false, message);
    }
    assert.match(errors.school_id, /school code/i);
  });
});

describe('reset-password form validation', () => {
  const valid = { token: TOKEN, password: 'new-password-123', confirmPassword: 'new-password-123' };

  it('accepts a matching pair and posts only token + password', () => {
    const result = parseResetPasswordForm(valid);
    assert.equal(result.ok, true);
    // `confirm_password` is a UI concern and never goes on the wire.
    assert.deepEqual(result.ok && Object.keys(result.value).sort(), ['password', 'token']);
  });

  it('rejects a mismatch, and puts the error on the field the user must change', () => {
    const errors = fieldErrors(
      parseResetPasswordForm({ ...valid, confirmPassword: 'something-else-99' }),
      RESET_LABELS,
    );
    assert.deepEqual(Object.keys(errors), ['confirm_password']);
    // The sentence is already guidance, so the humaniser leaves it alone.
    assert.equal(errors.confirm_password, PASSWORD_CONFIRMATION_MISMATCH_MESSAGE);
  });

  it('reports the real problem first when a short password was typed twice', () => {
    // Sending the user to fix a "mismatch" that does not exist is the classic
    // way to make a reset form feel broken.
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const errors = fieldErrors(
      parseResetPasswordForm({ token: TOKEN, password: short, confirmPassword: short }),
      RESET_LABELS,
    );
    assert.ok(errors.password);
    assert.equal(errors.confirm_password, undefined);
  });

  it('enforces the shared password rules in the browser', () => {
    for (const password of ['short', ' leading-space-pw', 'trailing-space-pw ']) {
      const result = parseResetPasswordForm({ token: TOKEN, password, confirmPassword: password });
      assert.equal(result.ok, false, `expected a rejection for ${JSON.stringify(password)}`);
    }
  });

  it('rejects a submit with no token at all', () => {
    const errors = fieldErrors(parseResetPasswordForm({ ...valid, token: null }), RESET_LABELS);
    assert.ok(errors.token);
  });
});

describe('reset token in the query string', () => {
  it('reads the token from URLSearchParams or a raw query string', () => {
    assert.equal(resetTokenFromQuery(new URLSearchParams({ token: TOKEN })), TOKEN);
    assert.equal(resetTokenFromQuery(`?token=${TOKEN}`), TOKEN);
    assert.equal(resetTokenFromQuery(`token=${TOKEN}`), TOKEN);
  });

  it('survives extra parameters and ordering', () => {
    assert.equal(resetTokenFromQuery(`?utm_source=email&token=${TOKEN}&x=1`), TOKEN);
  });

  it('treats an absent, blank or whitespace-only token as missing', () => {
    for (const query of [null, undefined, '', '?', '?token=', '?token=%20%20', '?other=1']) {
      assert.equal(
        resetTokenFromQuery(query),
        null,
        `expected null for ${JSON.stringify(query)} — the page shows the "incomplete link" state`,
      );
    }
  });

  it('decodes a percent-encoded token', () => {
    assert.equal(resetTokenFromQuery('?token=a%2Bb'), 'a+b');
  });

  it('has a message for the incomplete-link state that tells the user what to do', () => {
    assert.match(RESET_PASSWORD_MISSING_TOKEN_MESSAGE, /again|new one/i);
  });
});

describe('post-reset redirect', () => {
  it('sends the user to the login page with a flag, not a message', () => {
    // A login page that rendered arbitrary text from its own URL would be a
    // free phishing surface.
    assert.equal(loginPathAfterReset(), `/login?${LOGIN_RESET_SUCCESS_FLAG}=1`);
    assert.equal(loginPathAfterReset().includes(RESET_PASSWORD_SUCCESS_TOAST), false);
  });

  it('recognises the flag on arrival, and only the flag', () => {
    assert.equal(isPostResetLogin('?reset=1'), true);
    assert.equal(isPostResetLogin(new URLSearchParams({ reset: '1' })), true);
    for (const query of [null, undefined, '', '?reset=0', '?reset=yes', '?other=1']) {
      assert.equal(isPostResetLogin(query), false, `expected false for ${JSON.stringify(query)}`);
    }
  });

  it('tells the user to sign in again, because the reset ended every session', () => {
    assert.match(RESET_PASSWORD_SUCCESS_TOAST, /sign in/i);
  });
});

describe('the generic message is the same on both sides of the wire', () => {
  it('matches the server constant word for word', () => {
    // Read out of the server source rather than imported: the web bundle must
    // not pull server modules in, but the two strings must not drift either.
    const serverConstants = fs.readFileSync(
      path.resolve(here, '..', '..', 'server', 'modules', 'auth', 'auth.constants.ts'),
      'utf8',
    );
    const match = /FORGOT_PASSWORD_GENERIC_MESSAGE\s*=\s*\n?\s*'([^']+)'/.exec(serverConstants);
    assert.ok(match, 'the server constant must be a single-quoted literal');
    assert.equal(match[1], FORGOT_PASSWORD_GENERIC_MESSAGE);
  });

  it('claims nothing about whether the account exists', () => {
    assert.match(FORGOT_PASSWORD_GENERIC_MESSAGE, /^If an account exists/);
  });
});

describe('/forgot-password page', () => {
  const page = source('forgot-password', 'page.tsx');

  it('exists as a client component', () => {
    assert.match(page, /^'use client';/);
    assert.match(page, /export default function ForgotPasswordPage/);
  });

  it('asks for the same two fields as the login form', () => {
    assert.match(page, /id="school_id"/);
    assert.match(page, /id="email"/);
    assert.match(page, /label="School code"/);
    assert.match(page, /label="Email"/);
  });

  it('renders the one generic message from the shared constant', () => {
    assert.match(page, /FORGOT_PASSWORD_GENERIC_MESSAGE/);
    // Never a second, case-specific sentence typed inline.
    assert.equal(/we (sent|could not find)|no account|not registered/i.test(page), false);
  });

  it('does not branch on the response body', () => {
    // The server answers identically for every outcome; a page that read the
    // body would invite a future change that renders something conditional.
    assert.equal(/response\.data|envelope\.data/.test(page), false);
  });

  it('offers a way back to sign in', () => {
    assert.match(page, /href="\/login"/);
  });
});

describe('/reset-password page', () => {
  const page = source('reset-password', 'page.tsx');

  it('exists as a client component', () => {
    assert.match(page, /^'use client';/);
    assert.match(page, /export default function ResetPasswordPage/);
  });

  it('reads the token from the query string through the shared helper', () => {
    assert.match(page, /useSearchParams/);
    assert.match(page, /resetTokenFromQuery/);
  });

  it('never puts the token in the DOM', () => {
    // A hidden input would place a live credential into the page source,
    // autofill heuristics and every extension that walks the form.
    assert.equal(/type="hidden"/.test(page), false);
    assert.equal(/value=\{token\}/.test(page), false);
  });

  it('uses the shared PasswordInput for both secret fields', () => {
    const uses = page.match(/<PasswordInput/g) ?? [];
    assert.equal(uses.length, 2, 'new password + confirmation');
    assert.match(page, /autoComplete="new-password"/);
  });

  it('validates with the shared schema before posting', () => {
    assert.match(page, /parseResetPasswordForm/);
  });

  it('redirects to the login page on success rather than signing the user in', () => {
    // Finishing a reset revokes every session and mints none.
    assert.match(page, /loginPathAfterReset\(\)/);
    assert.match(page, /RESET_PASSWORD_SUCCESS_TOAST/);
  });

  it('wraps the search-params reader in a Suspense boundary', () => {
    assert.match(page, /<Suspense/);
  });
});

describe('/login page entry point', () => {
  const page = source('login', 'page.tsx');

  it('links to the forgot-password screen', () => {
    assert.match(page, /href="\/forgot-password"/);
    assert.match(page, /Forgot password\?/);
  });

  it('shows the success toast after a completed reset', () => {
    assert.match(page, /isPostResetLogin/);
    assert.match(page, /RESET_PASSWORD_SUCCESS_TOAST/);
  });

  it('still offers the way back to the homepage', () => {
    assert.match(page, /href="\/"/);
  });
});
