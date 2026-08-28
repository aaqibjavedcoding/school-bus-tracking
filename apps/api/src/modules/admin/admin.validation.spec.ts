import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  adminSchoolCreateSchema,
  adminSchoolUpdateSchema,
  adminSchoolListQuerySchema,
  adminSchoolAdminCreateSchema,
  loginSchema,
} from '@school-bus-tracking/validation';

describe('platform validation schemas', () => {
  it('accepts a well-formed admin school create body with contact fields', () => {
    const result = adminSchoolCreateSchema.safeParse({
      school: {
        name: 'Lincoln High School',
        code: 'lincoln-high',
        email: 'office@lincoln.test',
        city: 'Springfield',
        country: 'us',
      },
      admin: {
        first_name: 'Alicia',
        last_name: 'Adams',
        email: 'ADMIN@Lincoln.TEST',
        password: 'correct-horse',
      },
    });
    assert.ok(result.success);
    if (result.success) {
      // Email normalized to lowercase; country uppercased.
      assert.equal(result.data.school.country, 'US');
      assert.equal(result.data.admin.email, 'admin@lincoln.test');
    }
  });

  it('rejects a client-supplied role or school_id in the create body (strict)', () => {
    const result = adminSchoolCreateSchema.safeParse({
      school: { name: 'X', code: 'x-high' },
      admin: { first_name: 'A', last_name: 'B', email: 'a@b.test', password: 'password123' },
      role: 'SUPER_ADMIN',
      school_id: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(result.success, false);
  });

  it('rejects invalid school code and short passwords', () => {
    assert.equal(
      adminSchoolCreateSchema.safeParse({
        school: { name: 'X', code: 'Bad Code!' },
        admin: { first_name: 'A', last_name: 'B', email: 'a@b.test', password: 'password123' },
      }).success,
      false,
    );
    assert.equal(
      adminSchoolCreateSchema.safeParse({
        school: { name: 'X', code: 'x' },
        admin: { first_name: 'A', last_name: 'B', email: 'a@b.test', password: 'short' },
      }).success,
      false,
    );
  });

  it('admin school update schema rejects identity/lifecycle fields and empty bodies', () => {
    const bad = adminSchoolUpdateSchema.safeParse({ code: 'new-code' });
    assert.equal(bad.success, false);
    const lifecycle = adminSchoolUpdateSchema.safeParse({ is_active: false });
    assert.equal(lifecycle.success, false);
    const empty = adminSchoolUpdateSchema.safeParse({});
    assert.equal(empty.success, false);
    const good = adminSchoolUpdateSchema.safeParse({ name: 'New name', city: 'Eugene' });
    assert.equal(good.success, true);
  });

  it('list query schema validates status and sorting', () => {
    const ok = adminSchoolListQuerySchema.safeParse({
      status: 'active',
      sort: 'name',
      order: 'desc',
    });
    assert.ok(ok.success);
    const bad = adminSchoolListQuerySchema.safeParse({ status: 'deleted' });
    assert.equal(bad.success, false);
  });

  it('school admin create schema rejects a role/school_id escalation attempt', () => {
    const ok = adminSchoolAdminCreateSchema.safeParse({
      first_name: 'A',
      last_name: 'B',
      email: 'a@b.test',
      password: 'password123',
    });
    assert.ok(ok.success);
    const attack = adminSchoolAdminCreateSchema.safeParse({
      first_name: 'A',
      last_name: 'B',
      email: 'a@b.test',
      password: 'password123',
      role: 'SUPER_ADMIN',
      school_id: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(attack.success, false);
  });

  it('login schema allows an omitted/empty school_id for platform login but not a bad UUID', () => {
    assert.ok(loginSchema.safeParse({ email: 'a@b.test', password: 'x' }).success);
    assert.ok(loginSchema.safeParse({ school_id: '', email: 'a@b.test', password: 'x' }).success);
    assert.ok(loginSchema.safeParse({ school_id: null, email: 'a@b.test', password: 'x' }).success);
    assert.equal(
      loginSchema.safeParse({ school_id: 'not-a-uuid', email: 'a@b.test', password: 'x' }).success,
      false,
    );
  });
});
