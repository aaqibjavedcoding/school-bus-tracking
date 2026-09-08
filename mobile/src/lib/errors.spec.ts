import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClientError } from '@school-bus-tracking/api-client';
import { getApiErrorMessage } from './errors.ts';

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
  const HTML_500 =
    '<!DOCTYPE html><html><head><title>500: Internal Server Error</title></head><body><h1>500</h1></body></html>';

  it('never surfaces an HTML error page as the screen error text', () => {
    const error = new ApiClientError(
      `Request failed with status 500: ${HTML_500.slice(0, 200)}`,
      500,
      HTML_500,
    );
    const message = getApiErrorMessage(error);
    assert.doesNotMatch(message, /<!doctype|<html/i);
    assert.match(message, /HTTP 500/);
  });

  it('keeps envelope messages and the 401/403/network sentences unchanged', () => {
    const enveloped = new ApiClientError('Request failed with status 500', 500, {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    });
    assert.equal(getApiErrorMessage(enveloped), 'An unexpected error occurred.');
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
