import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClientError } from '@school-bus-tracking/api-client';
import {
  FIELD_LABELS,
  attributeMessageToField,
  fieldErrorMessage,
  guidanceFor,
  isHumanGuidance,
  isRawValidationText,
  labelForField,
  mapApiValidationErrors,
  pickFieldLabels,
} from './field-errors.ts';
import { fieldErrorsFromZod, fieldErrorsFromUnknown, submitErrorMessage } from './errors.ts';

/**
 * The validation-display contract every web form relies on:
 *
 * - a server 400 with a **flat** friendly message array lands on the right input;
 * - a per-field map from the API is honoured;
 * - **no raw DTO or UUID text is ever rendered** — developer wording becomes
 *   guidance that names the field;
 * - nothing is dropped: what cannot be attributed goes to the form-level line.
 */

/** The `BadRequestException` body the API's ValidationPipe produces. */
const badRequest = (message: string | string[]): ApiClientError =>
  new ApiClientError('Request failed with status 400', 400, {
    success: false,
    error: { code: 'Bad Request', message },
    statusCode: 400,
  });

describe('label registry', () => {
  it('labels every field name contains no capitals or snake_case residue', () => {
    for (const [field, label] of Object.entries(FIELD_LABELS)) {
      assert.match(field, /^[a-z0-9_.]+$/, `field key "${field}" must be a DTO property name`);
      assert.doesNotMatch(label, /[A-Z][a-z]/, `label for ${field} is not prose`);
      assert.doesNotMatch(label, /_/, `label for ${field} still carries an underscore`);
    }
  });

  it('falls back to spaced words rather than a raw property name', () => {
    assert.equal(labelForField('bus_capacity'), 'bus capacity');
    assert.equal(labelForField('school.name'), 'school name');
    assert.equal(labelForField('route_id'), 'route');
  });

  it('pickFieldLabels keeps only what a form renders, with registry labels', () => {
    assert.deepEqual(pickFieldLabels(['registration_number', 'capacity']), {
      registration_number: 'registration number',
      capacity: 'capacity',
    });
  });
});

describe('raw text detection', () => {
  it('flags validator prose that names a property', () => {
    for (const raw of [
      'capacity must be an integer number',
      'registration_number should not be empty',
      'issue_date must be a valid ISO-8601 date (YYYY-MM-DD) or date-time',
      'String must contain at least 1 character(s)',
      '{"statusCode":400,"message":"Bad Request"}',
      'id must be a UUID, received 5f0c8f36-3a9e-4c1d-9b62-7f2f4a3c8d11',
    ]) {
      assert.equal(isRawValidationText(raw), true, `expected "${raw}" to be flagged`);
    }
  });

  it('keeps the sentences the API writes for humans', () => {
    for (const friendly of [
      'Please enter a value for the registration number.',
      'A bus with this registration number already exists.',
      "You've reached your plan limit of 50 buses.",
      'Password must be at least 8 characters',
    ]) {
      assert.equal(isHumanGuidance(friendly), true, `expected "${friendly}" to be kept`);
    }
  });
});

describe('guidance wording', () => {
  it('names the field in every sentence it produces', () => {
    const kinds = [
      'required',
      'date',
      'integer',
      'email',
      'url',
      'choice',
      'taken',
      'invalid',
    ] as const;
    for (const kind of kinds) {
      const text = guidanceFor('expiry date', kind);
      assert.match(text, /expiry date/i, `${kind} must name the field`);
      assert.match(text, /^[A-Z]/, `${kind} must read as a sentence`);
      assert.doesNotMatch(text, /[a-z]+_[a-z]+/, `${kind} must not leak a property name`);
    }
  });

  it('rewrites Zod and class-validator wording into guidance', () => {
    assert.equal(fieldErrorMessage('issue_date', 'date cannot be empty'), guidanceFor('issue date', 'required'));
    assert.equal(
      fieldErrorMessage('capacity', 'must be a valid ISO-8601 date (YYYY-MM-DD) or date-time'),
      guidanceFor('capacity', 'date'),
    );
    assert.equal(
      fieldErrorMessage('email', 'String must contain at least 1 character(s)'),
      guidanceFor('email address', 'tooShort'),
    );
  });

  it('keeps a server sentence that is already guidance, and prefixes one that names nothing', () => {
    assert.equal(
      fieldErrorMessage('expiry_date', 'Please enter an expiry date after the issue date.'),
      'Please enter an expiry date after the issue date.',
    );
    assert.equal(
      fieldErrorMessage('admin.password', 'Password must be at least 8 characters'),
      'Password must be at least 8 characters',
    );
    assert.equal(
      fieldErrorMessage('admin.first_name', 'Please use at most 60 characters.'),
      'First name: please use at most 60 characters.',
    );
  });
});

describe('attribution', () => {
  it('finds the field a sentence names, preferring the longest label', () => {
    assert.equal(
      attributeMessageToField('Please enter a value for the registration number.'),
      'registration_number',
    );
    // The cross-field rule is reported on the field the user has to correct.
    assert.equal(
      attributeMessageToField('Please enter an expiry date after the issue date.'),
      'expiry_date',
    );
    assert.equal(
      attributeMessageToField('A bus with this registration number already exists.'),
      'registration_number',
    );
    assert.equal(attributeMessageToField('The server could not complete the request.'), null);
  });

  it('only attributes to fields the form passed it', () => {
    const labels = pickFieldLabels(['name']);
    assert.equal(attributeMessageToField('Please enter the school name.', labels), 'name');
    assert.equal(attributeMessageToField('Please enter the school code.', labels), null);
  });
});

describe('mapApiValidationErrors', () => {
  it('maps the flat message array onto inputs', () => {
    const error = badRequest([
      'Please enter a value for the registration number.',
      'Please enter a whole number for the capacity.',
    ]);
    assert.deepEqual(mapApiValidationErrors(error).fieldErrors, {
      registration_number: 'Please enter a value for the registration number.',
      capacity: 'Please enter a whole number for the capacity.',
    });
    assert.deepEqual(mapApiValidationErrors(error).formErrors, []);
  });

  it('honours a per-field map from the API', () => {
    const error = new ApiClientError('Request failed with status 422', 422, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: { capacity: 'Please enter a value of at least 1 for the capacity.' },
      },
    });
    assert.deepEqual(mapApiValidationErrors(error).fieldErrors, {
      capacity: 'Please enter a value of at least 1 for the capacity.',
    });
  });

  it('rewrites raw validator text instead of rendering it', () => {
    const error = badRequest([
      'bus_number must be shorter than 33 characters',
      'capacity must be an integer number',
      'user_id must be a UUID, received 5f0c8f36-3a9e-4c1d-9b62-7f2f4a3c8d11',
    ]);
    const { fieldErrors, formErrors } = mapApiValidationErrors(error);
    assert.deepEqual(Object.keys(fieldErrors).sort(), ['bus_number', 'capacity', 'user_id']);
    for (const text of Object.values(fieldErrors)) {
      assert.doesNotMatch(text, /[a-z]+_[a-z]+/, `raw property name leaked: ${text}`);
      assert.doesNotMatch(text, /[0-9a-f]{8}-/i, `raw uuid leaked: ${text}`);
    }
    // A message that names only the property (`user_id …`) is still placed on
    // that input — rewritten, with the UUID gone.
    assert.equal(fieldErrors.user_id, guidanceFor('person', 'invalid'));
    assert.deepEqual(formErrors, []);
    // The same message with the property not in the form's map must not vanish.
    const withoutUser = mapApiValidationErrors(
      badRequest('user_id must be a UUID, received 5f0c8f36-3a9e-4c1d-9b62-7f2f4a3c8d11'),
      pickFieldLabels(['capacity']),
    );
    assert.deepEqual(withoutUser.fieldErrors, {});
    assert.deepEqual(withoutUser.formErrors, []);
  });

  it('keeps an unattributable friendly sentence at form level', () => {
    const error = badRequest('The default run cannot be retired from this screen.');
    const { fieldErrors, formErrors } = mapApiValidationErrors(error);
    assert.deepEqual(fieldErrors, {});
    assert.deepEqual(formErrors, ['The default run cannot be retired from this screen.']);
  });

  it('never invents an error for a success body', () => {
    assert.deepEqual(mapApiValidationErrors(null), { fieldErrors: {}, formErrors: [] });
    assert.deepEqual(mapApiValidationErrors(new Error('boom')), {
      fieldErrors: {},
      formErrors: [],
    });
  });
});

describe('errors.ts integration', () => {
  it('fieldErrorsFromUnknown is the mapped field half', () => {
    assert.deepEqual(fieldErrorsFromUnknown(badRequest('Please enter the document number.')), {
      document_number: 'Please enter the document number.',
    });
  });

  it('submitErrorMessage points at the highlights once every message landed', () => {
    assert.equal(
      submitErrorMessage(badRequest('Please enter a whole number for the capacity.')),
      'Please fix the highlighted fields and try again.',
    );
    assert.equal(
      submitErrorMessage(badRequest('The default run cannot be retired from this screen.')),
      'The default run cannot be retired from this screen.',
    );
  });

  it('fieldErrorsFromZod humanises schema wording while keeping the keys', () => {
    const zodError = {
      issues: [
        { path: ['document_number'], message: 'Required' },
        { path: ['issue_date'], message: 'date cannot be empty' },
        { path: ['expiry_date'], message: 'must be a valid ISO-8601 date (YYYY-MM-DD) or date-time' },
      ],
    };
    const mapped = fieldErrorsFromZod(zodError);
    assert.deepEqual(Object.keys(mapped), ['document_number', 'issue_date', 'expiry_date']);
    for (const [key, text] of Object.entries(mapped)) {
      assert.match(text, new RegExp(labelForField(key).split(' ')[0]), `${key} names no field`);
      assert.doesNotMatch(text, /ISO-8601|Required|date-time|YYYY/, `${key} leaked raw text`);
    }
  });
});
