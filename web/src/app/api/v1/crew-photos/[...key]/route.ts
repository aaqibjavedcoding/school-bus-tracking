/**
 * App Router entry point for `/api/v1/crew-photos/{key…}`.
 *
 * A catch-all because a storage key has slashes in it
 * (`<schoolId>/profile-photos/<userId>/<file>`); every safety rule about
 * those segments lives in the endpoint definition and the pure
 * `profile-photo-key` module, never here.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { getCrewPhoto } from '../../../../../server/api/crew-photos';

export const GET = createRouteHandler(getCrewPhoto);
