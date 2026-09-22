import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SUPPORTED_LOCALES, dictionary } from '../../lib/i18n.ts';
import { isNetworkFailureError } from '../../lib/error-messages.ts';

/**
 * The wiring guard for "offline login shows a friendly message, never a raw
 * diagnostic".
 *
 * The classification itself is unit-tested in
 * `src/lib/error-messages.spec.ts` (`isNetworkFailureError` and the Android
 * transport patterns) and `crew-login-flow.spec.ts`
 * (`isCrewLoginNetworkFailure`). This spec pins the *wiring*: both login
 * paths must check connectivity before sending and must map a transport
 * failure — pre-check **or** a connection that dies mid-flight — to the
 * app's own `login.offline` sentence in every locale.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

describe('app/login.tsx — offline handling is wired on both paths', () => {
  const source = read('app/login.tsx');

  it('checks connectivity before spending a round trip', () => {
    assert.ok(source.includes('NetInfo'), 'connectivity comes from NetInfo');
    assert.ok(source.includes('hasInternet()'), 'both submits gate on hasInternet()');
    const preChecks = source.match(/!\(await hasInternet\(\)\)/g) ?? [];
    assert.ok(
      preChecks.length >= 2,
      `the email path and the crew PIN path must both pre-check (found ${preChecks.length})`,
    );
  });

  it('classifies an in-flight transport failure on both paths', () => {
    assert.ok(
      source.includes('isNetworkFailureError(error)'),
      'email path: status-0 / transport message → offline line',
    );
    assert.ok(
      source.includes('isCrewLoginNetworkFailure(error)'),
      'crew path: status-0 / transport message → offline line',
    );
  });

  it('maps the network case to the friendly sentence on every branch', () => {
    // Two branches per path (pre-check + in-flight catch) = four mappings.
    const mappings = source.match(/t\('login\.offline'\)/g) ?? [];
    assert.ok(
      mappings.length >= 4,
      `expected the offline line on both pre-checks and both catches (found ${mappings.length})`,
    );
  });

  it('a wrong password / locked PIN still takes the normal error path', () => {
    assert.ok(
      source.includes("context: 'login'"),
      '401 on the email form still means "invalid credentials"',
    );
    assert.ok(
      source.includes('localizeCrewLoginError(extractErrorPayload(error))'),
      'PIN rejections still resolve through the code map (lockout, …)',
    );
  });
});

describe('the offline sentence is friendly in every locale', () => {
  const NEVER: RegExp[] = [
    /java/i,
    /unknownhost/i,
    /fetch failed/i,
    /\bexception\b/i,
    /network request failed/i,
  ];

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: login.offline is an actionable sentence, not a diagnostic`, () => {
      const value = (dictionary(locale) as Record<string, string>)['login.offline'];
      assert.ok(value && value.trim().length >= 10, `${locale}: login.offline exists`);
      for (const pattern of NEVER) {
        assert.doesNotMatch(value, pattern, `${locale} leaked ${pattern}: "${value}"`);
      }
    });
  }
});

describe('the classification the login screen relies on', () => {
  it('the Android UnknownHostException detail is a network failure', () => {
    assert.equal(
      isNetworkFailureError(
        new Error(
          'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.school.example"',
        ),
      ),
      true,
    );
    // …while a 401 with a JSON body is a *server* answer, not a network loss.
    assert.equal(isNetworkFailureError({ status: 401, message: 'Unauthorized' }), false);
  });
});
