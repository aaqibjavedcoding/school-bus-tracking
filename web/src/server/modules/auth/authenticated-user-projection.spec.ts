import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService } from '../../framework';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { User } from '../../database/models';
import { AuthService } from './auth.service';

/**
 * `AuthService.toAuthenticatedUser` — the one projection every session
 * payload goes through.
 *
 * `/auth/login`, `/auth/crew-login` and `/auth/refresh` all return whatever
 * this function returns, which is why the profile-photo read-back needed
 * nothing but two fields here: a key to fetch and a version to bust caches
 * with. It is also why the function is dangerous — a field added carelessly
 * is a field handed to every client, forever.
 *
 * So this spec asserts the projection **exactly**: the eight fields, no
 * more, and in particular never a credential. It is a field-level contract,
 * not a smoke test.
 */

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const UPDATED_AT = new Date('2026-10-01T06:00:00.000Z');

function makeService(): AuthService {
  return new AuthService(
    // The projection reads neither repository; constructing the service is
    // the cheapest way to call the real function rather than a copy of it.
    null as unknown as typeof User,
    null as never,
    new JwtService({ secret: 'projection-spec-secret' }),
  );
}

/** A row carrying every secret the users table holds. */
function makeRow(overrides: Record<string, unknown> = {}): User {
  return {
    id: USER,
    school_id: SCHOOL,
    role: UserRole.SCHOOL_ADMIN,
    first_name: 'Asha',
    last_name: 'Admin',
    email: 'asha@school.org',
    password_hash: '$2b$12$notarealhashnotarealhashnotarealhash',
    pin_hash: '$2b$12$pinpinpinpinpinpinpinpinpinpinpinpinpin',
    pin_set_at: UPDATED_AT,
    is_active: true,
    phone: '+91 90000 00000',
    profile_photo_key: `${SCHOOL}/profile-photos/${USER}/abcd1234-photo.jpg`,
    profile_photo_updated_at: UPDATED_AT,
    ...overrides,
  } as unknown as User;
}

describe('AuthenticatedUser projection', () => {
  it('carries the two profile-photo fields, with the timestamp as an ISO string', () => {
    const projected = makeService().toAuthenticatedUser(makeRow());

    assert.equal(
      projected.profile_photo_key,
      `${SCHOOL}/profile-photos/${USER}/abcd1234-photo.jpg`,
    );
    assert.equal(projected.profile_photo_updated_at, UPDATED_AT.toISOString());
  });

  it('reports "no photo" as null rather than undefined', () => {
    const projected = makeService().toAuthenticatedUser(
      makeRow({ profile_photo_key: null, profile_photo_updated_at: null }),
    );

    assert.equal(projected.profile_photo_key, null);
    assert.equal(projected.profile_photo_updated_at, null);
    // A row loaded with a narrowed `attributes` list has neither column at
    // all; the payload still has to be the documented shape.
    const sparse = makeService().toAuthenticatedUser({
      id: USER,
      school_id: SCHOOL,
      role: UserRole.DRIVER,
      first_name: 'Dana',
      last_name: 'Driver',
      email: null,
    } as unknown as User);
    assert.equal(sparse.profile_photo_key, null);
    assert.equal(sparse.profile_photo_updated_at, null);
  });

  it('projects exactly these fields and nothing else', () => {
    const projected = makeService().toAuthenticatedUser(makeRow());

    assert.deepEqual(Object.keys(projected).sort(), [
      'email',
      'first_name',
      'id',
      'last_name',
      'profile_photo_key',
      'profile_photo_updated_at',
      'role',
      'school_id',
    ]);
  });

  it('never carries a credential, whatever the row holds', () => {
    const projected = makeService().toAuthenticatedUser(makeRow()) as unknown as Record<
      string,
      unknown
    >;

    for (const secret of ['password_hash', 'pin_hash', 'pin_set_at', 'password']) {
      assert.ok(!(secret in projected), `${secret} must never reach a client`);
    }
    assert.ok(
      !JSON.stringify(projected).includes('$2b$12$'),
      'no hash may appear anywhere in the payload',
    );
  });
});
