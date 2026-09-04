/**
 * App Router entry point for `/api/v1/admin/schools/:id/admins`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../server/http/route-runtime';
import { getAdminSchoolsByIdAdmins, postAdminSchoolsByIdAdmins } from '../../../../../../../server/api/admin';

export const GET = createRouteHandler(getAdminSchoolsByIdAdmins);
export const POST = createRouteHandler(postAdminSchoolsByIdAdmins);
