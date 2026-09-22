import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  USER_MESSAGES,
  isNetworkFailureError,
  isNetworkFailureMessage,
  isRawDocumentBody,
  isTechnicalMessage,
  sanitizeUserFacingMessage,
  statusFallbackMessage,
} from './error-messages.ts';
import { SUPPORTED_LOCALES, dictionary } from './i18n.ts';

/**
 * The user-facing error boundary (`lib/error-messages.ts`) — the regression
 * suite for the reported bug: a parent typing the wrong password was shown
 * `Request failed with status 401`.
 *
 * Three kinds of assertion:
 *
 * 1. **Mapping** — every status the app can see maps to a sentence a person
 *    can act on (and a 401 means different things on the login form and in a
 *    signed-in session);
 * 2. **Classification** — every shape of technical text the transports
 *    produce (client diagnostic, HTML page, framework reason phrase, stack
 *    trace, request id, database error, raw JSON) is flagged, while a useful
 *    server business message is left alone;
 * 3. **The whole-app guard** — no *display* file (and no dictionary value)
 *    hardcodes a status code or the client's diagnostic prefix, so the rule
 *    cannot be reintroduced by the next screen.
 */

/** Statuses the API can answer with, plus the transport's `0`. */
const STATUSES = [0, 400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504];

/** Anything that must never appear in copy shown to a user. */
const FORBIDDEN_IN_COPY: RegExp[] = [
  /\bhttp\b/i,
  /\brequest failed\b/i,
  /\bstatus code\b/i,
  /\b[1-5]\d{2}\b/, // a bare three-digit status
  /<\/?[a-z][\s\S]*>/i, // markup
  /\bstack\b/i,
  /\b(error|exception)\b/i,
];

function assertUserFacing(message: string, label: string): void {
  for (const pattern of FORBIDDEN_IN_COPY) {
    assert.doesNotMatch(message, pattern, `${label} leaked ${pattern}: "${message}"`);
  }
  assert.ok(message.trim().length > 0, `${label} must not be empty`);
}

describe('status → user-facing message', () => {
  it('maps every status the app can see, with no technical words', () => {
    for (const status of STATUSES) {
      const message = statusFallbackMessage(status, 'Something went wrong');
      assertUserFacing(message, `status ${status}`);
    }
  });

  it('uses the documented sentence for each status', () => {
    assert.equal(statusFallbackMessage(0, 'x'), USER_MESSAGES.network);
    assert.equal(statusFallbackMessage(400, 'x'), USER_MESSAGES.badRequest);
    assert.equal(statusFallbackMessage(401, 'x'), USER_MESSAGES.sessionExpired);
    assert.equal(statusFallbackMessage(403, 'x'), USER_MESSAGES.forbidden);
    assert.equal(statusFallbackMessage(404, 'x'), USER_MESSAGES.notFound);
    assert.equal(statusFallbackMessage(409, 'x'), USER_MESSAGES.conflict);
    assert.equal(statusFallbackMessage(422, 'x'), USER_MESSAGES.validation);
    assert.equal(statusFallbackMessage(429, 'x'), USER_MESSAGES.tooManyAttempts);
    assert.equal(statusFallbackMessage(500, 'x'), USER_MESSAGES.server);
    assert.equal(statusFallbackMessage(503, 'x'), USER_MESSAGES.server);
  });

  it('a 401 on the login form means wrong credentials, not an expired session', () => {
    assert.equal(statusFallbackMessage(401, 'x', 'login'), USER_MESSAGES.loginCredentials);
    assert.match(USER_MESSAGES.loginCredentials, /Invalid email or password/);
    assert.notEqual(USER_MESSAGES.loginCredentials, USER_MESSAGES.sessionExpired);
  });

  it('keeps the caller’s fallback only when it is itself safe', () => {
    assert.equal(
      statusFallbackMessage(418, 'Could not update the trip.'),
      'Could not update the trip.',
    );
    assert.equal(
      statusFallbackMessage(418, 'Request failed with status 418'),
      USER_MESSAGES.unknown,
    );
    assert.equal(statusFallbackMessage(418), USER_MESSAGES.unknown);
  });
});

describe('technical text detection', () => {
  it('flags the API client’s own diagnostic for every status', () => {
    for (const status of STATUSES) {
      assert.equal(
        isTechnicalMessage(`Request failed with status ${status}`),
        true,
        `status ${status}`,
      );
    }
    assert.equal(
      isTechnicalMessage('Request failed with status 500: <!DOCTYPE html><html>…</html>'),
      true,
    );
  });

  it('flags transport, framework, runtime, database and trace leaks', () => {
    const technical = [
      'Network Error',
      'Network request failed',
      'Failed to fetch',
      'timeout of 10000ms exceeded',
      'ECONNREFUSED',
      'ERR_CONNECTION_REFUSED',
      'TypeError: Network request failed',
      "undefined is not an object (evaluating 'response.json')",
      'Unexpected token < in JSON at position 0',
      'body stream already read',
      'Internal server error',
      'Unauthorized',
      'Forbidden',
      'Bad Request',
      'Not Found',
      'Service Unavailable',
      '{"statusCode":500,"message":"Internal server error"}',
      '[object Object]',
      'Error: connect ETIMEDOUT 10.0.0.4:3001\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)',
      'SequelizeUniqueConstraintError: Validation error',
      'duplicate key value violates unique constraint "users_email_key"',
      'SQLSTATE 23505',
      'request id: 8f14e45f-ceea-467f',
      'X-Request-Id: 12345',
    ];
    for (const value of technical) {
      assert.equal(isTechnicalMessage(value), true, `should be technical: ${value}`);
    }
  });

  it('leaves useful server business messages alone', () => {
    const safe = [
      "You've reached your plan limit of 50 buses. Please upgrade your plan or remove an existing bus to add another.",
      'A student with this admission number already exists.',
      'Run overlaps the 07:10 window',
      'Already boarded',
      'Invalid transition',
      'Insufficient role permissions',
      'User account is inactive',
      'School is inactive',
      'That PIN did not work. Please try again.',
      'email must be an email',
    ];
    for (const value of safe) {
      assert.equal(isTechnicalMessage(value), false, `should be safe: ${value}`);
    }
  });

  it('treats empty, whitespace and non-strings as unusable', () => {
    for (const value of ['', '   ', null, undefined, 42, {}, []]) {
      assert.equal(isTechnicalMessage(value), true, `expected technical: ${String(value)}`);
      assert.equal(sanitizeUserFacingMessage(value), null);
    }
  });

  it('sanitises by trimming, or returning null', () => {
    assert.equal(sanitizeUserFacingMessage('  Already boarded  '), 'Already boarded');
    assert.equal(sanitizeUserFacingMessage('Request failed with status 409'), null);
  });

  it('recognises documents and network failures separately', () => {
    assert.equal(isRawDocumentBody('<!DOCTYPE html><html>…'), true);
    assert.equal(isRawDocumentBody('{"success":false}'), false);
    assert.equal(isNetworkFailureMessage('Network request failed'), true);
    assert.equal(isNetworkFailureMessage('Invalid transition'), false);
  });

  it('classifies the Android transport diagnostics as network failures', () => {
    // These are the raw strings the login screen used to leak on Android with
    // data off — each one must now be mapped to the app's own offline line.
    const networkTexts = [
      'fetch failed',
      'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.school.example"',
      'Unable to resolve host "api.school.example": No address associated with hostname',
      'Network request failed',
      'connection refused',
    ];
    for (const value of networkTexts) {
      assert.equal(isNetworkFailureMessage(value), true, `should be network: ${value}`);
      assert.equal(isTechnicalMessage(value), true, `should stay technical: ${value}`);
    }
    // A business message that merely mentions connectivity must not match.
    assert.equal(isNetworkFailureMessage('That PIN did not work. Please try again.'), false);
  });
});

describe('isNetworkFailureError — thrown errors', () => {
  it('treats the api-client "status 0" envelope as offline regardless of message', () => {
    assert.equal(
      isNetworkFailureError({ status: 0, message: 'Request failed with status 0' }),
      true,
      'status 0 is the client’s “no response” convention',
    );
    assert.equal(isNetworkFailureError({ status: 0 }), true);
  });

  it('classifies a plain transport Error by its message', () => {
    assert.equal(isNetworkFailureError(new Error('Network request failed')), true);
    assert.equal(
      isNetworkFailureError(
        new Error('fetch failed: java.net.UnknownHostException: Unable to resolve host'),
      ),
      true,
      'the Android diagnostic must be recognised from the message alone',
    );
  });

  it('leaves server responses and other failures alone', () => {
    assert.equal(isNetworkFailureError({ status: 401, message: 'Unauthorized' }), false);
    assert.equal(isNetworkFailureError({ status: 500, message: 'Internal server error' }), false);
    assert.equal(isNetworkFailureError(new Error('Invalid transition')), false);
    assert.equal(isNetworkFailureError('a string, not an error object'), false);
    assert.equal(isNetworkFailureError(null), false);
    assert.equal(isNetworkFailureError(undefined), false);
  });
});

// ── The whole-app guard ────────────────────────────────────────────────────

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

/**
 * Every layer that renders UI or produces the strings a screen shows —
 * `src/lib` is deliberately excluded: it *is* the boundary (the classifier and
 * the dictionaries), and the dictionary values are asserted directly below.
 */
const DISPLAY_DIRS = [
  'app',
  'src/components',
  'src/features',
  'src/hooks',
  'src/services',
  'src/theme',
];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(mobileRoot, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(mobileRoot, relative)).isDirectory()) listFiles(relative, out);
    else out.push(relative);
  }
  return out;
}

/**
 * Drops comments so a *doc* mention of "Request failed with status 401" (there
 * are several, explaining exactly why it must never be shown) is not mistaken
 * for copy.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('grep gate: raw API error text stays out of the UI', () => {
  it('no display file hardcodes an HTTP status code or the client diagnostic', () => {
    const files = DISPLAY_DIRS.flatMap((dir) =>
      listFiles(dir).filter(
        (path) => (path.endsWith('.ts') || path.endsWith('.tsx')) && !path.endsWith('.spec.ts'),
      ),
    );
    assert.ok(files.length > 40, `expected the display tree, found ${files.length} files`);

    const violations: string[] = [];
    for (const file of files) {
      const source = stripComments(read(file));
      for (const pattern of [/\bHTTP\s*\d{3}\b/, /Request failed with status/i]) {
        const match = pattern.exec(source);
        if (match) violations.push(`${file}: ${match[0]}`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `technical text in display code (map it through lib/errors.ts):\n${violations.join('\n')}`,
    );
  });

  it('no dictionary value in any locale exposes a status code', () => {
    const violations: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      const dict = dictionary(locale) as Record<string, string>;
      for (const [key, value] of Object.entries(dict)) {
        if (/HTTP\s*\d{3}/i.test(value) || /Request failed/i.test(value)) {
          violations.push(`${locale}:${key} = ${value}`);
        }
      }
    }
    assert.deepEqual(violations, [], `status codes in UI copy:\n${violations.join('\n')}`);
  });
});
