/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/subscription`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { getAdminSchoolsBySchoolIdSubscription, patchAdminSchoolsBySchoolIdSubscription, postAdminSchoolsBySchoolIdSubscription } from '../../../../../../../server/api/admin';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdSubscription);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdSubscription);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdSubscription);
