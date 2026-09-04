/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/stops/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageStopsById, getAdminSchoolsBySchoolIdManageStopsById, patchAdminSchoolsBySchoolIdManageStopsById } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageStopsById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageStopsById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageStopsById);
