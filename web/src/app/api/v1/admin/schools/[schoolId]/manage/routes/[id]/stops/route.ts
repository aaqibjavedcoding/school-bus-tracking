/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/routes/:id/stops`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../../server/http/route-runtime';
import { getAdminSchoolsBySchoolIdManageRoutesByIdStops, putAdminSchoolsBySchoolIdManageRoutesByIdStops } from '../../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRoutesByIdStops);
export const PUT = createRouteHandler(putAdminSchoolsBySchoolIdManageRoutesByIdStops);
