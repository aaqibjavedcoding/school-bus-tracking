import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { adminSchoolCreateSchema, loginSchema } from '@school-bus-tracking/validation';
import { ApiClientError } from '@school-bus-tracking/api-client';
import {
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
  isRawDocumentBody,
} from './errors.ts';

/**
 * Regression guard for the Super Admin "Add school" form.
 *
 * The form validates with the nested `adminSchoolCreateSchema`
 * (`{ school: {...}, admin: {...} }`) and renders one message per field under
 * the key `school.code`, `admin.password`, … A previous implementation read
 * `error.flatten().fieldErrors`, which Zod keys by **top-level** property only
 * (`school`, `admin`). Every lookup therefore missed, no message was rendered
 * and the submit button appeared to do nothing at all.
 *
 * These tests fail against `flatten()`-based mapping and pass against the
 * issue-path mapping now used by `fieldErrorsFromZod`.
 */
describe('web zod error mapping', () => {
  const validSchool = {
    name: 'Lincoln High School',
    code: 'lincoln-high',
    email: null,
    phone: null,
    city: null,
    country: null,
    timezone: 'UTC',
  };

  const validAdmin = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'admin@lincoln.test',
    password: 'correct-horse',
    phone: null,
  };

  it('accepts the payload the Add school form builds from valid input', () => {
    const result = adminSchoolCreateSchema.safeParse({ school: validSchool, admin: validAdmin });
    assert.equal(result.success, true);
  });

  it('maps nested schema issues to the dotted keys the form renders', () => {
    const result = adminSchoolCreateSchema.safeParse({
      school: { ...validSchool, code: 'Lincoln High' },
      admin: { ...validAdmin, last_name: '', password: 'short' },
    });

    assert.equal(result.success, false);
    if (result.success) return;

    assert.deepEqual(fieldErrorsFromZod(result.error), {
      'school.code': 'School code must be lowercase alphanumeric segments separated by hyphens',
      'admin.last_name': 'String must contain at least 1 character(s)',
      'admin.password': 'Password must be at least 8 characters',
    });
  });

  it('never returns an unmappable key for an invalid Add school submission', () => {
    // The exact keys the form's <Field error={...}> lookups use. A key that is
    // not in this set renders nowhere — that is what made the submit silent.
    const RENDERED_KEYS = new Set([
      'school.name',
      'school.code',
      'school.email',
      'school.phone',
      'school.city',
      'school.country',
      'school.timezone',
      'admin.first_name',
      'admin.last_name',
      'admin.email',
      'admin.phone',
      'admin.password',
    ]);

    const invalidForms = [
      { school: { ...validSchool, name: '   ' }, admin: validAdmin },
      { school: { ...validSchool, code: 'lincoln_high' }, admin: validAdmin },
      { school: { ...validSchool, email: 'office-at-school' }, admin: validAdmin },
      { school: { ...validSchool, timezone: 'GMT+5' }, admin: validAdmin },
      { school: validSchool, admin: { ...validAdmin, email: 'admin@' } },
    ];

    for (const body of invalidForms) {
      const result = adminSchoolCreateSchema.safeParse(body);
      assert.equal(result.success, false);
      if (result.success) continue;
      const keys = Object.keys(fieldErrorsFromZod(result.error));
      assert.ok(keys.length > 0, 'no field error mapped at all');
      for (const key of keys) {
        assert.ok(
          RENDERED_KEYS.has(key),
          `mapped key "${key}" is not rendered by the Add school form`,
        );
      }
    }
  });

  it('surfaces object-level issues (strict body) as form errors', () => {
    const result = adminSchoolCreateSchema.safeParse({
      school: validSchool,
      admin: validAdmin,
      role: 'SUPER_ADMIN',
    });

    assert.equal(result.success, false);
    if (result.success) return;

    assert.deepEqual(fieldErrorsFromZod(result.error), {});
    const formErrors = formErrorsFromZod(result.error);
    assert.equal(formErrors.length, 1);
    assert.match(formErrors[0], /role/);
  });

  it('keeps single-segment paths working for the flat schemas other pages use', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret' });

    assert.equal(result.success, false);
    if (result.success) return;

    assert.deepEqual(Object.keys(fieldErrorsFromZod(result.error)), ['email']);
    assert.deepEqual(formErrorsFromZod(result.error), []);
  });
});

describe('web import multipart JSON-parse error', () => {
  it('surfaces the ------WebK parse error the Import wizard showed', () => {
    const message = `Unexpected token '-', "------WebK"... is not valid JSON`;
    const error = new ApiClientError('Request failed with status 400', 400, {
      success: false,
      error: { code: 'Bad Request', message },
    });
    assert.equal(getApiErrorMessage(error), message);
  });
});

describe('web plan-limit error handling', () => {
  it('surfaces the API plan-limit message instead of a generic error', () => {
    const message =
      "You've reached your plan limit of 100 students. Please upgrade your plan or remove an existing student to add another.";
    const error = new ApiClientError('Request failed with status 409', 409, {
      success: false,
      error: {
        code: 'PLAN_LIMIT_REACHED',
        message,
        details: { resource: 'students', limit: 100, usage: 100 },
      },
    });
    assert.equal(getApiErrorMessage(error), message);
    assert.ok(!getApiErrorMessage(error).includes('Something went wrong'));
    assert.match(getApiErrorMessage(error), /100 students/);
  });
});

/**
 * Regression guard for the "raw JSON / HTML shown instead of the dashboard"
 * report.
 *
 * When a route handler cannot even be loaded (a stale/partial `web/dist`
 * after `git pull`), Next answers `GET /dashboard/stats` with its generic 500
 * page. The api-client keeps that body on `ApiClientError.details` (correct —
 * it is the real response) and `useLoad` rendered `getApiErrorMessage(...)` in
 * the `ErrorState`, i.e. the whole `<!DOCTYPE html>…` document with the
 * embedded `__NEXT_DATA__` JSON. The message helper must never surface a
 * document as the error text.
 */
describe('web raw document error bodies', () => {
  const NEXT_500_PAGE =
    '<!DOCTYPE html><html><head><meta charSet="utf-8"/><title>500: Internal Server Error</title></head>' +
    '<body><div id="__next"><h1 class="next-error-h1">500</h1><h2>Internal Server Error.</h2></div>' +
    '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"statusCode":500}},"page":"/_error","err":{"name":"Internal Server Error.","message":"500 - Internal Server Error.","statusCode":500}}</script></body></html>';

  it('recognises HTML/XML documents and leaves real messages alone', () => {
    assert.equal(isRawDocumentBody(NEXT_500_PAGE), true);
    assert.equal(isRawDocumentBody('  <html lang="en"><body>Bad gateway</body></html>'), true);
    assert.equal(isRawDocumentBody('<?xml version="1.0"?><error/>'), true);
    assert.equal(isRawDocumentBody('Route not found'), false);
    assert.equal(isRawDocumentBody('a < b and b > c'), false);
    assert.equal(isRawDocumentBody({ message: '<b>bold</b>' }), false);
    assert.equal(isRawDocumentBody(undefined), false);
  });

  it('never renders the Next.js 500 page as the dashboard error text', () => {
    const error = new ApiClientError(
      `Request failed with status 500: ${NEXT_500_PAGE.slice(0, 200)}`,
      500,
      NEXT_500_PAGE,
    );
    const message = getApiErrorMessage(error);
    assert.doesNotMatch(message, /<!doctype|<html|__NEXT_DATA__|\{"props"/i);
    assert.match(message, /HTTP 500/);
    assert.match(message, /try again/i);
  });

  it('uses a plain sentence for an empty 5xx body instead of the status-only client message', () => {
    const error = new ApiClientError('Request failed with status 502', 502, undefined);
    assert.equal(
      getApiErrorMessage(error),
      'The server could not complete the request (HTTP 502). Please try again in a moment.',
    );
  });

  it('still prefers the JSON envelope message when the API did describe the failure', () => {
    const error = new ApiClientError('Request failed with status 500', 500, {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
      },
    });
    assert.equal(
      getApiErrorMessage(error),
      'An unexpected error occurred. Please try again later.',
    );
  });

  it('keeps the existing 4xx behaviour for plain-text bodies', () => {
    const error = new ApiClientError(
      'Request failed with status 409: Seat already taken',
      409,
      'Seat already taken',
    );
    assert.equal(getApiErrorMessage(error), 'Seat already taken');
    assert.equal(
      getApiErrorMessage(new ApiClientError('x', 0, undefined)),
      'Network error. Check your connection and try again.',
    );
    assert.equal(
      getApiErrorMessage(new ApiClientError('x', 401, undefined)),
      'Your session has expired. Please sign in again.',
    );
    assert.equal(
      getApiErrorMessage(new ApiClientError('x', 403, undefined)),
      'You do not have permission to do that.',
    );
  });
});
