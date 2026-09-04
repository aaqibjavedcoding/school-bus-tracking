/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/drivers/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageDriversById, getAdminSchoolsBySchoolIdManageDriversById, patchAdminSchoolsBySchoolIdManageDriversById } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageDriversById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageDriversById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageDriversById);
