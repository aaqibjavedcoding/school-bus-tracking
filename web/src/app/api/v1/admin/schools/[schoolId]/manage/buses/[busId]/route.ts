/**
 * App Router entry point for `/api/v1/admin/schools/:schoolId/manage/buses/:busId`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../../server/http/route-runtime';
import { deleteAdminSchoolsBySchoolIdManageBusesById, getAdminSchoolsBySchoolIdManageBusesById, patchAdminSchoolsBySchoolIdManageBusesById } from '../../../../../../../../../server/api/admin-manage';

export const GET = createRouteHandler(getAdminSchoolsBySchoolIdManageBusesById);
export const PATCH = createRouteHandler(patchAdminSchoolsBySchoolIdManageBusesById);
export const DELETE = createRouteHandler(deleteAdminSchoolsBySchoolIdManageBusesById);
