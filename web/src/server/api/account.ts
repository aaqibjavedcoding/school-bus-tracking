/**
 * Endpoint definitions for the `account` module (crew self-service).
 *
 * Both routes resolve the account *from the verified JWT only* — the same
 * shape `getParentsMeStudents` uses: no id in the URL, no tenant in the body,
 * so there is nothing to probe. The role guard limits the surface to DRIVER
 * and CONDUCTOR; the byte-level rules (JPEG/PNG, 2 MB) live with the service
 * in `modules/account`.
 */
import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { parseUploadedSpreadsheet } from '../http/file-response';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { PROFILE_PHOTO_FIELD } from '../modules/account';

async function readPhotoUpload(request: Request) {
  // The shared multipart plumbing returns the exact multer shape; the
  // photo-specific constraints are enforced inside the service.
  return parseUploadedSpreadsheet(request, PROFILE_PHOTO_FIELD);
}

/** `PUT /api/v1/account/me/photo` */
export const putAccountMePhoto: EndpointDefinition = {
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR],
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
  roles: [UserRole.DRIVER, UserRole.CONDUCTOR],
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
