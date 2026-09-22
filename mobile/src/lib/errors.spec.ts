import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClientError } from '@school-bus-tracking/api-client';
import {
  USER_MESSAGES,
  fieldErrorsFromUnknown,
  getApiErrorMessage,
  getLocalizedApiError,
  isRawDocumentBody,
} from './errors.ts';
import { setLocale } from './i18n.ts';

/**
 * The mapper every screen uses: `getApiErrorMessage`.
 *
 * The reported bug was a login screen showing `Request failed with status
 * 401`. These tests pin both halves of the contract:
 *
 * - **never** show a diagnostic (status code, client message, raw document,
 *   stack trace, reason phrase, request id, database error);
 * - **always** keep a server message that is genuinely useful (plan limit,
 *   duplicate admission number, the documented 403 taxonomy).
 */

const HTML_500 =
  '<!DOCTYPE html><html><head><title>500: Internal Server Error</title></head><body><h1>500</h1></body></html>';

/** Patterns that must never appear in anything shown to a user. */
const FORBIDDEN = [
  /request failed/i,
  /\bhttp\b/i,
  /\b[1-5]\d{2}\b/,
  /<!doctype|<html/i,
  /\bat\s+\w+\.\w+\s*\(/, // a stack frame
  /\bstatuscode\b/i,
  /\bsequelize\b/i,
  /\brequest[-_ ]?id\b/i,
];

function assertNoLeak(message: string, label: string): void {
  for (const pattern of FORBIDDEN) {
    assert.doesNotMatch(message, pattern, `${label} leaked ${pattern}: "${message}"`);
  }
}

describe('mobile plan-limit error handling', () => {
  it('surfaces the API plan-limit message instead of a generic error', () => {
    const message =
      "You've reached your plan limit of 50 buses. Please upgrade your plan or remove an existing bus to add another.";
    const error = new ApiClientError('Request failed with status 409', 409, {
      success: false,
      error: {
        code: 'PLAN_LIMIT_REACHED',
        message,
        details: { resource: 'buses', limit: 50, usage: 50 },
      },
    });
    assert.equal(getApiErrorMessage(error), message);
    assert.ok(!getApiErrorMessage(error).includes('Something went wrong'));
    assert.match(getApiErrorMessage(error), /50 buses/);
  });
});

describe('mobile raw document error bodies', () => {
  it('never surfaces an HTML error page as the screen error text', () => {
    const error = new ApiClientError(
      `Request failed with status 500: ${HTML_500.slice(0, 200)}`,
      500,
      HTML_500,
    );
    const message = getApiErrorMessage(error);
    assert.equal(isRawDocumentBody(HTML_500), true);
    assertNoLeak(message, 'HTML 500');
    assert.equal(message, USER_MESSAGES.server);
  });

  it('keeps envelope messages and the 401/403/network sentences', () => {
    const enveloped = new ApiClientError('Request failed with status 500', 500, {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    });
    assert.equal(getApiErrorMessage(enveloped), 'An unexpected error occurred.');
    assert.equal(getApiErrorMessage(new ApiClientError('x', 0, undefined)), USER_MESSAGES.network);
    assert.equal(
      getApiErrorMessage(new ApiClientError('x', 401, undefined)),
      USER_MESSAGES.sessionExpired,
    );
    assert.equal(
      getApiErrorMessage(new ApiClientError('x', 403, undefined)),
      USER_MESSAGES.forbidden,
    );
  });
});

describe('mobile 403 surface', () => {
  /**
   * Pins the documented diagnosis contract (docs/mobile-operations.md): the
   * API's four 403 sources always carry their own reason in the envelope, and
   * the screens show exactly that reason — never the opaque
   * "Request failed with status 403" string and never masked as success.
   */
  it('shows the exact server reason for every 403 the API can produce', () => {
    const reasons = [
      'Insufficient role permissions',
      'User account is inactive',
      'School is inactive',
      'Request origin is not allowed',
    ];
    for (const message of reasons) {
      const error = new ApiClientError('Request failed with status 403', 403, {
        success: false,
        error: { code: 'Forbidden', message },
      });
      assert.equal(getApiErrorMessage(error), message);
    }
  });

  it('does not leak the raw client message for an envelope-less 403', () => {
    // A proxy/CDN edge 403 (no API envelope) falls back to the generic
    // sentence instead of the internal "Request failed with status 403".
    const message = getApiErrorMessage(
      new ApiClientError('Request failed with status 403', 403, ''),
    );
    assert.equal(message, USER_MESSAGES.forbidden);
  });

  it('replaces a bare reason phrase with the app’s own sentence', () => {
    // Nest's default body carries the reason phrase, not the API envelope.
    const error = new ApiClientError('Request failed with status 403', 403, {
      statusCode: 403,
      message: 'Forbidden',
      error: 'Forbidden',
    });
    assert.equal(getApiErrorMessage(error), USER_MESSAGES.forbidden);
  });
});

describe('login credential errors', () => {
  it('maps an envelope-less 401 to the credential sentence, not the status', () => {
    const message = getApiErrorMessage(
      new ApiClientError('Request failed with status 401', 401, undefined),
      'Could not sign in',
      { context: 'login' },
    );
    assert.equal(message, USER_MESSAGES.loginCredentials);
    assertNoLeak(message, 'login 401');
  });

  it('still prefers the server’s own credential message when it sends one', () => {
    const error = new ApiClientError('Request failed with status 401', 401, {
      success: false,
      error: { code: 'HTTP_401', message: 'Invalid email or password' },
    });
    assert.equal(
      getApiErrorMessage(error, 'Could not sign in', { context: 'login' }),
      'Invalid email or password',
    );
  });
});

describe('status mapping without a server message', () => {
  it('maps every status to actionable copy — never the client diagnostic', () => {
    const cases: Array<[number, string]> = [
      [0, USER_MESSAGES.network],
      [400, USER_MESSAGES.badRequest],
      [401, USER_MESSAGES.sessionExpired],
      [403, USER_MESSAGES.forbidden],
      [404, USER_MESSAGES.notFound],
      [409, USER_MESSAGES.conflict],
      [422, USER_MESSAGES.validation],
      [429, USER_MESSAGES.tooManyAttempts],
      [500, USER_MESSAGES.server],
      [502, USER_MESSAGES.server],
      [503, USER_MESSAGES.server],
    ];
    for (const [status, expected] of cases) {
      const message = getApiErrorMessage(
        new ApiClientError('Request failed with status ' + status, status),
      );
      assert.equal(message, expected, `status ${status}`);
      assertNoLeak(message, `status ${status}`);
    }
  });

  it('sanitises non-API errors too', () => {
    assertNoLeak(getApiErrorMessage(new Error('Network request failed')), 'fetch failure');
    assert.equal(getApiErrorMessage(new Error('Network request failed')), USER_MESSAGES.network);
    assert.equal(getApiErrorMessage(new TypeError('x is not a function')), USER_MESSAGES.unknown);
    // App-thrown copy is kept.
    assert.equal(
      getApiErrorMessage(new Error('Could not dispatch the trip.')),
      'Could not dispatch the trip.',
    );
    // A screen fallback is used when there is nothing better, and is itself
    // sanitised when unsafe.
    assert.equal(
      getApiErrorMessage('nonsense', 'Could not save the route.'),
      'Could not save the route.',
    );
    assert.equal(
      getApiErrorMessage('nonsense', 'Request failed with status 400'),
      USER_MESSAGES.unknown,
    );
  });

  it('refuses to join a validator sentence into a message for a screen', () => {
    const error = new ApiClientError('Request failed with status 422', 422, {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: ['email must be an email', 'password is too short'],
      },
    });
    // Both strings are developer text, so the status gets the app's own sentence
    // for a rejected form. The per-field path is what turns them into guidance.
    assert.equal(getApiErrorMessage(error), USER_MESSAGES.validation);
  });

  it('turns each field message into guidance and never renders the diagnostic', () => {
    const error = new ApiClientError('Request failed with status 422', 422, {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { email: 'email must be an email', password: ['Request failed with status 422'] },
      },
    });
    const mapped = fieldErrorsFromUnknown(error);
    assert.deepEqual(mapped, {
      email: 'Please enter a valid email address, for example name@school.edu.',
      password: 'Please check the password and try again.',
    });
    // The rule from the bug report, pinned for the whole map: no raw validator
    // text, no transport diagnostic, and nothing that opens lower-case.
    for (const message of Object.values(mapped)) {
      assert.doesNotMatch(message, /Request failed with status/);
      assert.doesNotMatch(message, /^[a-z]/);
    }
  });
});

describe('localised twin', () => {
  it('maps an envelope-less 401 to a sentence in the active locale', () => {
    try {
      setLocale('hi', { persist: false });
      const localized = getLocalizedApiError(
        new ApiClientError('Request failed with status 401', 401),
      );
      assert.equal(localized.message, 'आपका सेशन ख़त्म हो गया है। कृपया दोबारा साइन इन करें।');
      assert.equal(localized.codeNote, null);
    } finally {
      setLocale('en', { persist: false });
    }
  });

  it('never returns the client diagnostic for an unknown code', () => {
    const error = new ApiClientError('Request failed with status 500', 500, {
      success: false,
      error: { code: 'SOMETHING_NEW', message: 'Request failed with status 500' },
    });
    const localized = getLocalizedApiError(error);
    assertNoLeak(localized.message, 'unknown code');
    assert.match(localized.codeNote ?? '', /SOMETHING_NEW/);
  });
});
