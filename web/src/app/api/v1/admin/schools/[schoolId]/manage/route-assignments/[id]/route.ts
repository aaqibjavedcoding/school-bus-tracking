/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/route-assignments/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageRouteassignmentsById, getAdminSchoolsBySchoolIdManageRouteassignmentsById, patchAdminSchoolsBySchoolIdManageRouteassignmentsById } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageRouteassignmentsById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageRouteassignmentsById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageRouteassignmentsById);
