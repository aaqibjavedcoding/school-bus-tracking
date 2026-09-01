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
