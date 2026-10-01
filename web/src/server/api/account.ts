/**
 * Endpoint definitions for the `account` module (own-account self-service).
 *
 * Every route here resolves the account *from the verified JWT only* — the
 * same shape `getParentsMeStudents` uses: no id in the URL, no tenant in the
 * body, so there is nothing to probe. The byte-level rules (JPEG/PNG, 2 MB)
 * live with the service in `modules/account`.
 *
 * ### Who may own a profile photo (decision, this change)
 *
 * {@link PROFILE_PHOTO_ROLES} — DRIVER, CONDUCTOR and SCHOOL_ADMIN. Crew
 * because parents see their face on the live-trip screen; the school admin
 * because the console now has an account page and the sidebar renders the
 * photo. PARENT is out of scope (nothing displays a parent's photo), and the
 * platform SUPER_ADMIN is out of scope deliberately: it has `school_id =
 * null`, so it has no tenant for the storage key — which starts with the
 * school id — to live under, and faking one by casting `null` to a string is
 * exactly the kind of accident this codebase pins tests against.
 */
import { HttpStatus, NotFoundException } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { parseUploadedSpreadsheet } from '../http/file-response';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { PROFILE_PHOTO_FIELD, PROFILE_PHOTO_NOT_FOUND_MESSAGE } from '../modules/account';
import { profilePhotoResponse } from './crew-photos';

/**
 * The roles allowed to set, clear and read **their own** profile photo.
 *
 * Exported so the controller spec can assert the same list on all three
 * routes instead of repeating it — a widened guard should be one edit, in
 * one place, with one test.
 */
export const PROFILE_PHOTO_ROLES: UserRole[] = [
  UserRole.DRIVER,
  UserRole.CONDUCTOR,
  UserRole.SCHOOL_ADMIN,
];

async function readPhotoUpload(request: Request) {
  // The shared multipart plumbing returns the exact multer shape; the
  // photo-specific constraints are enforced inside the service.
  return parseUploadedSpreadsheet(request, PROFILE_PHOTO_FIELD);
}

/**
 * `GET /api/v1/account/me/photo` — the caller's own photo bytes.
 *
 * The convenience read: a client that already knows it is looking at *its
 * own* account does not need the storage key at all, and nothing about the
 * key travels in the URL. Identity comes from the JWT, the tenant comes from
 * the JWT, and an account with no photo gets the same generic 404 an unknown
 * key gets on `/crew-photos/{key}`.
 */
export const getAccountMePhoto: EndpointDefinition = {
  raw: true,
  roles: PROFILE_PHOTO_ROLES,
  handler: async ({ user, request }) => {
    const photo = await container()
      .account()
      .readOwnProfilePhoto(user.school_id as string, user.id);
    if (!photo) throw new NotFoundException(PROFILE_PHOTO_NOT_FOUND_MESSAGE);
    const ifNoneMatch = request.headers['if-none-match'];
    return profilePhotoResponse(photo, Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch);
  },
};

/** `PUT /api/v1/account/me/photo` */
export const putAccountMePhoto: EndpointDefinition = {
  roles: PROFILE_PHOTO_ROLES,
  status: HttpStatus.OK,
  handler: async ({ user, raw, request }) => {
    const schoolId = user.school_id as string;
    const upload = await readPhotoUpload(raw);
    // Missing/empty/oversized/typed-wrong uploads all 400 inside the service,
    // with the same messages the unit specs pin.
    const result = await container().account().setProfilePhoto(schoolId, user.id, upload);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.ACCOUNT_PHOTO_SET,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: user.id,
        ...auditRequestContext({ request }),
      });
    return result;
  },
};

/** `DELETE /api/v1/account/me/photo` */
export const deleteAccountMePhoto: EndpointDefinition = {
  roles: PROFILE_PHOTO_ROLES,
  status: HttpStatus.OK,
  handler: async ({ user, request }) => {
    const schoolId = user.school_id as string;
    const result = await container().account().clearProfilePhoto(schoolId, user.id);
    await container()
      .audit()
      .log({
        school_id: schoolId,
        actor_user_id: user.id,
        action: AUDIT_ACTIONS.ACCOUNT_PHOTO_CLEAR,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: user.id,
        ...auditRequestContext({ request }),
      });
    return result;
  },
};
