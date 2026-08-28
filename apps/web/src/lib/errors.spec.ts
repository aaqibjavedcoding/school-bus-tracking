import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { adminSchoolCreateSchema, loginSchema } from '@school-bus-tracking/validation';
import { fieldErrorsFromZod, formErrorsFromZod } from './errors.ts';

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
