/**
 * `GET /api/v1/crew-photos/{key…}` — the read side of profile photos.
 *
 * The write side (`PUT`/`DELETE /account/me/photo`, `api/account.ts`) stores
 * the bytes and records the key on `users.profile_photo_key`; this is the
 * only route that gives them back, and the mobile parent app has been
 * building exactly this URL for its crew avatar since before it existed
 * (`mobile/src/features/parent/crew-photo.ts`).
 *
 * ## Why this handler is written so defensively
 *
 * Profile photos live in the **same blob store** as driver licences, bus RCs
 * and insurance documents — only the `profile-photos` entity folder tells
 * them apart. A key-addressed reader is therefore the one place in this API
 * where a missing check turns into "any signed-in user can read any tenant's
 * compliance documents". The rules, in the order they are applied:
 *
 * | Rule | Where |
 * | --- | --- |
 * | A valid bearer token is required (never public) | `auth` default + `roles` |
 * | The tenant is read from the JWT, never from the URL | `user.school_id` |
 * | The key must parse: no traversal, no separators, no empty/encoded segments, and it must name the `profile-photos` folder | {@link normalizeProfilePhotoKey} |
 * | The key must sit under the caller's own school prefix | `AccountService.readProfilePhotoByKey` |
 * | A `users` row **in that tenant** must reference exactly this key | same |
 * | The owner's role must be one this caller may look at | `ownerRoles` below |
 * | The blob must exist and be a JPEG or PNG | same |
 * | Every single failure answers the identical generic 404 | {@link PROFILE_PHOTO_NOT_FOUND_MESSAGE} |
 *
 * There is deliberately **no 403 inside the handler**: a cross-tenant key, a
 * key that belongs to a licence, a deleted blob and a typo all look the same
 * from outside, so probing a key tells an attacker nothing. (Role-level
 * rejection still 403s in the guard — that answer is identical for every key
 * and therefore leaks nothing about which photos exist.)
 *
 * ## SUPER_ADMIN
 *
 * The platform admin has `school_id = null` — it is not a member of any
 * tenant — and is **not** on the reader list: it gets the guard's 403 and,
 * even if it were, `readProfilePhotoByKey(null, …)` refuses to serve. Reading
 * a school's faces is not part of assisted management (which covers
 * operational CRUD, see `MANAGED_TENANT_PATH_RULES`); if that ever changes it
 * must be an explicit, audited decision, not a side effect of a null tenant.
 */
import { HttpStatus, NotFoundException } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { PROFILE_PHOTO_NOT_FOUND_MESSAGE } from '../modules/account';
import {
  normalizeProfilePhotoKey,
  profilePhotoNotModified,
} from '../modules/account/profile-photo-key';
import type { StoredProfilePhoto } from '../modules/account/account.service';

/**
 * Whose photo a caller may resolve by key.
 *
 * A school admin manages the whole tenant, so it may read any photo in it.
 * Crew and parents only ever render a **crew** avatar (the driver/conductor
 * on today's trip), so for them the owner must be crew — a parent cannot
 * fetch an administrator's photo by guessing a key.
 */
export function photoOwnerRolesFor(role: UserRole): readonly UserRole[] | undefined {
  if (role === UserRole.SCHOOL_ADMIN) return undefined;
  return [UserRole.DRIVER, UserRole.CONDUCTOR];
}

/** The one answer every failure gets. */
function notFound(): never {
  throw new NotFoundException(PROFILE_PHOTO_NOT_FOUND_MESSAGE);
}

/**
 * Writes the bytes with a private cache policy and a validator derived from
 * `profile_photo_updated_at`, honouring a conditional request.
 */
export function profilePhotoResponse(
  photo: StoredProfilePhoto,
  ifNoneMatch?: string | null,
): Response {
  const headers = new Headers({
    'Content-Type': photo.contentType,
    // Per-user content behind a bearer token: never store it in a shared
    // cache, and always revalidate so a replaced photo is never stale.
    'Cache-Control': 'private, no-cache, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  });
  if (photo.etag) headers.set('ETag', photo.etag);

  if (profilePhotoNotModified(ifNoneMatch, photo.etag)) {
    return new Response(null, { status: HttpStatus.NOT_MODIFIED, headers });
  }

  headers.set('Content-Length', String(photo.bytes.length));
  return new Response(new Uint8Array(photo.bytes), { status: HttpStatus.OK, headers });
}

/** `GET /api/v1/crew-photos/{key…}` */
export const getCrewPhoto: EndpointDefinition = {
  raw: true,
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.SCHOOL_ADMIN, UserRole.PARENT],
  handler: async ({ user, params, request }) => {
    const key = normalizeProfilePhotoKey((params as Record<string, unknown>).key);
    if (!key) notFound();

    const photo = await container()
      .account()
      .readProfilePhotoByKey(user.school_id, key, {
        ownerRoles: photoOwnerRolesFor(user.role),
      });
    if (!photo) notFound();

    const ifNoneMatch = request.headers['if-none-match'];
    return profilePhotoResponse(photo, Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch);
  },
};
