/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/stops`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import { getAdminSchoolsBySchoolIdManageStops, postAdminSchoolsBySchoolIdManageStops } from '../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageStops);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageStops);
