import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JwtService, Reflector } from '../../framework';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { callHandler, makeGuardContext } from '../../http/route-testing';
import type { EndpointDefinition } from '../../http/route-runtime';
import { overrideContainer } from '../../container';
import { getCrewPhoto, photoOwnerRolesFor } from '../../api/crew-photos';
import { AccountService } from './account.service';
import { PROFILE_PHOTO_NOT_FOUND_MESSAGE } from './account.constants';
import type { DocumentStorageProvider, StorageMetadata } from '../documents/storage';

/**
 * `GET /api/v1/crew-photos/{key…}` — the security-critical read.
 *
 * This route takes a **storage key from the URL** and answers with bytes out
 * of the blob store that also holds driver licences, bus RCs and insurance
 * documents. The spec is therefore written as a list of ways to get bytes you
 * are not entitled to, each of which must produce the *same* generic 404:
 *
 * - a key from another school (the tenant comes from the JWT, never the URL);
 * - a key no `users.profile_photo_key` row references — e.g. a licence,
 *   which lives one folder over in the very same store;
 * - a traversal / separator / empty-segment attempt;
 * - a blob whose content type is not JPEG or PNG;
 * - a parent reaching for an administrator's photo rather than a crew one.
 *
 * Plus the two positive guarantees: an authenticated, in-tenant, referenced
 * key returns the image with a private cache policy and an ETag derived from
 * `profile_photo_updated_at`, and no token at all is a 401.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const ADMIN_A = '09090909-0909-4909-8909-090909090901';
const PARENT_A = '08080808-0808-4808-8808-080808080801';
const SECRET = 'unit-test-jwt-secret';

const DRIVER_KEY = `${SCHOOL_A}/profile-photos/${DRIVER_A}/abcd1234-photo.jpg`;
const ADMIN_KEY = `${SCHOOL_A}/profile-photos/${ADMIN_A}/efef5678-photo.png`;
const OTHER_TENANT_KEY = `${SCHOOL_B}/profile-photos/${DRIVER_A}/9999zzzz-photo.jpg`;
/** A real licence key: same store, same tenant, one folder over. */
const LICENCE_KEY = `${SCHOOL_A}/driver-licenses/${DRIVER_A}/1111aaaa-licence.pdf`;
/** A photo-shaped key nobody's row points at (a deleted or invented photo). */
const ORPHAN_KEY = `${SCHOOL_A}/profile-photos/${DRIVER_A}/0000dead-photo.jpg`;

const UPDATED_AT = new Date('2026-10-01T06:00:00.000Z');
const PHOTO_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const jwtService = new JwtService({ secret: SECRET });
const jwtAuthGuard = new JwtAuthGuard(jwtService);
const rolesGuard = new RolesGuard(new Reflector());
const definition = getCrewPhoto as EndpointDefinition<never, never>;

interface MockRequest {
  headers: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

async function signAccessToken(role: UserRole, schoolId = SCHOOL_A, userId = DRIVER_A) {
  const payload: JwtAccessTokenPayload = {
    sub: userId,
    school_id: role === UserRole.SUPER_ADMIN ? null : schoolId,
    role,
  };
  return jwtService.signAsync(payload);
}

async function activateGuards(request: MockRequest): Promise<void> {
  const context = makeGuardContext(definition, request as unknown as Record<string, unknown>);
  await jwtAuthGuard.canActivate(context);
  rolesGuard.canActivate(context);
}

interface Row {
  id: string;
  school_id: string;
  role: UserRole;
  profile_photo_key: string | null;
  profile_photo_updated_at: Date | null;
}

const ROWS: Row[] = [
  {
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    profile_photo_key: DRIVER_KEY,
    profile_photo_updated_at: UPDATED_AT,
  },
  {
    id: ADMIN_A,
    school_id: SCHOOL_A,
    role: UserRole.SCHOOL_ADMIN,
    profile_photo_key: ADMIN_KEY,
    profile_photo_updated_at: UPDATED_AT,
  },
];

/**
 * The real query the service runs — `findOne({ where: { school_id,
 * profile_photo_key } })`. Tenant and key must both match, exactly as in the
 * database, so a cross-tenant key cannot resolve here either.
 */
function makeUsers() {
  const seen: Array<Record<string, unknown>> = [];
  const users = {
    findOne: async (query: { where: Record<string, unknown> }) => {
      seen.push(query.where);
      return (
        ROWS.find((row) =>
          Object.entries(query.where).every(
            ([field, value]) => (row as unknown as Record<string, unknown>)[field] === value,
          ),
        ) ?? null
      );
    },
  };
  return { users, seen };
}

/** A store that holds the two photos, a licence, and nothing else. */
function makeStorage() {
  const blobs: Record<string, { bytes: Buffer; contentType: string }> = {
    [DRIVER_KEY]: { bytes: PHOTO_BYTES, contentType: 'image/jpeg' },
    [ADMIN_KEY]: { bytes: PHOTO_BYTES, contentType: 'image/png' },
    [LICENCE_KEY]: { bytes: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' },
  };
  const retrieved: string[] = [];
  const provider: DocumentStorageProvider = {
    name: 'spec',
    isConfigured: true,
    store: async () => {
      throw new Error('not used');
    },
    retrieve: async (key: string) => {
      retrieved.push(key);
      return blobs[key]?.bytes ?? null;
    },
    getMetadata: async (key: string): Promise<StorageMetadata | null> => {
      const blob = blobs[key];
      if (!blob) return null;
      return {
        key,
        size: blob.bytes.length,
        contentType: blob.contentType,
        lastModified: UPDATED_AT,
        exists: true,
      };
    },
    delete: async () => true,
  };
  return { provider, retrieved };
}

function makeService() {
  const { users, seen } = makeUsers();
  const { provider, retrieved } = makeStorage();
  const service = new AccountService(
    users as unknown as ConstructorParameters<typeof AccountService>[0],
    provider,
  );
  return { service, seen, retrieved };
}

/** Calls the handler with a caller and a key, as the runtime would. */
async function fetchPhoto(
  user: { id: string; school_id: string | null; role: UserRole },
  key: string | string[],
  headers: Record<string, string> = {},
): Promise<Response> {
  const { service } = makeService();
  const restore = overrideContainer('account', service);
  try {
    return (await callHandler(definition, {
      user,
      params: { key: Array.isArray(key) ? key : key.split('/') } as unknown as Record<
        string,
        string
      >,
      request: { headers },
    })) as Response;
  } finally {
    restore();
  }
}

/** Every refusal has to be this, byte for byte. */
async function assertGeneric404(
  user: { id: string; school_id: string | null; role: UserRole },
  key: string | string[],
): Promise<void> {
  await assert.rejects(
    fetchPhoto(user, key),
    (error: { getStatus?: () => number; message?: string }) => {
      assert.equal(error.getStatus?.(), 404, 'every refusal is a 404, never a 403');
      assert.equal(error.message, PROFILE_PHOTO_NOT_FOUND_MESSAGE, 'one message for all of them');
      return true;
    },
  );
}

const CREW_CALLER = { id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER };
const ADMIN_CALLER = { id: ADMIN_A, school_id: SCHOOL_A, role: UserRole.SCHOOL_ADMIN };
const PARENT_CALLER = { id: PARENT_A, school_id: SCHOOL_A, role: UserRole.PARENT };

describe('crew photo route — authentication and roles', () => {
  it('requires a bearer token (401, never a public read)', async () => {
    assert.notEqual(definition.auth, false, 'the route must never be public');
    await assert.rejects(activateGuards({ headers: {} }), (error: { getStatus?: () => number }) => {
      assert.equal(error.getStatus?.(), 401);
      return true;
    });
  });

  it('admits the four tenant roles that can need a face on screen', async () => {
    for (const role of [
      UserRole.DRIVER,
      UserRole.CONDUCTOR,
      UserRole.SCHOOL_ADMIN,
      UserRole.PARENT,
    ]) {
      const request: MockRequest = {
        headers: { authorization: `Bearer ${await signAccessToken(role)}` },
      };
      await activateGuards(request);
      assert.equal(request.user?.school_id, SCHOOL_A);
    }
  });

  it('refuses the platform SUPER_ADMIN, which is in no tenant at all', async () => {
    const request: MockRequest = {
      headers: { authorization: `Bearer ${await signAccessToken(UserRole.SUPER_ADMIN)}` },
    };
    await assert.rejects(activateGuards(request), (error: { getStatus?: () => number }) => {
      assert.equal(error.getStatus?.(), 403);
      return true;
    });
    // …and even if it ever reached the handler, there is no tenant to scope
    // the read to, so the service refuses it too.
    await assertGeneric404(
      { id: ADMIN_A, school_id: null, role: UserRole.SUPER_ADMIN },
      DRIVER_KEY,
    );
  });
});

describe('crew photo route — the happy path', () => {
  it('serves the referenced photo with its declared content type', async () => {
    const response = await fetchPhoto(PARENT_CALLER, DRIVER_KEY);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('content-length'), String(PHOTO_BYTES.length));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PHOTO_BYTES);
  });

  it('is privately cached and carries an ETag derived from profile_photo_updated_at', async () => {
    const response = await fetchPhoto(ADMIN_CALLER, ADMIN_KEY);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.match(response.headers.get('cache-control') ?? '', /^private/);
    assert.ok(
      !/public/.test(response.headers.get('cache-control') ?? ''),
      'a per-user image must never land in a shared cache',
    );
    assert.equal(response.headers.get('etag'), `"${UPDATED_AT.getTime()}"`);
  });

  it('answers 304 to a conditional request holding the current version', async () => {
    const response = await fetchPhoto(ADMIN_CALLER, ADMIN_KEY, {
      'if-none-match': `"${UPDATED_AT.getTime()}"`,
    });
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
  });

  it("pins every lookup to the caller's tenant", async () => {
    const { service, seen } = makeService();
    const restore = overrideContainer('account', service);
    try {
      await callHandler(definition, {
        user: ADMIN_CALLER,
        params: { key: DRIVER_KEY.split('/') } as unknown as Record<string, string>,
        request: { headers: {} },
      });
    } finally {
      restore();
    }
    assert.ok(seen.length > 0, 'the row lookup really ran');
    for (const where of seen) {
      assert.equal(where.school_id, SCHOOL_A, 'no query may omit the tenant');
      assert.equal(where.profile_photo_key, DRIVER_KEY, 'the key is matched exactly');
    }
  });
});

describe('crew photo route — every refusal is the same generic 404', () => {
  it('a key from another school', async () => {
    await assertGeneric404(ADMIN_CALLER, OTHER_TENANT_KEY);
  });

  it('a photo-shaped key no user row references', async () => {
    await assertGeneric404(ADMIN_CALLER, ORPHAN_KEY);
  });

  it('a driver licence in the same store and the same tenant', async () => {
    await assertGeneric404(ADMIN_CALLER, LICENCE_KEY);
  });

  it('a traversal attempt, in several spellings', async () => {
    for (const key of [
      [SCHOOL_A, 'profile-photos', '..', '..', 'etc', 'passwd'],
      [SCHOOL_A, 'profile-photos', DRIVER_A, '..%2f..%2fdriver-licenses%2flicence.pdf'],
      ['..', 'profile-photos', DRIVER_A, 'photo.jpg'],
      [SCHOOL_A, 'profile-photos', '', 'photo.jpg'],
    ]) {
      await assertGeneric404(ADMIN_CALLER, key);
    }
  });

  it("a parent (or crew member) reaching for an administrator's photo", async () => {
    // Parents and crew only ever render a *crew* avatar, so the owner's role
    // is part of the check — a guessed admin key resolves to nothing.
    await assertGeneric404(PARENT_CALLER, ADMIN_KEY);
    await assertGeneric404(CREW_CALLER, ADMIN_KEY);
    assert.deepEqual(photoOwnerRolesFor(UserRole.PARENT), [UserRole.DRIVER, UserRole.CONDUCTOR]);
    assert.deepEqual(photoOwnerRolesFor(UserRole.DRIVER), [UserRole.DRIVER, UserRole.CONDUCTOR]);
    assert.equal(photoOwnerRolesFor(UserRole.SCHOOL_ADMIN), undefined, 'admins manage the tenant');
  });

  it('never reads a blob it has not already authorised', async () => {
    const { service, retrieved } = makeService();
    const restore = overrideContainer('account', service);
    try {
      await assert.rejects(
        callHandler(definition, {
          user: PARENT_CALLER,
          params: { key: LICENCE_KEY.split('/') } as unknown as Record<string, string>,
          request: { headers: {} },
        }),
      );
    } finally {
      restore();
    }
    assert.deepEqual(retrieved, [], 'the licence bytes were never touched');
  });
});
