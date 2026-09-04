/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/routes/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageRoutesById, getAdminSchoolsBySchoolIdManageRoutesById, patchAdminSchoolsBySchoolIdManageRoutesById } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRoutesById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageRoutesById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageRoutesById);
