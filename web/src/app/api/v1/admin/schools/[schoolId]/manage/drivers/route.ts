/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/drivers`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import { getAdminSchoolsBySchoolIdManageDrivers, postAdminSchoolsBySchoolIdManageDrivers } from '../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageDrivers);
export const POST = createRouteHandler(postAdminSchoolsBySchoolIdManageDrivers);
