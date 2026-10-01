import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  FORGOT_PASSWORD_FIELDS,
  errorStatus,
  forgotPasswordErrorIsVisible,
  parseForgotPasswordForm,
} from './forgot-password.ts';
import { en } from '../../lib/i18n.en.ts';
import { budgetFor } from '../../lib/i18n-budget.ts';
import { SUPPORTED_LOCALES, dictionary, type TranslationKey } from '../../lib/i18n.ts';

/**
 * Mobile self-service password reset — step 1.
 *
 * Two kinds of guard, because two kinds of thing can go wrong. The unit
 * tests pin the rules (shared schema, one sentence for every outcome); the
 * source scan pins the architecture (no backend change, no api-client
 * change, no second reset screen, the link on the right login path, every
 * word localised).
 *
 * The anti-enumeration rule is the reason this file exists at all: the API
 * answers identically whether or not the account exists, and a screen that
 * rendered anything conditional would give back exactly what the endpoint
 * was built to withhold.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

/** Source with comments removed — a guard about calls must read code. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const SCREEN = 'app/forgot-password.tsx';
const LOGIN = 'app/login.tsx';
const LOGIC = 'src/features/auth/forgot-password.ts';

/** The server's sentence, byte for byte (FORGOT_PASSWORD_GENERIC_MESSAGE). */
const GENERIC_MESSAGE =
  'If an account exists for that school and email, a password reset email has been sent.';

const FORGOT_KEYS: TranslationKey[] = [
  'forgotPassword.link',
  'forgotPassword.adminOnly',
  'forgotPassword.title',
  'forgotPassword.schoolHint',
  'forgotPassword.submit',
  'forgotPassword.sent',
  'forgotPassword.sentHint',
  'forgotPassword.back',
];

describe('the form is validated by the shared schema, not a mobile copy', () => {
  test('accepts a school code and an email', () => {
    const parsed = parseForgotPasswordForm({ schoolId: 'lincoln-high', email: 'ada@school.edu' });
    assert.deepEqual(parsed, {
      ok: true,
      value: { school_id: 'lincoln-high', email: 'ada@school.edu' },
    });
  });

  test('trims both fields, so a pasted code is not lectured at', () => {
    const parsed = parseForgotPasswordForm({
      schoolId: '  lincoln-high  ',
      email: ' ada@school.edu ',
    });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, {
      school_id: 'lincoln-high',
      email: 'ada@school.edu',
    });
  });

  test('requires the school code — unlike login, where blank means platform admin', () => {
    const parsed = parseForgotPasswordForm({ schoolId: '   ', email: 'ada@school.edu' });
    assert.equal(parsed.ok, false);
    assert.ok(
      !parsed.ok && parsed.error.issues.some((issue) => issue.path.includes('school_id')),
      'the failure must name the school field',
    );
  });

  test('rejects a malformed email before spending a request on it', () => {
    const parsed = parseForgotPasswordForm({ schoolId: 'lincoln-high', email: 'not-an-email' });
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && parsed.error.issues.some((issue) => issue.path.includes('email')));
  });

  test('the two fields are the two the login screen already has', () => {
    assert.deepEqual([...FORGOT_PASSWORD_FIELDS], ['school_id', 'email']);
  });
});

describe('one sentence for every outcome (anti-enumeration)', () => {
  test('only a 400 or a 429 may say something else', () => {
    assert.equal(forgotPasswordErrorIsVisible(400), true, 'the shape check is about the request');
    assert.equal(forgotPasswordErrorIsVisible(429), true, 'the rate limit is about the request');
    for (const status of [401, 403, 404, 409, 422, 500, 502, 503, null, undefined]) {
      assert.equal(
        forgotPasswordErrorIsVisible(status),
        false,
        `${String(status)} must not be distinguishable from success`,
      );
    }
  });

  test('a transport failure is indistinguishable from a sent email', () => {
    // No status at all (offline, DNS, timeout) is the case that matters:
    // "could not send" vs the confirmation would tell an attacker whether
    // the address was accepted downstream.
    assert.equal(errorStatus(new Error('Network request failed')), null);
    assert.equal(forgotPasswordErrorIsVisible(errorStatus(new Error('boom'))), false);
  });

  test('reads the status off an api-client error envelope', () => {
    assert.equal(errorStatus({ status: 429, code: 'RATE_LIMITED' }), 429);
    assert.equal(errorStatus({ status: '429' }), null, 'a non-numeric status is no status');
    assert.equal(errorStatus(null), null);
  });

  test("the confirmation is the server's own sentence, word for word", () => {
    assert.equal(en['forgotPassword.sent'], GENERIC_MESSAGE);
  });
});

describe('the screen is wired to the endpoint that already exists', () => {
  test('it calls forgotPassword through the shared API client', () => {
    const screen = code(SCREEN);
    assert.match(screen, /apiClient\.forgotPassword\(/, 'the existing endpoint, as-is');
    assert.match(screen, /from '\.\.\/src\/services\/api'/, 'one API client for the whole app');
  });

  test('it reuses the shared schema rather than re-validating by hand', () => {
    const logic = code(LOGIC);
    assert.match(
      logic,
      /from '@school-bus-tracking\/validation'/,
      'the rules come from the shared package',
    );
    assert.ok(logic.includes('forgotPasswordSchema'), 'the same schema the server uses');
    assert.ok(
      !/@school-bus-tracking\/api-client/.test(logic),
      'the api-client must not be touched by this feature',
    );
  });

  test('it never renders the response body', () => {
    const screen = code(SCREEN);
    assert.ok(
      !/response\.(data|message)|envelope\.|unwrapEnvelope/.test(screen),
      'the body is the same for every outcome; rendering it invites a conditional',
    );
    assert.ok(screen.includes("t('forgotPassword.sent')"), 'the fixed sentence is shown instead');
  });

  test('the generic confirmation is shown for anything but a 400 or 429', () => {
    const screen = code(SCREEN);
    assert.match(
      screen,
      /forgotPasswordErrorIsVisible\(status\)[\s\S]{0,400}setSubmitted\(true\)/,
      'the else branch of the visible-error check must confirm, not complain',
    );
  });

  test('there is no reset-password screen in the app — [DECISION 2]', () => {
    // The emailed link opens the web console's reset page, which already
    // exists. No deep link, no App Links / associatedDomains work.
    assert.throws(() => read('app/reset-password.tsx'), /ENOENT/);
    const appJson = read('app.json');
    assert.ok(!/associatedDomains/.test(appJson), 'no iOS associated domains were added');
    assert.ok(!/intentFilters/.test(appJson), 'no Android App Links were added');
  });
});

describe('the link sits on the email path of the login screen', () => {
  test('login offers it, and routes to the new screen', () => {
    const login = code(LOGIN);
    assert.ok(login.includes("t('forgotPassword.link')"), 'the link is on the login screen');
    assert.match(login, /router\.push\('\/forgot-password'\)/, 'it opens the request screen');
  });

  test('it is on the email path, not the crew PIN path', () => {
    const login = code(LOGIN);
    const linkIndex = login.indexOf("t('forgotPassword.link')");
    const crewCardIndex = login.indexOf("t('login.crewPath.pin.title')");
    assert.ok(linkIndex > 0 && crewCardIndex > 0);
    assert.ok(
      linkIndex < crewCardIndex,
      'a crew PIN is reset by the school admin, so the link must not appear on that path',
    );
  });

  test('it carries the "school administrators only" note — [DECISION 3]', () => {
    const login = code(LOGIN);
    assert.ok(login.includes("t('forgotPassword.adminOnly')"), 'the note is rendered on login');
    assert.match(
      en['forgotPassword.adminOnly'],
      /School administrators only/,
      'the note must say who self-service reset is for',
    );
    assert.match(
      en['forgotPassword.adminOnly'],
      /ask your school office/i,
      'and what everyone else should do instead',
    );
  });
});

describe('copy: localised in all three locales, inside its budget', () => {
  test('every word on the screen comes from the dictionary', () => {
    const screen = code(SCREEN);
    for (const key of FORGOT_KEYS) {
      if (key === 'forgotPassword.link') continue; // rendered on the login screen
      assert.ok(screen.includes(`t('${key}')`), `${key} must be rendered through t()`);
    }
    assert.ok(screen.includes('useTranslation()'), 'the screen re-reads copy on a switch');
  });

  test('all three locales carry the new keys, and nobody left English behind', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale);
      for (const key of FORGOT_KEYS) {
        assert.ok(dict[key]?.trim().length, `${locale}:${key} is empty`);
        if (locale !== 'en') {
          assert.notEqual(dict[key], en[key], `${locale}:${key} is still the English string`);
        }
      }
    }
  });

  test('the three buttons carry a clipping budget in every locale', () => {
    for (const key of [
      'forgotPassword.link',
      'forgotPassword.submit',
      'forgotPassword.back',
    ] as TranslationKey[]) {
      const budget = budgetFor(key);
      assert.equal(budget?.kind, 'buttonFull', `${key} labels a full-width button`);
      for (const locale of SUPPORTED_LOCALES) {
        const value = dictionary(locale)[key];
        assert.ok(
          value.length <= budget!.maxChars,
          `${locale}:${key} is ${value.length} chars, over ${budget!.maxChars}`,
        );
      }
    }
  });
});
