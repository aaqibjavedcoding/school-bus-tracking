import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClientError } from '@school-bus-tracking/api-client';

import {
  FIX_HIGHLIGHTED_FIELDS,
  attributeMessageToField,
  fieldErrorMessage,
  formMessageForInvalidSubmission,
  isHumanGuidance,
  isRawValidationText,
  labelForField,
  mapApiValidationErrors,
  pickFieldLabels,
} from './field-errors.ts';
import { fieldErrorsFromUnknown, submitErrorMessage } from './errors.ts';

/**
 * The rule this module exists for, from the bug report: **a validation failure
 * is guidance that names the field, and never raw DTO text.**
 *
 * Every case below is a message the API or the shared Zod schemas really produce
 * (see `web/src/server/framework/validation-pipe.ts` and
 * `packages/validation/src/index.ts`), mapped the way a screen maps it.
 */

const envelope = (body: Record<string, unknown>): ApiClientError =>
  new ApiClientError('Request failed with status 400', 400, body);

describe('raw validator text', () => {
  it('is recognised whatever the validator said', () => {
    for (const raw of [
      'email must be an email',
      'admin.last_name should not be empty',
      'capacity must be an integer number',
      'issue_date must be a valid ISO-8601 date (YYYY-MM-DD) or date-time',
      'String must contain at least 8 character(s)',
      'id must be a UUID 0f5f3c4e-9b6a-4d3f-8f1c-2a7b6c5d4e3f',
      '{"statusCode":400,"message":["bad request"]}',
      'Request failed with status 422',
    ]) {
      assert.equal(isRawValidationText(raw), true, raw);
      assert.equal(isHumanGuidance(raw), false, raw);
    }
  });

  it('is not confused with a server sentence', () => {
    for (const friendly of [
      'Please enter the bus number.',
      'A student with this admission number already exists.',
      "You've reached your plan limit of 50 buses.",
      'Expiry date must be after the issue date.',
    ]) {
      assert.equal(isHumanGuidance(friendly), true, friendly);
    }
  });
});

describe('fieldErrorMessage', () => {
  it('rewrites schema text into guidance that names the field', () => {
    assert.equal(
      fieldErrorMessage('email must be an email', 'email'),
      'Please enter a valid email address, for example name@school.edu.',
    );
    assert.equal(
      fieldErrorMessage('password should not be empty', 'password'),
      'Please enter the password.',
    );
    assert.equal(
      fieldErrorMessage('capacity must be an integer number', 'capacity'),
      'Please enter a whole number for the capacity.',
    );
    assert.equal(
      fieldErrorMessage('issue_date must be a valid ISO-8601 date', 'issue_date'),
      'Please enter the issue date as a real date, for example 2026-04-01.',
    );
  });

  it('keeps a friendly server sentence verbatim', () => {
    const message = 'A bus with this registration number already exists.';
    assert.equal(
      fieldErrorMessage(message, 'registration_number'),
      // already names the field → shown as the API wrote it
      message,
    );
  });

  it('prefixes guidance that names nothing', () => {
    assert.equal(
      fieldErrorMessage('This is required.', 'pickup_time'),
      'Pickup time: this is required.',
    );
  });

  it('uses the labels the form passes in', () => {
    assert.equal(
      fieldErrorMessage('drop_time must be a valid time', 'drop_time', {
        drop_time: 'drop-off time',
      }),
      'Please enter the drop-off time as a time, for example 07:30.',
    );
    assert.equal(labelForField('bus.document_number'), 'document number');
  });
});

describe('attributeMessageToField', () => {
  it('matches on words, not on substrings', () => {
    // `run` is a field on the route screen; it must not capture prose about a
    // school "running" a service.
    assert.equal(attributeMessageToField('The school is running a trial.', ['run']), null);
    assert.equal(attributeMessageToField('Please enter the run date.', ['run']), 'run');
  });

  it('gives the message to the most specific field', () => {
    assert.equal(
      attributeMessageToField('Expiry date must be after the issue date.', [
        'date',
        'issue_date',
        'expiry_date',
      ]),
      'expiry_date',
    );
  });
});

describe('mapApiValidationErrors', () => {
  it('reads the flat message array the validation pipe throws', () => {
    const error = envelope({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: ['Please enter the document number.', 'Please enter the expiry date.'],
      },
    });
    const mapping = mapApiValidationErrors(
      error,
      pickFieldLabels(['document_number', 'issue_date', 'expiry_date']),
    );
    assert.deepEqual(mapping.fieldErrors, {
      document_number: 'Please enter the document number.',
      expiry_date: 'Please enter the expiry date.',
    });
    // Both messages landed on an input, so the form line is the "fix" sentence.
    assert.equal(formMessageForInvalidSubmission(mapping), FIX_HIGHLIGHTED_FIELDS);
  });

  it('keeps a sentence no input owns at form level', () => {
    const error = envelope({
      success: false,
      error: { code: 'CONFLICT', message: ['The trip has already started.'] },
    });
    const mapping = mapApiValidationErrors(error, pickFieldLabels(['document_number']));
    assert.deepEqual(mapping.fieldErrors, {});
    assert.deepEqual(mapping.formErrors, ['The trip has already started.']);
    assert.equal(formMessageForInvalidSubmission(mapping), 'The trip has already started.');
  });

  it('never surfaces an identifier or a status line', () => {
    const error = envelope({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: ['route_id must be a UUID 0f5f3c4e-9b6a-4d3f-8f1c-2a7b6c5d4e3f'],
        details: { stop_id: '<!DOCTYPE html><html><body>Bad Gateway</body></html>' },
      },
    });
    const mapping = mapApiValidationErrors(error, pickFieldLabels(['route_id', 'stop_id']));
    for (const message of Object.values(mapping.fieldErrors)) {
      assert.doesNotMatch(message, /UUID|0f5f3c4e|DOCTYPE|Bad Gateway|must be a/, message);
      assert.match(message, /^[A-Z]/, message);
    }
    assert.deepEqual(mapping.formErrors, []);
  });
});

describe('the screen-facing helpers', () => {
  it('maps an API failure onto a form without any per-screen wiring', () => {
    const error = envelope({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: ['Please enter the bus number.'] },
    });
    assert.deepEqual(fieldErrorsFromUnknown(error, pickFieldLabels(['bus_number'])), {
      bus_number: 'Please enter the bus number.',
    });
    assert.equal(
      submitErrorMessage(error, pickFieldLabels(['bus_number'])),
      FIX_HIGHLIGHTED_FIELDS,
    );
  });

  it('says nothing when there is nothing to say', () => {
    assert.equal(submitErrorMessage(new Error('boom'), pickFieldLabels(['bus_number'])), '');
    assert.deepEqual(fieldErrorsFromUnknown(new Error('boom')), {});
  });
});
